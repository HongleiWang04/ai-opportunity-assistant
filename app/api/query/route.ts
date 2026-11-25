import {database,isInitialized,modelEnv} from "../../../lib/database.ts";
import {parseQuestion} from "../../../lib/parse.ts";
import {runQuery} from "../../../lib/queries.ts";
import {validateFilters,YEAR_LABELS,type YearBasis} from "../../../lib/contracts.ts";
import {body,json,failure} from "../../../lib/http.ts";
import {emptyResultFeedback,normalizeProjectLocation} from "../../../lib/project-lookup.ts";
export async function POST(request:Request){try{
  const input=await body(request);const db=database();if(!await isInitialized(db))return json({error:"模拟数据正在准备，请稍后重试。"},503);
  let filters;let method="manual";let notes:string[]=[];
  if(typeof input.question==="string"){
    const hint=input.yearBasis===null?null:typeof input.yearBasis==="string"&&Object.hasOwn(YEAR_LABELS,input.yearBasis)?input.yearBasis as YearBasis:null;
    const parsed=await parseQuestion(input.question,hint,modelEnv());if(parsed.clarification)return json({needsClarification:true,clarification:parsed.clarification,parserMethod:parsed.method});
    filters=await normalizeProjectLocation(db,parsed.filters);method=parsed.method;notes=parsed.notes;
  }else filters=validateFilters(input.filters);
  const result=await runQuery(db,filters,Number(input.page??1),20);
  const emptyFeedback=result.totalRows===0?await emptyResultFeedback(db,result.filters):undefined;
  return json({...result,parserMethod:method,notes,emptyFeedback});
}catch(error){return failure(error);}}
