import {STAGES,validateFilters,type Filters,type QueryResult} from "./contracts.ts";
import {runQuery,type Database} from "./queries.ts";

type WinStatus="won"|"unwon";
const unwonPattern=/尚未赢单|尚未成交|未赢单|未成交|没(?:有)?赢单|没(?:有)?成交|非赢单/;
const wonPattern=/已赢单|已成交|已签单|赢单(?=的?(?:项目|商机|清单|名单|有哪些|有多少|有几个|有几条)|[？?。！!\s]*$)/;
const comparisonPattern=/(?:项目|商机)?(?:阶段|进度)\s*(?:为|在)?\s*(大于等于|小于等于|不低于|不少于|不超过|至少|至多|超过|大于|高于|低于|小于|>=|<=|>|<|≥|≤)\s*(\d{1,3}(?:\.\d+)?)\s*%/;

export function explicitWinStatus(question:string):WinStatus|null{
  if(unwonPattern.test(question))return "unwon";
  return wonPattern.test(question)?"won":null;
}

type StageComparison={text:string;label:string;matches:(stage:number)=>boolean};
export function stageComparison(question:string):StageComparison|null{
  const match=question.normalize("NFKC").match(comparisonPattern);
  if(!match)return null;
  const [,operator,number]=match;
  const value=Number(number);
  const label=`${number}%`;
  if(/^(?:大于等于|不低于|不少于|至少|>=|≥)$/.test(operator))return {text:match[0],label:label+"及以上",matches:stage=>stage>=value};
  if(/^(?:小于等于|不超过|至多|<=|≤)$/.test(operator))return {text:match[0],label:label+"及以下",matches:stage=>stage<=value};
  if(/^(?:超过|大于|高于|>)$/.test(operator))return {text:match[0],label:"大于 "+label,matches:stage=>stage>value};
  return {text:match[0],label:"小于 "+label,matches:stage=>stage<value};
}

function stageFilter(status:WinStatus|null, comparison:StageComparison|null, base?:Filters){
  const allowed=STAGES.filter(stage=>{
    const matchesStatus=status==="won"?stage===100:status==="unwon"?stage<100:true;
    const inScope=!base||stage>=base.stageMin&&stage<=base.stageMax;
    return matchesStatus&&inScope&&(!comparison||comparison.matches(stage));
  });
  if(!allowed.length)return {stageMin:0,stageMax:100,scopeIds:[]};
  return {stageMin:allowed[0],stageMax:allowed[allowed.length-1]};
}

export function explicitStageFilter(question:string){
  const status=explicitWinStatus(question);
  const comparison=stageComparison(question);
  return status||comparison?stageFilter(status,comparison):null;
}

export function followUpStageQuery(question:string, base:Filters|null){
  if(!base)return null;
  const comparison=stageComparison(question);
  let status=explicitWinStatus(question);
  const refersToRest=/剩下|其余|其他的/.test(question);
  const afterWon=base.stageMin===100&&base.stageMax===100;
  if(!status&&afterWon&&refersToRest)status="unwon";
  if(!status&&!comparison)return null;
  const remainder=question.normalize("NFKC").replace(comparison?.text??"","")
    .replace(unwonPattern,"").replace(wonPattern,"")
    .replace(/[\s,，。!！?？、；;]/g,"")
    .replace(/剩下|其余|其他的|接下来|继续|刚才|上面|当前清单|这些|这批|其中|里面|这份|都|是|的|有多少|有几个|有几条|有几项|有哪几个|有哪些|哪几个|哪些|多少|几个|几条|项目|商机|记录|请|帮我|查一下|查询|查|统计|列出来|列出|只看|导出|Excel|再|吗|呢|那|在|中|里/g,"");
  if(remainder)return null;
  if(refersToRest&&status==="unwon"&&!afterWon)return null;
  const showRemaining=afterWon&&status==="unwon"&&refersToRest;
  const withinCurrent=!status||!showRemaining&&/这些|这批|这份|其中|当前(?:清单|结果)|刚才/.test(question);
  return {base,status,comparison,showRemaining,withinCurrent};
}

export async function stageFollowUpFilters(db:Database, plan:NonNullable<ReturnType<typeof followUpStageQuery>>):Promise<Filters>{
  const {base,status,comparison,withinCurrent}=plan;
  const snapshot=withinCurrent&&base.limit?(await runQuery(db,{...base,fields:["项目编号"]},1,20,true)).rowIds:base.scopeIds;
  return validateFilters({
    ...base,
    limit:withinCurrent?base.limit:null,
    scopeIds:snapshot,
    ...stageFilter(status,comparison,withinCurrent?base:undefined),
    fields:[...new Set([...base.fields,"项目名称","项目阶段"])],
  });
}

export async function stageFollowUpMessage(db:Database,plan:NonNullable<ReturnType<typeof followUpStageQuery>>,result:QueryResult){
  const {base,status,comparison,showRemaining}=plan;
  let message="";
  if(showRemaining){
    const remaining=comparison?await runQuery(db,{...base,limit:null,stageMin:0,stageMax:90,fields:["项目编号"]},1,1):result;
    message=`在同一查询范围内，除已赢单项目外，其余 ${remaining.totalRows} 个项目均未赢单。`;
    if(!comparison)return message+(result.totalRows?"明细已列在下方清单。":"");
  }
  const scope=status==="unwon"?"未赢单且":status==="won"?"已赢单且":"当前清单中，";
  if(comparison)message+=`${scope}阶段${comparison.label}的项目有 ${result.totalRows} 个`;
  else message+=`${status==="unwon"?"未赢单":"已赢单"}项目有 ${result.totalRows} 个`;
  if(result.rows.length===result.totalRows&&result.totalRows){
    const breakdown=STAGES.map(stage=>{
      const count=result.rows.filter(row=>row["项目阶段"]===`${stage}%`).length;
      return count?`${stage}% 有 ${count} 个`:"";
    }).filter(Boolean);
    if(breakdown.length)message+="（"+breakdown.join("、")+"）";
  }
  return message+"。"+(result.totalRows?"明细已列在下方清单。":"");
}

export function namedWinCity(question:string){
  return question.match(/(?:查询|查一下|查找|查|列出)\s*([\u3400-\u9fff]{2,8}?)的(?:已?赢单|未赢单|尚未赢单)(?=项目|商机)/)?.[1]??null;
}
