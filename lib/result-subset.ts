import {SUMMARY_DIMENSIONS,type SummaryDimension} from "./agent-summary.ts";
import type {Filters,QueryResult} from "./contracts.ts";
export type SummaryTarget={resultId:string;dimension:SummaryDimension;value:string;count:number};
export function isSubsetListingRequest(question:string){return /列出来|单独列出|单独展示|单独显示|^(?:请|帮我)?列出|(?:查看|看看|展示)(?:这|那)[一二三四五六七八九十\d]*(?:个|条|些)项目/.test(question)&&!/字段|列名|(?:缺少|缺失).{0,12}挂网|专项表/.test(question);}
export function previousSummary(history:{role:string;content:string}[],resultId:string,target?:SummaryTarget):SummaryTarget|undefined{
  if(target?.resultId===resultId)return target;
  const last=history.filter(h=>h.role==="assistant").at(-1)?.content??"";
  const match=last.match(/(项目所在市|项目所在省|所在团队|负责人|业绩承诺|是否需要招投标|项目阶段)为“([^”]+)”的有(\d+)个/);
  if(!match||/如果你指的是/.test(last))return undefined;
  const dimension=Object.keys(SUMMARY_DIMENSIONS).find(d=>SUMMARY_DIMENSIONS[d as SummaryDimension]===match[1]) as SummaryDimension|undefined;
  return dimension?{resultId,dimension,value:match[2],count:Number(match[3])}:undefined;
}
const filterKeys:Record<SummaryDimension,keyof Filters>={city:"city",province:"province",team:"team",owner:"owner",commitment:"commitment",tender:"tender",stage:"stageMin"};
export function resolveSubsetTarget(question:string,full:QueryResult,base:Filters,previous:SummaryTarget|undefined,args:Record<string,unknown>):{dimension:SummaryDimension;value:string}|undefined{
  // An elliptical follow-up refers to the last actual summary, not model guesses.
  if(/^(?:请|帮我|那就|把它们)?(?:单独)?(?:列出来|列出|展示出来|查看这些项目|看看这些项目)[吧。！!\s]*$/.test(question.trim()))return previous&&{dimension:previous.dimension,value:previous.value};
  const candidates:{dimension:SummaryDimension;value:string}[]=[];
  for(const dimension of ["city","province","owner","team","commitment","tender","stage"] as SummaryDimension[]){
    const values=[...new Set(full.rows.map(row=>String(row[SUMMARY_DIMENSIONS[dimension]]??"")))].filter(Boolean);
    for(const value of values){const short=["city","province"].includes(dimension)?value.replace(/[市省]$/,""):value;
      if(short.length>=2&&(question.includes(value)||question.includes(short)))candidates.push({dimension,value});
    }
  }
  const changed=candidates.filter(target=>String(base[filterKeys[target.dimension]]??"")!==target.value);
  if(changed.length===1)return changed[0];if(!changed.length&&candidates.length===1)return candidates[0];
  if(/招投标/.test(question)&&/(?:需要|不需要|无需)/.test(question))return {dimension:"tender",value:/不需要|无需/.test(question)?"否":"是"};
  if(typeof args.dimension==="string"&&Object.hasOwn(SUMMARY_DIMENSIONS,args.dimension)&&typeof args.value==="string"&&args.value.length<=80){
    const value=args.value.trim();const short=value.replace(/[市省]$/,"");if(short.length>=2&&question.includes(short))return {dimension:args.dimension as SummaryDimension,value};
  }
  return undefined;
}
export function subsetFilters(base:Filters,target:{dimension:SummaryDimension;value:string}):Filters|null{
  const next={...base,fields:[...base.fields]};const key=filterKeys[target.dimension];let value:unknown=target.value;
  if(target.dimension==="tender"){if(!["是","否"].includes(target.value))return null;value=target.value==="是";}
  if(target.dimension==="stage"){const n=Number(target.value.replace("%",""));if(!Number.isFinite(n)||n<base.stageMin||n>base.stageMax)return null;return {...next,stageMin:n,stageMax:n};}
  if(base[key]!==null&&base[key]!==undefined&&base[key]!==value)return null;
  return {...next,[key]:value};
}
