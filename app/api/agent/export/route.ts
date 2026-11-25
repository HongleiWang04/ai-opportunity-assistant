import {database} from "../../../../lib/database.ts";
import {checkedExport} from "../../../../lib/agent.ts";
import {exportFilename} from "../../../../lib/excel.ts";
import {body,json,failure} from "../../../../lib/http.ts";
import {getChatGPTUser} from "../../../chatgpt-auth";
export async function POST(request:Request){try{
  const input=await body(request);if(typeof input.sessionId!=="string"||typeof input.resultId!=="string")return json({error:"缺少任务结果编号。"},400);
  const owner=(await getChatGPTUser())?.userId??"owner-private-service";
  const file=await checkedExport(database(),owner,input.sessionId,input.resultId,input.prepareIfNeeded===true);
  return new Response(file.bytes.buffer as ArrayBuffer,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="opportunities.xlsx"; filename*=UTF-8''${encodeURIComponent(exportFilename(file.result))}`,"Cache-Control":"no-store","X-Export-Row-Count":String(file.result.totalRows),"X-Export-Sheet-Count":String(file.sheets.length),"X-Content-Type-Options":"nosniff"}});
}catch(error){return failure(error);}}
