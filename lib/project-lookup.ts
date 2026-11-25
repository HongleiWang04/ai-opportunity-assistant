import {emptyFilters,type Filters,type QueryResult} from "./contracts.ts";
import {runQuery,type Database} from "./queries.ts";

type ProjectReference = {projectName:string;projectId:null} | {projectName:null;projectId:string};
const stageQuestion = /(?:项目|商机)?(?:的)?(?:阶段|进度)(?:是多少|是什么|如何|怎么样|在哪一阶段)?[。！!？?]*$/;
const explicitStage = /\d\s*[%％]|在途|已赢单|已成交|已签单/;

export function projectReference(text:string, waitingForName=false):ProjectReference|null {
  const question=text.trim();
  const code=question.match(/\bMOCK-(?:20\d{2}|DIV)-\d{1,12}\b/i)?.[0]
    ??question.match(/项目编号\s*(?:是|为|[:：])\s*["“「]?([a-z\d_-]{2,32})/i)?.[1];
  if(code)return {projectName:null,projectId:code};

  const labeled=question.match(/项目名称\s*(?:是|为|包含|含|[:：])\s*["“「]?([^"”」；;，,。!?！？\n]{2,180})/)?.[1];
  const locationOrName=question.match(/^(?:请|麻烦)?(?:帮我)?(?:查询|查(?:一下|一查|看|下)?)\s*(.{2,180}?)\s*(?:项目(?:的)?(?:阶段|进度)|商机(?:的)?(?:阶段|进度))(?:是多少|是什么|如何|怎么样)?[。！!？?]*$/)?.[1];
  const reply=waitingForName&&/^[“「"]?[\u3400-\u9fffA-Za-z0-9（）()· -]{2,180}[”」"]?[。！!？?]*$/.test(question)
    && !/^(?:查|列出|导出|下载|加上|补上|增加|只看|只保留|取消|去掉|统计|按|其他|帮我)/.test(question)
    ?question.replace(/^[“「"]|[”」"。！!？?]+$/g,""):null;
  const name=(labeled??locationOrName??reply)?.trim().replace(/^["“「]|["”」]$/g,"").replace(/^在(?=.{2})/,"");
  if(!name||name.length<2||(!labeled&&!reply&&/^(?:这些|所有|全部|当前|每个?|该|那个?|这个?)|20\d{2}年|在途|已赢单/.test(name)))return null;
  return {projectName:name,projectId:null};
}

export function prepareProjectFields(question:string, filters:Filters, initialLookup:boolean):Filters {
  if(!filters.projectName&&!filters.projectId)return filters;
  const fields=new Set(stageQuestion.test(question)?["项目名称","项目编号","项目阶段"]:filters.fields);
  if(stageQuestion.test(question)||filters.fields.includes("项目阶段")){
    fields.add("项目名称");
    fields.add("项目编号");
    fields.add("项目阶段");
  }
  const stages=initialLookup&&!explicitStage.test(question)?{stageMin:0,stageMax:100}:{};
  return {...filters,...stages,fields:[...fields]};
}

export async function knownProjectCity(db:Database, value:string):Promise<string|null> {
  const match=await db.prepare("SELECT city FROM opportunities WHERE city=? OR city=?||'市' LIMIT 1").bind(value,value).first();
  return match?String(match.city):null;
}

export async function normalizeProjectLocation(db:Database, filters:Filters):Promise<Filters> {
  if(!filters.projectName&&!filters.projectId)return filters;
  const city=filters.city?(await knownProjectCity(db,filters.city))??filters.city:null;
  const name=filters.projectName;
  if(!name)return {...filters,city};
  const prefix=await db.prepare(
    "SELECT DISTINCT city FROM opportunities WHERE instr(?,city)=1 OR (substr(city,-1)='市' AND instr(?,substr(city,1,length(city)-1))=1) ORDER BY length(city) DESC LIMIT 1"
  ).bind(name,name).first();
  if(!prefix)return {...filters,city};
  const namedCity=String(prefix.city);
  if(city&&city!==namedCity)return {...filters,city};
  const shortCity=namedCity.replace(/市$/,"");
  const remainder=name.slice(name.startsWith(namedCity)?namedCity.length:shortCity.length).trim().replace(/^的/,"").trim();
  return {...filters,city:namedCity,projectName:remainder.length>=2?remainder:name};
}

export async function emptyResultFeedback(db:Database, filters:Filters):Promise<string> {
  const reference=filters.projectId??filters.projectName;
  const subject=reference?`${filters.city??""}「${reference}」`:null;
  const lead=subject?`当前条件下没有查到${subject}。`:"当前条件下没有查到匹配的商机。";
  const next=reference?"请确认项目所在城市，或补充项目全名、项目编号。":"请核对年份、团队或项目阶段。也可以提供项目名称或编号继续查。";
  if(!filters.city)return lead+next;

  if(reference){
    const matches=await runQuery(db,{...filters,city:null,limit:null,fields:["项目所在市"]},1,3);
    if(matches.totalRows){
      const cities=[...new Set(matches.rows.map(row=>row["项目所在市"]))].filter(Boolean).join("、");
      const locations=cities?`，例如${cities}`:"";
      return `${lead}去掉城市条件后查到 ${matches.totalRows} 个匹配项目${locations}。${next}`;
    }
  }
  const nearby=await runQuery(db,{...emptyFilters(),city:filters.city,stageMin:0,stageMax:100,fields:["项目编号"]},1,1);
  return lead+(nearby.totalRows?`演示库中共有 ${nearby.totalRows} 个${filters.city}项目记录。`:"")+next;
}

export function projectStageSummary(result:QueryResult,filters:Filters):string|undefined {
  if((!filters.projectId&&!filters.projectName)||!filters.fields.includes("项目阶段")||result.totalRows!==1)return;
  const row=result.rows[0];
  if(row?.["项目阶段"]==null||row["项目名称"]==null)return;
  return `查到「${row["项目名称"]}」（${result.rowIds[0]}），项目阶段为 ${row["项目阶段"]}。`;
}
