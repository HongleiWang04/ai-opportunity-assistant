"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import {Sparkles,Search,Database,FileSpreadsheet,SlidersHorizontal,Download,Check,ChevronDown,LoaderCircle,X,Building2,CalendarDays,BriefcaseBusiness,MapPin,Trash2} from "lucide-react";
import {ALL_FIELDS,DEFAULT_FIELDS,DEFAULT_YEAR_BASIS,STAGES,TEAM_OPTIONS,YEAR_LABELS,emptyFilters,type Filters,type QueryResult} from "../lib/contracts.ts";
import {DATASET_COUNT,DATASET_AS_OF} from "../lib/dataset.ts";
import type {AgentEvent,AgentStep} from "../lib/agent-contracts.ts";

type Meta={ready:boolean;recordCount:number;asOf:string;aiReady:boolean;agentReady?:boolean;};
type Result=QueryResult&{parserMethod?:string;notes?:string[];emptyFeedback?:string;queryMessage?:string};
type QueryResponse=Result&{needsClarification?:boolean;clarification?:string;};
const SAMPLE="我需要一份预计2026年成交的民办校团队在途商机（商机进度为20%-80%），包含负责人、所在团队、项目名称、客户名称、是否需要招投标、预计成交日期、预计挂网日期、项目金额，导出Excel。";
const EXAMPLES:{label:string;text:string;agentOnly?:boolean}[]=[{label:"民办校在途商机",text:SAMPLE},{label:"教育分团队导出",text:"查询教育事业群预计2026年成交的在途商机，按团队分别整理，需要招投标但缺少预计挂网日期的项目单独列出，导出Excel。",agentOnly:true},{label:"基教团队商机",text:"查询基教团队预计2026年成交的全部在途商机，进度20%至80%，导出Excel。"},{label:"医疗已赢单项目",text:"查询医疗团队2026年创建的已赢单商机，包含负责人、所在团队、项目名称、客户名称、项目金额、预计成交日期。"}];
const ROBOT_AVATAR="/avatars/robot.png";
const CHAT_ROBOT_AVATAR="/avatars/chat-robot.webp";
const USER_AVATARS=["blue","green","pink","yellow","purple","teal","orange"].map(color=>`/avatars/chat-${color}.webp`);
const money=(value:number)=>new Intl.NumberFormat("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
async function post<T=QueryResponse>(request:typeof fetch,path:string,value:unknown):Promise<T>{const response=await request(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});const data=await response.json() as T&{error?:string};if(!response.ok)throw new Error(data.error??"请求未完成，请重试。");return data;}

type WorkspaceProps={request?:typeof fetch;basePath?:string;publicDemo?:boolean};

