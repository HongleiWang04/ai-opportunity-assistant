import {validateFilters,type Filters} from "./contracts.ts";
import type {Database} from "./queries.ts";
import {DEFAULT_EXPORT_PLAN,type AgentContext,type ExportPlan,type QualitySummary} from "./agent-contracts.ts";

const TTL=2*60*60*1000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type SessionRecord={id:string;revision:number;context:AgentContext;};
export type StoredResult={id:string;sessionId:string;filters:Filters;fingerprint:string;checkedFingerprint:string|null;quality:QualitySummary|null;plan:ExportPlan|null;};
export function freshContext(filters:Filters|null=null):AgentContext{return {filters,lastResultId:null,exportPlan:{...DEFAULT_EXPORT_PLAN},history:[]};}
export async function openSession(db:Database,owner:string,id?:string|null,baseFilters?:unknown):Promise<SessionRecord>{
  if(id){if(!uuid.test(id))throw new Error("会话编号不正确，请开始新任务。");const row=await db.prepare("SELECT * FROM agent_sessions WHERE session_id=? AND owner_key=?").bind(id,owner).first();if(!row||Date.now()-Number(row.updated_at)>TTL)throw new Error("会话已过期或不可访问，请开始新任务。");return {id,revision:Number(row.revision),context:JSON.parse(String(row.context_json))};}
  const sessionId=crypto.randomUUID();const context=freshContext(baseFilters?validateFilters(baseFilters):null);
  await db.batch([db.prepare("INSERT INTO agent_sessions(session_id,owner_key,context_json,revision,updated_at) VALUES(?,?,?,0,?)").bind(sessionId,owner,JSON.stringify(context),Date.now())]);
  return {id:sessionId,revision:0,context};
}
export async function saveSession(db:Database,owner:string,session:SessionRecord){
  const changed=await db.batch([db.prepare("UPDATE agent_sessions SET context_json=?,revision=revision+1,updated_at=? WHERE session_id=? AND owner_key=? AND revision=?").bind(JSON.stringify(session.context),Date.now(),session.id,owner,session.revision)]) as {meta?:{changes?:number}}[];
  if(changed[0]?.meta?.changes===0)throw new Error("会话已被另一条任务更新，请开始新任务后重试。");session.revision++;
}
export async function saveResult(db:Database,owner:string,sessionId:string,filters:Filters,fingerprint:string){const id=crypto.randomUUID();await db.batch([db.prepare("INSERT INTO agent_results(result_id,session_id,owner_key,filters_json,fingerprint,created_at) VALUES(?,?,?,?,?,?)").bind(id,sessionId,owner,JSON.stringify(filters),fingerprint,Date.now())]);return id;}
export async function loadResult(db:Database,owner:string,sessionId:string,id:string):Promise<StoredResult>{
  if(!uuid.test(id)||!uuid.test(sessionId))throw new Error("结果编号不正确，请重新查询。");
  const row=await db.prepare("SELECT r.* FROM agent_results r JOIN agent_sessions s ON s.session_id=r.session_id WHERE r.result_id=? AND r.session_id=? AND r.owner_key=? AND s.owner_key=?").bind(id,sessionId,owner,owner).first();
  if(!row||Date.now()-Number(row.created_at)>TTL)throw new Error("结果已过期或不可访问，请重新查询。");
  return {id,sessionId,filters:validateFilters(JSON.parse(String(row.filters_json))),fingerprint:String(row.fingerprint),checkedFingerprint:row.checked_fingerprint?String(row.checked_fingerprint):null,quality:row.quality_json?JSON.parse(String(row.quality_json)):null,plan:row.export_plan_json?JSON.parse(String(row.export_plan_json)):null};
}
export async function markChecked(db:Database,id:string,fingerprint:string,quality:QualitySummary){await db.batch([db.prepare("UPDATE agent_results SET checked_fingerprint=?,quality_json=?,export_plan_json=NULL WHERE result_id=? AND fingerprint=?").bind(fingerprint,JSON.stringify(quality),id,fingerprint)]);}
export async function markExportReady(db:Database,id:string,plan:ExportPlan){await db.batch([db.prepare("UPDATE agent_results SET export_plan_json=? WHERE result_id=? AND checked_fingerprint=fingerprint").bind(JSON.stringify(plan),id)]);}
