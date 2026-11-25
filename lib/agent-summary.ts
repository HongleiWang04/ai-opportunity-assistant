import type {QueryResult} from "./contracts.ts";

export const SUMMARY_DIMENSIONS={team:"所在团队",city:"项目所在市",province:"项目所在省",owner:"负责人",commitment:"业绩承诺",tender:"是否需要招投标",stage:"项目阶段"} as const;
export type SummaryDimension=keyof typeof SUMMARY_DIMENSIONS;
export function isResultSummaryQuestion(question:string){
  return /这些|这批|这份|其中|它们|里面|以上|当前|刚才|上述/.test(question)&&/几个|多少|几条|几项|统计|分布|占比/.test(question)&&!/只保留|重新查询|改为查询|筛选出|导出|下载/i.test(question);
}
function teamAlias(value:string){const match=value.match(/^(?:基教)?([A-E])市(?:团队)?$/i);return match?`基教${match[1].toUpperCase()}市团队`:value;}
export function summarizeResult(full:QueryResult,dimension:SummaryDimension,value?:string){
  const field=SUMMARY_DIMENSIONS[dimension];if(!field)throw new Error("统计维度不在支持范围。");
  const counts:Record<string,number>={};for(const row of full.rows){const key=String(row[field]??"未填写");counts[key]=(counts[key]??0)+1;}
  const groups=Object.entries(counts).map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value,"zh-CN"));
  if(value===undefined||value===null||value==="")return {dimension,field,total:full.totalRows,groups,message:`当前清单共${full.totalRows}个项目，按${field}统计：${groups.length?groups.map(g=>`${g.value} ${g.count}个`).join("；"):"暂无项目"}。`};
  if(typeof value!=="string"||value.length>80)throw new Error("统计对象格式不正确。");
  let target=value.trim();if(dimension==="team")target=teamAlias(target);
  if(["city","province"].includes(dimension)&&!Object.hasOwn(counts,target))target=Object.keys(counts).find(k=>k===target+"市"||k===target+"省")??target;
  const count=counts[target]??0;const percentage=full.totalRows?Math.round(count/full.totalRows*1000)/10:0;
  let message=`当前${full.totalRows}个项目中，${field}为“${target}”的有${count}个${full.totalRows?`，占${percentage}%`:""}。`;
  let alternative: {field:string;value:string;count:number}|undefined;
  if(dimension==="city"&&/^[A-E]市$/i.test(target)){
    const team=teamAlias(target);const teamCount=full.rows.filter(row=>row["所在团队"]===team).length;
    alternative={field:"所在团队",value:team,count:teamCount};
    message+=`如果你指的是“${team}”，则有${teamCount}个。“${target}”是模拟团队名称的一部分，团队归属与项目所在市是两个字段。`;
  }
  return {dimension,field,value:target,total:full.totalRows,count,percentage,groups,alternative,message};
}
