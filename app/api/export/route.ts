import {database,isInitialized} from "../../../lib/database.ts";
import {runQuery} from "../../../lib/queries.ts";
import {workbookBytes,exportFilename} from "../../../lib/excel.ts";
import {body,json,failure} from "../../../lib/http.ts";
export async function POST(request:Request){try{
  const input=await body(request);const db=database();if(!await isInitialized(db))return json({error:"模拟数据尚未准备完成。"},503);
  const result=await runQuery(db,input.filters,1,20,true);const bytes=workbookBytes(result);
  return new Response(bytes.buffer as ArrayBuffer,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="opportunities.xlsx"; filename*=UTF-8''${encodeURIComponent(exportFilename(result))}`,"Cache-Control":"no-store","X-Export-Row-Count":String(result.totalRows),"X-Content-Type-Options":"nosniff"}});
}catch(error){return failure(error);}}
