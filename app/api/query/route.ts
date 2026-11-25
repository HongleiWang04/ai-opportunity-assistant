import {database,isInitialized,modelEnv} from "../../../lib/database.ts";
import {parseQuestion} from "../../../lib/parse.ts";
import {runQuery} from "../../../lib/queries.ts";
import {ALL_FIELDS,isBareListing,validateFilters,wantsAllListingFields,YEAR_LABELS,type YearBasis} from "../../../lib/contracts.ts";
import {body,json,failure} from "../../../lib/http.ts";
import {emptyResultFeedback,normalizeProjectLocation} from "../../../lib/project-lookup.ts";
import {amountOnlyQuestion,amountQueryFilters,amountResultMessage,projectAmountCondition} from "../../../lib/amount-query.ts";
export async function POST(request:Request){try{
  const input=await body(request);const db=database();if(!await isInitialized(db))return json({error:"模拟数据正在准备，请稍后重试。"},503);
  let filters;let method="manual";let notes:string[]=[];
  const question=typeof input.question==="string"?input.question:"";
  const condition=projectAmountCondition(question);
  const amount=amountOnlyQuestion(question,condition)?condition:null;
  const base=(amount||isBareListing(question))&&input.baseFilters?validateFilters(input.baseFilters):null;
  if(amount){
    filters=await amountQueryFilters(db,base,amount);method="rules";
    if(wantsAllListingFields(question))filters.fields=[...ALL_FIELDS];
  }else if(base&&isBareListing(question)){
    filters={...base,fields:[...ALL_FIELDS]};method="rules";
  }else if(typeof input.question==="string"){
    const hint=input.yearBasis===null?null:typeof input.yearBasis==="string"&&Object.hasOwn(YEAR_LABELS,input.yearBasis)?input.yearBasis as YearBasis:null;
    const parsed=await parseQuestion(input.question,hint,modelEnv());if(parsed.clarification)return json({needsClarification:true,clarification:parsed.clarification,parserMethod:parsed.method});
    filters=await normalizeProjectLocation(db,parsed.filters);method=parsed.method;notes=parsed.notes;
  }else filters=validateFilters(input.filters);
  const result=await runQuery(db,filters,Number(input.page??1),20);
  const emptyFeedback=result.totalRows===0?await emptyResultFeedback(db,result.filters):undefined;
  const queryMessage=amount?amountResultMessage(amount,result,!!base):undefined;
  return json({...result,parserMethod:method,notes,emptyFeedback,queryMessage});
}catch(error){return failure(error);}}
