export type ToolCall={id:string;type:"function";function:{name:string;arguments:string}};
export type ModelMessage={role:"system"|"user"|"assistant"|"tool";content:string|null;tool_calls?:ToolCall[];tool_call_id?:string};
export type ModelTurn={content:string|null;tool_calls?:ToolCall[]};
export type ModelCallOptions={toolName?:string};
export type ModelCaller=(messages:ModelMessage[],tools:unknown[],signal?:AbortSignal,options?:ModelCallOptions)=>Promise<ModelTurn>;
export type ModelEnv={QWEN_API_KEY?:string;QWEN_BASE_URL?:string;QWEN_MODEL?:string};
export function qwenToolCaller(env:ModelEnv):ModelCaller {
  // Hosted bindings can be request-scoped; snapshot primitives before returning
  // the streaming response rather than reading its environment during later rounds.
  const apiKey=env.QWEN_API_KEY?.trim();
  const base=env.QWEN_BASE_URL?.trim().replace(/\/+$/,"");
  const model=env.QWEN_MODEL?.trim()||"qwen-flash";
  return async(messages,tools,signal,options)=>{
    if(!apiKey||!base)throw new Error("Agent需要配置千问接口；仍可使用直接选择条件进行基础查询。");
    let response:Response;try{response=await fetch(base+"/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages,tools,tool_choice:options?.toolName?{type:"function",function:{name:options.toolName}}:"auto",parallel_tool_calls:false,temperature:0,enable_thinking:false,max_tokens:1500}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});}catch{throw new Error("模型连接中断或超时，可以重试该任务。");}
    if(!response.ok){
      const info=await response.json().catch(()=>null) as {error?:{code?:unknown};code?:unknown}|null;
      const rawCode=info?.error?.code??info?.code;const code=typeof rawCode==="string"&&/^[A-Za-z0-9_.-]{1,60}$/.test(rawCode)&&!rawCode.startsWith('sk-')?`，${rawCode}`:"";
      if(response.status===401)throw new Error(`千问鉴权失败（HTTP 401${code}），请核对后端接口配置。`);
      if(response.status===403)throw new Error(`千问拒绝该请求（HTTP 403${code}），请核对工作空间访问权限。`);
      if(response.status===429)throw new Error("模型调用暂时受限，请稍后重试。");throw new Error(`千问服务异常（${response.status}${code}）。`);
    }
    const data=await response.json() as {choices?:{message?:ModelTurn}[]};const message=data.choices?.[0]?.message;if(!message||(!message.tool_calls?.length&&!message.content))throw new Error("模型没有返回有效操作，请重试。");return {content:message.content??null,tool_calls:message.tool_calls};
  };
}
