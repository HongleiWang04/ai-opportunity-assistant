import {database,isInitialized,modelEnv} from "../../../lib/database.ts";
import {runAgent} from "../../../lib/agent.ts";
import {qwenToolCaller} from "../../../lib/agent-model.ts";
import {YEAR_LABELS,type YearBasis} from "../../../lib/contracts.ts";
import {body,json,failure} from "../../../lib/http.ts";
import {getChatGPTUser} from "../../chatgpt-auth";
export async function POST(request:Request){
  try{
    const input=await body(request);if(typeof input.question!=="string")return json({error:"请输入业务需求。"},400);
    const db=database();if(!await isInitialized(db))return json({error:"模拟数据尚未准备完成。"},503);
    const owner=(await getChatGPTUser())?.userId??"owner-private-service";
    const hint=typeof input.yearBasis==="string"&&Object.hasOwn(YEAR_LABELS,input.yearBasis)?input.yearBasis as YearBasis:null;
    const encoder=new TextEncoder();const cancellation=new AbortController();const stream=new ReadableStream({start(controller){
      let closed=false;const emit=(event:unknown)=>{if(!closed){try{controller.enqueue(encoder.encode("data: "+JSON.stringify(event)+"\n\n"));}catch{closed=true;}}};
      void runAgent({db,owner,question:input.question as string,yearHint:hint,sessionId:typeof input.sessionId==="string"?input.sessionId:null,baseFilters:input.baseFilters,model:qwenToolCaller(modelEnv()),emit,signal:AbortSignal.any([request.signal,cancellation.signal])}).catch(error=>{const message=error instanceof Error?error.message:"任务未完成，请重试。";emit({type:"error",message:/SQLITE|D1_|no such table|FOREIGN KEY|database/i.test(message)?"数据服务暂时不可用，请稍后重试。":message});}).finally(()=>{if(!closed){closed=true;controller.close();}});
    },cancel(){cancellation.abort();}});
    return new Response(stream,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-store","X-Content-Type-Options":"nosniff","X-Accel-Buffering":"no"}});
  }catch(error){return failure(error);}
}
