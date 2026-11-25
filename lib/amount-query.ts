import {emptyFilters,validateFilters,type Filters,type QueryResult} from "./contracts.ts";
import {runQuery,type Database} from "./queries.ts";

type AmountCondition = {
  expression: string;
  label: string;
  minCents?: number;
  maxCents?: number;
};

const number = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?)";
const unit = "(亿元?|万元?|元)";
const prefix = "大于等于|小于等于|没有超过|不低于|不少于|不小于|不高于|不超过|不大于|至少|至多|超过|大于|高于|多于|低于|小于|少于|>=|<=|>|<|≥|≤";
const rangePattern = new RegExp(`${number}${unit}?\\s*(?:至|到|[-—~～])\\s*${number}${unit}`);
const comparisonPattern = new RegExp(`(?:(${prefix})\\s*)?${number}\\s*${unit}\\s*(及?以上|及?以下)?`, "g");

function cents(value:string, scale:string){
  return Number(value.replaceAll(",",""))*(scale.startsWith("亿")?1e10:scale.startsWith("万")?1e6:100);
}

export function projectAmountCondition(question:string):AmountCondition|null {
  const text=question.normalize("NFKC");
  if(/毛利|利润|回款|预算|客户金额/.test(text)&&!/(?:项目|商机)金额/.test(text))return null;
  const range=text.match(rangePattern);
  if(range){
    const min=cents(range[1],range[2]??range[4]),max=cents(range[3],range[4]);
    if(Number.isFinite(min)&&Number.isFinite(max)&&min<=1e14&&max<=1e14){
      return {expression:range[0],label:range[0].trim(),minCents:Math.ceil(min-1e-6),maxCents:Math.floor(max+1e-6)};
    }
  }
  const match=[...text.matchAll(comparisonPattern)].find(item=>item[1]||item[4]);
  if(!match)return null;
  const [,comparison,value,scale,suffix]=match;
  const threshold=cents(value,scale);
  if(!Number.isFinite(threshold)||threshold>1e14)return null;
  const amount=`${value} ${scale.endsWith("元")?scale:scale+"元"}`;
  if(/^(?:超过|大于|高于|多于|>)$/.test(comparison??"")){
    return {expression:match[0],label:"大于 "+amount,minCents:Math.floor(threshold+1e-6)+1};
  }
  if(/^(?:低于|小于|少于|<)$/.test(comparison??"")){
    return {expression:match[0],label:"小于 "+amount,maxCents:Math.ceil(threshold-1e-6)-1};
  }
  if(suffix?.endsWith("以下")||/^(?:小于等于|不高于|不超过|不大于|没有超过|至多|<=|≤)$/.test(comparison??"")){
    return {expression:match[0],label:amount+"及以下",maxCents:Math.floor(threshold+1e-6)};
  }
  return {expression:match[0],label:amount+"及以上",minCents:Math.ceil(threshold-1e-6)};
}

export function amountOnlyQuestion(question:string, condition:AmountCondition|null){
  if(!condition)return false;
  const rest=question.normalize("NFKC").replace(condition.expression,"").replace(
    /[\s,，。！？?!、：:；;]|项目(?:的)?金额|商机金额|金额|请问|请|帮我|只保留|只看|改成|改为|筛选出|筛选|查一下|查询|查|统计|列出来|列出|展示|哪几个|哪几项|哪些|哪几条|有几个|有几条|有几项|有多少|有|几个|几条|几项|多少|当前清单|上一轮|这批|这些|其中|里面|项目|商机|记录|导出|Excel|在|中|里|的|吗|一下/gi, "",
  );
  return rest==="";
}

export function applyAmountCondition(base:Filters, condition:AmountCondition, options:{intersect?:boolean;includeFields?:boolean;scopeIds?:string[]}={}):Filters{
  const min=options.intersect&&base.amountMin!=null?Math.max(Math.round(base.amountMin*100),condition.minCents??0):condition.minCents??(base.amountMin==null?undefined:Math.round(base.amountMin*100));
  const max=options.intersect&&base.amountMax!=null?Math.min(Math.round(base.amountMax*100),condition.maxCents??Infinity):condition.maxCents??(base.amountMax==null?undefined:Math.round(base.amountMax*100));
  const empty=(max!==undefined&&max<0)||(min!==undefined&&max!==undefined&&min>max)||min!==undefined&&min>1e14;
  const fields=options.includeFields?[...new Set([...base.fields,"项目名称","项目金额"])]:base.fields;
  return validateFilters({
    ...base,fields,
    amountMin:empty?null:min==null?null:min/100,
    amountMax:empty?null:max==null?null:max/100,
    scopeIds:empty?[]:options.scopeIds??base.scopeIds,
  });
}

export async function amountQueryFilters(db:Database, base:Filters|null, condition:AmountCondition, scopeIds?:string[]){
  const scope=base?.limit?(scopeIds??(await runQuery(db,{...base,fields:["项目编号"]},1,20,true)).rowIds):undefined;
  return applyAmountCondition(base??{...emptyFilters(),stageMin:0,stageMax:100},condition,{
    intersect:!!base,includeFields:true,scopeIds:scope,
  });
}

export function amountResultMessage(condition:AmountCondition, result:QueryResult, wasFollowUp:boolean, showNames=false){
  const scope=wasFollowUp?"上一轮清单中，":"";
  const comparison=/^[大小]于/.test(condition.label)?condition.label:" "+condition.label;
  const count=`${scope}项目金额${comparison}的项目有 ${result.totalRows} 个。`;
  if(!result.totalRows)return count;
  if(!showNames||result.totalRows>5)return count+"明细已列在下方清单。";
  const names=result.rows.map(row=>`「${row["项目名称"]}」`).join("、");
  return count+`分别是${names}。`;
}
