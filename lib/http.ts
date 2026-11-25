export function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
export async function body(request:Request):Promise<Record<string,unknown>>{
  const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new Error("请求来源不正确。");
  if(Number(request.headers.get("content-length")??0)>20000)throw new Error("请求内容过长。");const text=await request.text();if(text.length>20000)throw new Error("请求内容过长。");
  let parsed;try{parsed=JSON.parse(text);}catch{throw new Error("请求格式不正确。");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("请求格式不正确。");return parsed;
}
export function failure(error:unknown){const message=error instanceof Error?error.message:"请求未完成。";if(/SQLITE|D1_|no such table|database|binding|SQL syntax|FOREIGN KEY/i.test(message)){console.error("opportunity_database_request_failed");return json({error:"数据服务暂时不可用，请稍后重试。"},503);}return json({error:message},400);}