export default function OpportunityWorkspace({request=fetch,basePath="/",publicDemo=false}:WorkspaceProps){
  const avatarSrc=(file:string)=>basePath+file.slice(1);
  const [meta,setMeta]=useState<Meta|null>(null);const [starting,setStarting]=useState(true);const [question,setQuestion]=useState("");
  const [result,setResult]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false);const [exporting,setExporting]=useState(false);const [error,setError]=useState("");const [toast,setToast]=useState("");
  const [edit,setEdit]=useState(false);const [draft,setDraft]=useState<Filters>({...emptyFilters(),team:"民办校团队"});
  const [clarification,setClarification]=useState("");const [history,setHistory]=useState<string[]>([]);
  const [userAvatar,setUserAvatar]=useState<string>();
  const [sessionId,setSessionId]=useState<string|null>(null);const [agentResultId,setAgentResultId]=useState<string|null>(null);
  const [agentSteps,setAgentSteps]=useState<AgentStep[]>([]);const [agentMessage,setAgentMessage]=useState("");
  const [conversation,setConversation]=useState<{role:"user"|"assistant";text:string}[]>([]);const [choices,setChoices]=useState<string[]>([]);
  const [replyActions,setReplyActions]=useState<{label:string;question:string}[]>([]);const resultRef=useRef<HTMLElement>(null);const revealResult=useRef(false);
  const conversationRef=useRef<HTMLDivElement>(null);const followConversation=useRef(true);
  const tableScrollRef=useRef<HTMLDivElement>(null);const revealField=useRef<string|null>(null);const [recentFields,setRecentFields]=useState<string[]>([]);
  useEffect(()=>{let active=true;async function load(){try{let response=await request("/api/meta");let data=await response.json() as Meta&{error?:string};if(!response.ok)throw new Error(data.error??"数据连接未完成。");
    if(!data.ready){let cursor=0;for(let attempt=0;attempt<10;attempt++){const step=await post<{done:boolean;nextCursor:number}>(request,"/api/initialize",{cursor});if(step.done)break;cursor=step.nextCursor;if(attempt===9)throw new Error("数据准备尚未完成，请刷新重试。");}response=await request("/api/meta");data=await response.json() as Meta;if(!response.ok||!data.ready)throw new Error("数据准备尚未完成，请刷新重试。");}
    if(active)setMeta(data);
  }catch(e){if(active)setError((e as Error).message);}finally{if(active)setStarting(false);}}load();return()=>{active=false};},[request]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),5000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{const log=conversationRef.current;if(log&&followConversation.current)log.scrollTop=log.scrollHeight;},[conversation]);
  useEffect(()=>{if(revealResult.current&&resultRef.current){resultRef.current.scrollIntoView({block:"start"});revealResult.current=false;}const scroll=tableScrollRef.current;if(!scroll||!revealField.current)return;const field=revealField.current;const header=[...scroll.querySelectorAll<HTMLElement>("thead th")].find(node=>node.dataset.field===field);if(header)scroll.scrollLeft=Math.max(0,scroll.scrollLeft+header.getBoundingClientRect().left-scroll.getBoundingClientRect().left-16);revealField.current=null;},[result]);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();document.querySelector("textarea")?.focus();}if(e.key==="Escape"){setEdit(false);}};window.addEventListener("keydown",handler);return()=>window.removeEventListener("keydown",handler);},[]);
  function resetTask(){setSessionId(null);setAgentResultId(null);setAgentSteps([]);setAgentMessage("");setConversation([]);setChoices([]);setReplyActions([]);setResult(null);setClarification("");setError("");setQuestion("");}
  async function executeAgent(input:Record<string,unknown>){
    const text=String(input.question);const fresh=input.newTask===true;
    if(fresh||conversation.length===0){
      const options=USER_AVATARS.filter(avatar=>avatar!==userAvatar);
      setUserAvatar(options[Math.floor(Math.random()*options.length)]);
    }
    setBusy(true);setError("");setClarification("");setChoices([]);setReplyActions([]);setAgentSteps([]);setAgentMessage("");followConversation.current=true;
    if(fresh){setSessionId(null);setAgentResultId(null);setResult(null);setConversation([{role:"user",text}]);}else setConversation(old=>[...old,{role:"user",text}] as typeof old);
    let completed=false;
    try{
      const response=await request("/api/agent",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:text,sessionId:fresh?null:sessionId,baseFilters:!fresh&&!sessionId?result?.filters:undefined})});
      if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error??"Agent任务未完成。");}
      if(!response.body)throw new Error("任务连接未建立，请重试。");
      const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";
      function event(value:AgentEvent){
        if(value.type==="session")setSessionId(value.sessionId);
        else if(value.type==="step")setAgentSteps(old=>old.some(step=>step.id===value.step.id)?old.map(step=>step.id===value.step.id?value.step:step):[...old,value.step]);
        else if(value.type==="error")throw new Error(value.message);
        else if(value.type==="complete"){
          completed=true;const reply=value.reply;setSessionId(reply.sessionId);setAgentSteps(reply.steps);setAgentMessage(reply.message);setAgentResultId(reply.resultId??null);setReplyActions(reply.actions??[]);revealResult.current=reply.steps.some(step=>step.tool==="list_current_subset")&&!reply.clarification;
          setConversation(old=>reply.history?reply.history.map(item=>({role:item.role,text:item.content})):[...old,{role:"assistant",text:reply.message}] as typeof old);setClarification(reply.clarification??"");setChoices(reply.choices??[]);
          if(reply.result){const added=!fresh&&result?reply.result.fields.filter(field=>!result.fields.includes(field)):[];setRecentFields(added);revealField.current=added[0]??null;setResult({...reply.result,parserMethod:"agent"});setDraft(reply.result.filters);setEdit(false);}
          setHistory(old=>[text,...old.filter(q=>q!==text)].slice(0,3));setQuestion("");
        }
      }
      while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value??new Uint8Array(),{stream:!chunk.done});let split;while((split=buffer.indexOf("\n\n"))>=0){const block=buffer.slice(0,split);buffer=buffer.slice(split+2);const line=block.split("\n").find(row=>row.startsWith("data: "));if(line)event(JSON.parse(line.slice(6)) as AgentEvent);}if(chunk.done)break;}
      if(!completed)throw new Error("任务连接提前结束，请重试或开始新任务。");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function execute(input:Record<string,unknown>,keep=false){
    if(busy||starting)return;if(typeof input.question==="string"&&meta?.agentReady){await executeAgent(input);return;}
    setBusy(true);setError("");setClarification("");if(!keep){setResult(null);setSessionId(null);setAgentResultId(null);setAgentSteps([]);setAgentMessage("");setConversation([]);setChoices([]);}
    const queryText=typeof input.question==="string"?input.question:undefined;
    const queryInput=queryText&&result&&input.newTask!==true?{...input,baseFilters:result.filters}:input;
    try{const data=await post(request,"/api/query",queryInput);if(data.needsClarification){setClarification(data.clarification??"请补充查询条件。");return;}
      setResult({...data,parserMethod:keep&&sessionId?"agent":data.parserMethod});setDraft(data.filters);setEdit(false);
      if(queryText){setHistory(old=>[queryText,...old.filter(x=>x!==queryText)].slice(0,3));setQuestion("");}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function submit(event?:FormEvent){event?.preventDefault();if(question.trim().length>=2)execute({question:question.trim()});}
  function example(text:string){execute({question:text,newTask:true});}
  async function download(){if(!result||exporting||busy)return;setExporting(true);setError("");try{
    const response=await request(agentResultId&&sessionId?"/api/agent/export":"/api/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(agentResultId&&sessionId?{sessionId,resultId:agentResultId,prepareIfNeeded:true}:{filters:result.filters})});
    if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error??"导出未完成，请重试。");}
    const blob=await response.blob();const disposition=response.headers.get("content-disposition")??"";
    const name=disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1];const url=URL.createObjectURL(blob);const anchor=document.createElement("a");
    anchor.href=url;anchor.download=name?decodeURIComponent(name):"商机清单.xlsx";document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    setToast(`已导出全部${response.headers.get("x-export-row-count")??result.totalRows}条商机，包含${result.fields.length}个字段。`);
  }catch(e){setError((e as Error).message);}finally{setExporting(false);}}
  function chooseField(field:string){setDraft(f=>({...f,fields:f.fields.includes(field)?f.fields.filter(x=>x!==field):[...f.fields,field]}));}
  function openEdit(){if(result)setDraft(structuredClone(result.filters));setEdit(true);}
  const pages=result?Math.max(1,Math.ceil(result.totalRows/result.pageSize)):1;
  const visibleExamples=EXAMPLES.filter(x=>!x.agentOnly||meta?.agentReady);
  const stageText=result?result.filters.stageMin===result.filters.stageMax?`${result.filters.stageMin}%`:`${result.filters.stageMin}%—${result.filters.stageMax}%`:"";

  return <div className="workspace">
    <aside className="sidebar">
      <a className="brand" href={basePath} aria-label="商机助手首页"><span className="brand-icon"><img src={avatarSrc(ROBOT_AVATAR)} alt="" width={43} height={43}/></span><span><strong>商机助手</strong><small>SALES WORKSPACE</small></span></a>
      <div className="nav-label">工作空间</div><div className="nav-item active"><Search size={19}/><span>商机查询</span></div>
      <section className="sidebar-section history" aria-labelledby="history-title">
        <div id="history-title" className="nav-label">历史对话</div>
        {history.length?history.map(q=>(
          <div className="history-item" key={q}>
            <button className="history-query" title={q} disabled={busy} onClick={()=>example(q)}><span className="history-line"/><span>{q}</span></button>
            <button type="button" className="history-delete" aria-label={`删除历史对话：${q}`} title="删除历史对话" onClick={()=>setHistory(items=>items.filter(item=>item!==q))}><Trash2 size={15} aria-hidden="true"/></button>
          </div>
        )):<p className="nav-label">暂无查询记录</p>}
      </section>
      <div className="sidebar-bottom"><span className="owner-avatar">HL</span><div><strong>个人项目工作空间</strong><span>所有业务数据均为模拟</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span className="mobile-brand"><img src={avatarSrc(ROBOT_AVATAR)} alt="" width={24} height={24}/> 商机查询</span><span className="desktop-breadcrumb"><strong>商机查询</strong></span></div><div className="snapshot"><CalendarDays size={15}/><span>数据截至 {meta?.asOf??DATASET_AS_OF}</span></div></header>
      <main className="content">
        <section className="hero"><div><h1>查阅商机数据</h1><p>按项目、团队或时间查询已有记录，核对后导出 Excel。</p></div><div className="dataset-overview"><Database size={22}/><div><strong>{(meta?.recordCount??DATASET_COUNT).toLocaleString()}</strong><span>条模拟商机 · 2024年至今</span></div></div></section>
        <section className="ask-card" aria-label="商机查询输入">
          <form onSubmit={submit}><div className="ask-title"><span className="purple-spark"><Sparkles size={19}/></span><h2>{sessionId?"继续补充这项任务":"这次，你想查什么？"}</h2><span className="mode-badge">{starting?<><LoaderCircle size={13} className="spin"/> 数据准备中</>:meta?.agentReady?<><Sparkles size={13}/> 千问 Agent</>:meta?.aiReady?<>千问解析</>:<>{publicDemo?"公开演示 · 规则解析":"规则解析"}</>}</span></div>
            <textarea aria-label="输入商机查询需求" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={1800} placeholder={clarification?"输入你的补充说明":sessionId?"例如：加上项目阶段":"例如：查今年的在途商机"} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();submit();}}}/>
            <p className="dialogue-hint">{publicDemo?"公开演示使用浏览器内的模拟数据库，可沿用当前清单按金额筛选并导出 Excel。":"可直接描述要查的商机，条件不明确时助手会追问。"}</p>
            <div className="ask-toolbar">
              <div className="submit-wrap">{(sessionId||(publicDemo&&result))&&<button type="button" className="secondary" disabled={busy} onClick={resetTask}>新任务</button>}<span className="keyboard-hint">Ctrl + Enter</span><button className="primary" disabled={busy||starting||!meta||question.trim().length<2} type="submit">{busy?<LoaderCircle size={17} className="spin"/>:<Sparkles size={17}/>}<span>{busy?"正在执行任务":"生成商机清单"}</span></button></div>
            </div></form>
          <div className="examples-row"><span>试着查</span>{visibleExamples.map(x=><button key={x.label} onClick={()=>example(x.text)} disabled={busy||starting}>{x.label}</button>)}<button className="manual-link" onClick={openEdit}>直接选择条件</button></div>
        </section>
        <div className="flow-hint"><span className="flow-stage"><Check size={14}/> 描述需求</span><span className="flow-divider"/><span className={result?"flow-stage":""}>核对筛选条件</span><span className="flow-divider"/><span>下载 Excel 清单</span></div>
        {(agentSteps.length>0||conversation.length>0)&&<section className="agent-panel" aria-label="Agent任务进度"><div className="agent-panel-heading"><h2><Sparkles size={18}/>任务执行记录</h2><span className={`task-state ${busy?"working":clarification?"waiting":""}`}>{busy?"正在处理":error?"需要重试":clarification?"等你确认":"已完成"}</span></div><div className="conversation-heading"><span>完整对话 · {conversation.length}条记录</span><span>上下滚动查看历史</span></div><div className="conversation" ref={conversationRef} role="log" aria-label="对话记录" tabIndex={0} onScroll={e=>{const log=e.currentTarget;followConversation.current=log.scrollHeight-log.clientHeight-log.scrollTop<48;}}>{conversation.map((item,i)=><div className={`conversation-item ${item.role}`} key={i}><span className="conversation-avatar"><img src={avatarSrc(item.role==="user"?userAvatar??USER_AVATARS[0]:CHAT_ROBOT_AVATAR)} alt={item.role==="user"?"你":"助手"} width={34} height={34}/></span><p>{item.text}</p></div>)}</div>{!busy&&replyActions.length>0&&<div className="conversation-actions">{replyActions.map(action=><button key={action.question} onClick={()=>execute({question:action.question})}><FileSpreadsheet size={16}/>{action.label}</button>)}</div>}{agentSteps.length>0&&<details className="execution-details" open={busy||!!error}><summary><span><Check size={14}/>查看执行明细 · {agentSteps.filter(step=>step.status==="done").length}步已完成</span><ChevronDown size={16}/></summary><ol className="agent-steps">{agentSteps.map(step=><li className={step.status} key={step.id}><span className="step-icon">{step.status==="running"?<LoaderCircle size={16} className="spin"/>:step.status==="done"?<Check size={16}/>:<X size={16}/>}</span><div><strong>{step.title}</strong>{step.summary&&<p>{step.summary}</p>}</div></li>)}</ol></details>}{!busy&&agentMessage&&!clarification&&<p className="sr-only" aria-live="polite">{agentMessage}</p>}</section>}
        {error&&<div className="notice error" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={()=>setError("")}><X size={16}/></button></div>}
        {clarification&&<div className="notice clarification" role="status"><div><strong>需要补充一项信息</strong><p>{clarification}</p><p>在上方输入框继续回答即可，已确认条件会保留。</p>{choices.length>0&&<div className="clarification-choices">{choices.map(choice=><button key={choice} onClick={()=>{execute({question:choice});}}>{choice}</button>)}</div>}</div></div>}
        {edit&&<section className="filter-editor"><div className="editor-heading"><h2><SlidersHorizontal size={18}/>调整筛选条件</h2><button aria-label="关闭筛选条件" onClick={()=>setEdit(false)}><X size={18}/></button></div>
          <div className="filter-grid"><label>所在团队<span className="select-wrap"><select value={draft.team??""} onChange={e=>setDraft(f=>({...f,team:e.target.value||null,businessGroup:null}))}><option value="">全部团队</option>{TEAM_OPTIONS.map(t=><option key={t}>{t}</option>)}</select><ChevronDown size={15}/></span></label>
            <label>{YEAR_LABELS[draft.yearBasis??DEFAULT_YEAR_BASIS]}的年份<input aria-label="查询年份" type="number" min={2000} max={2100} placeholder="全部年份" value={draft.year??""} onChange={e=>setDraft(f=>({...f,year:e.target.value?Number(e.target.value):null,yearBasis:f.yearBasis??DEFAULT_YEAR_BASIS}))}/></label>
            <label>项目阶段<div className="stage-inputs"><span className="select-wrap"><select aria-label="阶段下限" value={draft.stageMin} onChange={e=>setDraft(f=>({...f,stageMin:Number(e.target.value)}))}>{STAGES.map(n=><option key={n} value={n}>{n}%</option>)}</select><ChevronDown size={13}/></span><span>至</span><span className="select-wrap"><select aria-label="阶段上限" value={draft.stageMax} onChange={e=>setDraft(f=>({...f,stageMax:Number(e.target.value)}))}>{STAGES.map(n=><option key={n} value={n}>{n}%</option>)}</select><ChevronDown size={13}/></span></div></label>
            <label>业绩承诺<span className="select-wrap"><select value={draft.commitment??""} onChange={e=>setDraft(f=>({...f,commitment:e.target.value||null}))}><option value="">不限</option>{["力争","确保","冲刺"].map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={15}/></span></label>
            <label>招投标<span className="select-wrap"><select value={draft.tender===null?"":String(draft.tender)} onChange={e=>setDraft(f=>({...f,tender:e.target.value===""?null:e.target.value==="true"}))}><option value="">不限</option><option value="true">需要招投标</option><option value="false">不需要招投标</option></select><ChevronDown size={15}/></span></label>
            <label>项目名称<input maxLength={180} value={draft.projectName??""} placeholder="不限" onChange={e=>setDraft(f=>({...f,projectName:e.target.value||null}))}/></label>
            <label>项目编号<input maxLength={32} value={draft.projectId??""} placeholder="不限" onChange={e=>setDraft(f=>({...f,projectId:e.target.value||null}))}/></label>
            <label>项目所在市<input value={draft.city??""} placeholder="全部城市" onChange={e=>setDraft(f=>({...f,city:e.target.value.trim()||null}))}/></label>
            <label>项目金额下限（元）<input type="number" min="0" step="0.01" value={draft.amountMin??""} placeholder="不限" onChange={e=>setDraft(f=>({...f,amountMin:e.target.value?Number(e.target.value):null}))}/></label>
            <label>项目金额上限（元）<input type="number" min="0" step="0.01" value={draft.amountMax??""} placeholder="不限" onChange={e=>setDraft(f=>({...f,amountMax:e.target.value?Number(e.target.value):null}))}/></label>
          </div><div className="fields-heading"><strong>清单字段 <span>已选{draft.fields.length}项，按选择顺序导出</span></strong><button onClick={()=>setDraft(f=>({...f,fields:[...DEFAULT_FIELDS]}))}>恢复默认字段</button></div><div className="field-options">{ALL_FIELDS.map(field=><label key={field}><input type="checkbox" checked={draft.fields.includes(field)} onChange={()=>chooseField(field)}/>{field}</label>)}</div><div className="editor-footer"><p>上级团队包含全部下属团队；阶段范围包含两个端点。</p><button className="primary" disabled={busy||starting||!draft.fields.length} onClick={()=>execute({filters:draft})}>应用条件并查询</button></div>
        </section>}
        {result?<section className="results" ref={resultRef} aria-label="查询结果" aria-busy={busy}>
          <div className="result-heading"><div><div className="result-title"><span className="result-icon"><FileSpreadsheet size={20}/></span><h2>商机清单</h2><span className="result-count">{result.totalRows}条</span></div><p>{result.queryMessage??(result.filters.limit?`当前为排序后的前${result.filters.limit}条，数量、金额及导出均按此范围计算。`:'已按下列条件筛选，导出将包含全部匹配记录。')}</p></div><div className="result-actions"><button className="secondary" onClick={openEdit} disabled={busy}><SlidersHorizontal size={16}/>调整条件</button><button className="primary export" onClick={download} disabled={busy||exporting||!result.totalRows}>{exporting?<LoaderCircle className="spin" size={17}/>:<Download size={17}/>}<span>{exporting?"正在导出":"导出 Excel"}</span></button></div></div>
          <div className="filter-chips"><span><Building2 size={14}/>{result.filters.team??result.filters.businessGroup??"全部团队"}</span>{result.filters.year&&<span><CalendarDays size={14}/>{result.filters.year}年 · {YEAR_LABELS[result.filters.yearBasis!]}</span>}<span><BriefcaseBusiness size={14}/>项目阶段 {stageText}</span>{result.filters.city&&<span className="location-chip"><MapPin size={14}/>{result.filters.city}</span>}{result.filters.province&&<span><MapPin size={14}/>{result.filters.province}</span>}{result.filters.projectName&&<span>项目名称：{result.filters.projectName}</span>}{result.filters.projectId&&<span>项目编号：{result.filters.projectId}</span>}{result.filters.commitment&&<span>承诺：{result.filters.commitment}</span>}{result.filters.tender!==null&&<span>{result.filters.tender?"需要招投标":"不需要招投标"}</span>}<button onClick={openEdit}>{result.fields.length}个字段</button></div>
          {(result.filters.amountMin!=null||result.filters.amountMax!=null)&&<div className="amount-filter-note">项目金额范围：{result.filters.amountMin!=null?money(result.filters.amountMin):"不限"} 至 {result.filters.amountMax!=null?money(result.filters.amountMax):"不限"} 元</div>}
          {(result.filters.customer||result.filters.dateFrom||result.filters.dateTo||result.filters.profitStatus||result.filters.missingPublishOnly||result.filters.sortBy||result.filters.limit)&&<div className="filter-chips business-chips">{result.filters.customer&&<span>客户：{result.filters.customer}</span>}{(result.filters.dateFrom||result.filters.dateTo)&&<span>日期：{result.filters.dateFrom??'不限'} 至 {result.filters.dateTo??'不限'}</span>}{result.filters.profitStatus&&<span>预计利润：{{loss:'负数',break_even:'零',profit:'正数'}[result.filters.profitStatus]}</span>}{result.filters.missingPublishOnly&&<span>仅招投标挂网日期缺失</span>}{result.filters.sortBy&&<span>{{expected_close:'预计成交日期',amount:'项目金额',profit:'预计利润'}[result.filters.sortBy]}{result.filters.sortDirection==='desc'?'降序':'升序'}</span>}{result.filters.limit&&<span>仅前{result.filters.limit}条</span>}</div>}
          <div className="result-summary"><div className="metric-card"><span>匹配商机</span><strong>{result.totalRows.toLocaleString()}<small>个项目</small></strong></div><div className="metric-card"><span>项目金额合计</span><strong>{money(result.totalAmount/10000)}<small>万元</small></strong></div><div className="metric-card"><span>需要招投标</span><strong>{result.tenderCount.toLocaleString()}<small>个项目</small></strong></div></div>
          {result.totalRows?<><div className="table-scroll" ref={tableScrollRef}><table><thead><tr>{result.fields.map(field=><th data-field={field} className={`${/金额|毛利|利润/.test(field)?"numeric ":""}${recentFields.includes(field)?"new-field":""}`} key={field}>{field}{/金额|毛利|利润/.test(field)&&<small>（元）</small>}</th>)}</tr></thead><tbody>{result.rows.map((row,i)=><tr key={result.rowIds[i]}>{result.fields.map(field=><td key={field} className={`${recentFields.includes(field)?"new-field ":""}${/金额|毛利|利润/.test(field)?"numeric":field==="项目名称"?"project-cell":field==="客户名称"?"customer-cell":""}`}>{row[field]===null?<span className="missing" title="不适用或尚未录入">—</span>:field==="是否需要招投标"?<span className={`tender-tag ${row[field]==="是"?"required":""}`}>{String(row[field])}</span>:/金额|毛利|利润/.test(field)?money(Number(row[field])):String(row[field])}</td>)}</tr>)}</tbody></table></div><div className="pagination"><span>第 {(result.page-1)*result.pageSize+1}—{Math.min(result.page*result.pageSize,result.totalRows)} 条，共 {result.totalRows} 条</span><div><span>{result.page} / {pages}</span><button disabled={busy||result.page<=1} onClick={()=>execute({filters:result.filters,page:result.page-1},true)}>上一页</button><button disabled={busy||result.page>=pages} onClick={()=>execute({filters:result.filters,page:result.page+1},true)}>下一页</button></div></div></>:<div className="empty-result"><Search size={30}/><h3>当前条件下没有匹配记录</h3><p>{result.emptyFeedback??(clarification?"可在对话中补充项目全名或编号。":"可调整团队、年份或项目阶段，或按项目编号查询。")}</p><button className="secondary" onClick={openEdit}>调整条件</button></div>}
        </section>:!edit&&<section className={`ready-card ${busy?"is-loading":""}`}><span className="ready-icon">{busy?<LoaderCircle size={29} className="spin"/>:<FileSpreadsheet size={29}/>}</span><h2>{starting?"正在准备模拟数据":busy?"正在整理你的商机清单":"从业务问题，到可用清单"}</h2><p>{busy?"正在核对条件并查询匹配商机，请稍候。":"清单会展示在这里。你可以先核对条件，再下载完整 Excel。"}</p><div className="ready-features"><span><Check size={14}/>查询下属团队</span><span><Check size={14}/>自选导出字段</span><span><Check size={14}/>完整数据导出</span></div></section>}
        <footer className="content-footer"><span><Database size={14}/>2024—2026年模拟商机 · 用于产品功能演示</span></footer>
      </main>
    </div>
    {toast&&<div className="toast" role="status"><Check size={18}/>{toast}</div>}
  </div>;
}
