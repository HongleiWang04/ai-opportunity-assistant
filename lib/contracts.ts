export {DATASET_AS_OF as AS_OF} from "./dataset.ts";
export const STAGES = [0,20,40,60,80,90,100];
export const GROUPS = ["医疗","教育","政企","城市军团"];
export const TEAM_OPTIONS = ["医疗","教育","高教团队","基教团队","民办校团队","基教A市团队","基教B市团队","基教C市团队","基教D市团队","基教E市团队","政企","城市军团"];
export const DEFAULT_FIELDS = ["负责人","所在团队","项目名称","客户名称","是否需要招投标","预计成交日期","预计挂网日期","项目金额"];
export const ALL_FIELDS = ["事业群","负责人","所在团队","项目编号","项目名称","客户名称","项目金额","预计毛利","预计利润","项目阶段","预计挂网日期","预计成交日期","业绩承诺","是否需要招投标","中标时间","项目所在省","项目所在市","项目所在区县"];
export const YEAR_LABELS: Record<string,string> = {expected_close:"预计成交日期",created:"创建日期",bid_award:"中标时间"};
export type YearBasis = "expected_close"|"created"|"bid_award";
export const DEFAULT_YEAR_BASIS:YearBasis="created";
export function isBareListing(question:string){
  return /^(?:请|帮我|请帮我)?(?:查(?:一下|看|询|下)?(?:所有|全部)?(?:商机|项目)(?:有哪(?:些|几个)|名单|清单)?|(?:有)?哪些(?:商机|项目))[？?。！!\s]*$/.test(question.trim());
}
export function wantsAllListingFields(question:string){
  const hasFieldSelection=/包含|包括|字段|列名|只要|只导出|加上|增加|添加|补上|只显示|只展示|仅显示|仅展示|显示|展示|放在前面|放到最前/.test(question);
  const asksForList=/有哪些|哪几(?:个|条|项)|列出|清单|名单|(?:查询|查一下|查下|查找|查|查看)(?:.*(?:商机|项目))/.test(question);
  const countOnly=/几个|多少|几条|几项|汇总|统计|占比|分布/.test(question)&&!/哪些|哪几(?:个|条|项)|列出|明细/.test(question);
  return asksForList&&!hasFieldSelection&&!countOnly;
}
export type Filters = {team:string|null;businessGroup:string|null;year:number|null;yearBasis:YearBasis|null;stageMin:number;stageMax:number;commitment:string|null;tender:boolean|null;owner:string|null;province:string|null;city:string|null;district:string|null;amountMin?:number|null;amountMax?:number|null;customer?:string|null;projectName?:string|null;projectId?:string|null;dateFrom?:string|null;dateTo?:string|null;missingPublishOnly?:boolean;profitStatus?:"loss"|"break_even"|"profit"|null;sortBy?:"expected_close"|"amount"|"profit";sortDirection?:"asc"|"desc";limit?:number|null;scopeIds?:string[];fields:string[];};
export type Parsed = {filters:Filters;method:"rules"|"qwen";notes:string[];clarification?:string;};
export type QueryResult = {filters:Filters;fields:string[];rows:Record<string,string|number|null>[];rowIds:string[];totalRows:number;page:number;pageSize:number;totalAmount:number;tenderCount:number;asOf:string;allSimulated:true;};
export function emptyFilters():Filters {return {team:null,businessGroup:null,year:null,yearBasis:null,stageMin:20,stageMax:80,commitment:null,tender:null,owner:null,province:null,city:null,district:null,fields:[...DEFAULT_FIELDS]};}
export function validateFilters(raw:unknown):Filters {
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("筛选条件格式不正确。");const r=raw as Record<string,unknown>;const f=emptyFilters();
  for(const key of ["team","businessGroup","commitment","owner","province","city","district"] as const){const v=r[key];if(v!==null&&v!==undefined&&v!==""){if(typeof v!=="string"||v.length>80)throw new Error("筛选文字过长或格式不正确。");f[key]=v.trim();}}
  if(f.team&&!TEAM_OPTIONS.includes(f.team))throw new Error(`未找到团队“${f.team}”，请从团队列表选择。`);
  if(f.businessGroup&&!GROUPS.includes(f.businessGroup))throw new Error("未找到该事业群。");
  if(f.commitment&&!["力争","确保","冲刺"].includes(f.commitment))throw new Error("业绩承诺仅支持力争、确保、冲刺。");
  for(const key of ["stageMin","stageMax"] as const){const v=r[key]??f[key];if(typeof v!=="number"||!Number.isInteger(v)||v<0||v>100)throw new Error("阶段范围应为0%至100%。");f[key]=v;}
  if(f.stageMin>f.stageMax)throw new Error("阶段下限不能大于上限。");
  if(r.year!==null&&r.year!==undefined&&r.year!==""){if(typeof r.year!=="number"||!Number.isInteger(r.year)||r.year<2000||r.year>2100)throw new Error("年份格式不正确。");f.year=r.year;}
  if(r.yearBasis!==null&&r.yearBasis!==undefined&&r.yearBasis!==""){if(!Object.hasOwn(YEAR_LABELS,r.yearBasis as string))throw new Error("年份口径不正确。");f.yearBasis=r.yearBasis as YearBasis;}
  if(f.year&&!f.yearBasis)throw new Error("请先选择年份按创建日期、预计成交日期还是中标时间筛选。");
  if(r.tender!==undefined&&r.tender!==null){if(typeof r.tender!=="boolean")throw new Error("招投标条件格式不正确。");f.tender=r.tender;}
  for(const key of ["amountMin","amountMax"] as const){const v=r[key];if(v!==null&&v!==undefined){if(typeof v!=="number"||!Number.isFinite(v)||v<0||v>1e12||Math.abs(v*100-Math.round(v*100))>0.0001)throw new Error("金额应为非负数，单位为元，最多两位小数。");f[key]=v;}}
  if(f.amountMin!=null&&f.amountMax!=null&&f.amountMin>f.amountMax)throw new Error("金额下限不能大于上限。");
  if(r.scopeIds!==undefined){
    if(!Array.isArray(r.scopeIds)||r.scopeIds.length>10000||r.scopeIds.some(id=>typeof id!=="string"||!id.length||id.length>32)){
      throw new Error("原项目清单范围不正确。");
    }
    f.scopeIds=[...new Set(r.scopeIds)];
  }
  if(r.customer!=null&&r.customer!==""){if(typeof r.customer!=="string"||r.customer.length>100)throw new Error("客户名称过长或格式不正确。");f.customer=r.customer.trim();}
  for(const [key,label,maxLength] of [["projectName","项目名称",180],["projectId","项目编号",32]] as const){
    const value=r[key];
    if(value==null)continue;
    if(typeof value!=="string"||value.length>maxLength)throw new Error(label+"过长或格式不正确。");
    if(value.trim())f[key]=key==="projectId"?value.trim().toUpperCase():value.trim();
  }
  for(const key of ["dateFrom","dateTo"] as const){const v=r[key];if(v!=null&&v!==""){if(typeof v!=="string"||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+"T00:00:00Z"))||new Date(v+"T00:00:00Z").toISOString().slice(0,10)!==v)throw new Error("日期应为有效的YYYY-MM-DD。");f[key]=v;}}
  if((f.dateFrom||f.dateTo)&&!f.yearBasis)throw new Error("请先确认日期筛选口径。");
  if(f.dateFrom&&f.dateTo&&f.dateFrom>f.dateTo)throw new Error("日期起点不能晚于终点。");
  if(r.missingPublishOnly!==undefined){if(typeof r.missingPublishOnly!=="boolean")throw new Error("挂网日期缺失条件格式不正确。");f.missingPublishOnly=r.missingPublishOnly;if(f.missingPublishOnly&&f.tender===false)throw new Error("非招投标项目不适用招投标挂网日期缺失筛选。");}
  if(r.profitStatus!=null){if(!["loss","break_even","profit"].includes(String(r.profitStatus)))throw new Error("预计利润状态不正确。");f.profitStatus=r.profitStatus as Filters['profitStatus'];}
  if(r.sortBy!==undefined){if(!["expected_close","amount","profit"].includes(String(r.sortBy)))throw new Error("排序字段不在支持范围。");f.sortBy=r.sortBy as Filters['sortBy'];}
  if(r.sortDirection!==undefined){if(!["asc","desc"].includes(String(r.sortDirection)))throw new Error("排序方向不正确。");f.sortDirection=r.sortDirection as Filters['sortDirection'];}
  if(r.limit!=null){if(typeof r.limit!=="number"||!Number.isInteger(r.limit)||r.limit<1||r.limit>10000)throw new Error("前N条范围应为1至10000的整数。");f.limit=r.limit;}
  if(r.fields!==undefined){if(!Array.isArray(r.fields)||!r.fields.length||r.fields.length>18)throw new Error("请至少选择一个导出字段，最多18个。");f.fields=[...new Set(r.fields.map(x=>x==="项目负责人"?"负责人":x))] as string[];if(f.fields.some(x=>typeof x!=="string"||!ALL_FIELDS.includes(x)))throw new Error("包含不支持的字段。");}
  return f;
}
