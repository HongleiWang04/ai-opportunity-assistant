import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {ALL_FIELDS,DEFAULT_FIELDS,emptyFilters,type Filters} from "../lib/contracts.ts";
import {runAgent,checkedExport,mergeAgentFilters,dataFingerprint,guardTask} from "../lib/agent.ts";
import {openSession,saveSession} from "../lib/agent-store.ts";
import {qwenToolCaller,type ModelCaller,type ModelMessage} from "../lib/agent-model.ts";
import {summarizeResult} from "../lib/agent-summary.ts";
import {fieldEditPlan} from "../lib/field-edit.ts";
import {previousSummary} from "../lib/result-subset.ts";
import type {Database,D1Statement} from "../lib/queries.ts";

const conn=new DatabaseSync(":memory:");conn.exec("PRAGMA foreign_keys=ON");
conn.exec(readFileSync(new URL("../drizzle/0000_heavy_wong.sql",import.meta.url),"utf8"));
conn.exec(readFileSync(new URL("../drizzle/0001_calm_dazzler.sql",import.meta.url),"utf8"));
for(const sql of JSON.parse(readFileSync(new URL("../data/seed.json",import.meta.url),"utf8")))conn.exec(sql);
type Bound=D1Statement&{run:()=>unknown};
const db:Database={prepare(sql){let args:unknown[]=[];const statement=conn.prepare(sql);const wrapped:Bound={bind(...values){args=values;return wrapped;},async first(){return statement.get(...args as never[]) as Record<string,unknown>??null;},async all(){return {results:statement.all(...args as never[]) as Record<string,unknown>[]};},run(){return statement.run(...args as never[]);}};return wrapped;},async batch(statements){conn.exec('BEGIN');try{const results=statements.map(s=>({meta:{changes:Number(((s as Bound).run() as {changes:number}).changes)}}));conn.exec('COMMIT');return results;}catch(error){conn.exec('ROLLBACK');throw error;}}};
const fixture={...emptyFilters(),team:"民办校团队",year:2026,yearBasis:"expected_close"} as Filters;
type Action={name:string;args:Record<string,unknown>|((messages:ModelMessage[])=>Record<string,unknown>)};
function latestId(messages:ModelMessage[]){for(const m of [...messages].reverse()){if(m.role==='tool'){const value=JSON.parse(m.content!);if(value.result_id)return value.result_id as string;}}throw new Error('Missing real result_id');}
function scripted(actions:Action[]):ModelCaller {let n=0;return async messages=>{const action=actions[n++];if(!action)return {content:'完成'};return {content:null,tool_calls:[{id:'call_'+n,type:'function',function:{name:action.name,arguments:JSON.stringify(typeof action.args==='function'?action.args(messages):action.args)}}]};};}
const query=(filters:Record<string,unknown>,extra:Record<string,unknown>={}):Action=>({name:'query_opportunities',args:{filters,...extra}});
const check:Action={name:'check_result',args:m=>({result_id:latestId(m)})};
const exportFile=(plan:Record<string,unknown>={}):Action=>({name:'export_excel',args:m=>({result_id:latestId(m),...plan})});
const options=(question:string,model:ModelCaller)=>({db,owner:'qa-owner',question,yearHint:'expected_close' as const,model});
const noModel:ModelCaller=async()=>{throw new Error("明确金额或清单无需调用模型");};

test('北京赢单后追问剩余项目，保留城市并严格筛出未赢单且大于40%的项目',async()=>{
  const first=await runAgent(options('帮我查一下北京的赢单项目有哪些',scripted([query({city:'北京'}),check])));
  assert.equal(first.result?.totalRows,1);
  assert.equal(first.result?.filters.city,'北京市');
  const next=await runAgent({...options('剩下的都是未赢单吗，阶段大于40%的有多少',noModel),sessionId:first.sessionId});
  const expected=conn.prepare("SELECT project_id FROM opportunities WHERE city='北京市' AND project_stage>40 AND project_stage<100 ORDER BY expected_close_date,project_id").all().map(row=>row.project_id);
  assert.equal(expected.length,4);
  assert.deepEqual(next.result?.rowIds,expected);
  assert.equal(next.result?.filters.stageMin,60);
  assert.equal(next.result?.filters.stageMax,90);
  assert.match(next.message,/其余 10 个项目均未赢单/);
  assert.match(next.message,/60% 有 1 个、80% 有 1 个、90% 有 2 个/);
  const file=await checkedExport(db,'qa-owner',next.sessionId,next.resultId!,true);
  assert.deepEqual(file.result.rowIds,expected);
});

test('在当前北京赢单清单查未赢单不会扩大范围，剩余项目的阶段边界可显式包含',async()=>{
  const first=await runAgent(options('查询北京的已赢单项目',scripted([query({city:'北京市'}),check])));
  const within=await runAgent({...options('这些项目中未赢单的有几个',noModel),sessionId:first.sessionId});
  assert.equal(within.result?.totalRows,0);
  const second=await runAgent(options('查询北京的已赢单项目',scripted([query({city:'北京市'}),check])));
  const inclusive=await runAgent({...options('剩下的都是未赢单吗，阶段大于等于40%的有多少',noModel),sessionId:second.sessionId});
  assert.equal(inclusive.result?.totalRows,6);
  assert.match(inclusive.message,/40% 有 2 个/);
});

test('上海当前清单的金额追问按 SQL 筛选，不沿用此前的城市统计',async()=>{
  const city={...emptyFilters(),city:'上海市'};
  const first=await runAgent(options('查询上海市在途商机',scripted([query(city),check])));
  assert.equal(first.result?.totalRows,6);
  const prior=await runAgent({...options('这些项目有几个在上海',scripted([{name:'summarize_current_result',args:{dimension:'city',value:'上海市',result_id:first.resultId}}])),sessionId:first.sessionId});
  assert.match(prior.message,/上海市.*6个/);
  const reply=await runAgent({...options('金额在100万以上的有几个，哪几个',noModel),sessionId:first.sessionId});
  const expected=conn.prepare("SELECT project_id FROM opportunities WHERE city='上海市' AND project_stage BETWEEN 20 AND 80 AND project_amount_cents>=100000000 ORDER BY expected_close_date, project_id").all().map(row=>row.project_id);
  assert.equal(expected.length,4);
  assert.deepEqual(reply.result?.rowIds,expected);
  assert.deepEqual(reply.result?.fields,ALL_FIELDS);
  assert.match(reply.message,/100 万元及以上.*4 个.*分别是/);
  assert.equal(reply.modelCalls,0);
  const repeated=await runAgent({...options('项目金额在100万以上的有几个',noModel),sessionId:first.sessionId});
  assert.deepEqual(repeated.result?.rowIds,expected);
  const file=await checkedExport(db,'qa-owner',repeated.sessionId,repeated.resultId!,true);
  assert.deepEqual(file.result.rowIds,expected);
});

test('大于排除恰好100万，以上包含，默认清单显示十八个字段',async()=>{
  const inclusive=await runAgent(options('项目金额在100万以上的有哪些',noModel));
  const strict=await runAgent(options('项目金额大于100万的有几个',noModel));
  const {n}=conn.prepare("SELECT count(*) AS n FROM opportunities WHERE project_amount_cents=100000000").get() as {n:number};
  assert(n>0);
  assert.equal(inclusive.result!.totalRows-strict.result!.totalRows,n);
  assert.equal(strict.result?.filters.amountMin,1000000.01);
  const plain=await runAgent(options('有哪些商机',noModel));
  assert.equal(plain.result?.totalRows,5600);
  assert.deepEqual(plain.result?.fields,ALL_FIELDS);
});

test('金额追问不会让排序后的前 N 条吸入范围外的新项目',async()=>{
  const filters={...emptyFilters(),city:'上海市',sortBy:'amount',sortDirection:'asc',limit:2};
  const first=await runAgent(options('查询上海市在途商机，按项目金额从小到大取前2条',scripted([query(filters),check])));
  assert.equal(first.result?.totalRows,2);
  const reply=await runAgent({...options('其中金额在100万以上的有几个',noModel),sessionId:first.sessionId});
  assert.equal(reply.result?.totalRows,0);
  assert.match(reply.message,/有 0 个/);
});

test('未知项目给出真实同城统计，补充编号后返回登记的项目阶段',async()=>{
  const first=await runAgent({...options('帮我查一下济南太白湖项目阶段',scripted([query({city:'济南',customer:'太白湖'}),check])),yearHint:null});
  const {n}=conn.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE city='济南市'").get() as {n:number};
  assert.equal(first.result?.totalRows,0);
  assert.equal(first.result?.filters.projectName,'太白湖');
  assert.match(first.message,new RegExp(`济南市「太白湖」.*${n} 个济南市项目记录`));
  assert.match(first.message,/补充项目全名、项目编号/);
  assert(first.clarification);
  const reply=await runAgent({...options('MOCK-2024-00001',scripted([query({}),check])),yearHint:null,sessionId:first.sessionId});
  assert.deepEqual(reply.result?.rowIds,['MOCK-2024-00001']);
  assert.deepEqual(reply.result?.fields,['项目名称','项目编号','项目阶段']);
  assert.equal(reply.result?.filters.projectName,undefined);
  assert.match(reply.message,/MOCK-2024-00001.*项目阶段为 \d+%/);
});

test('普通年份按创建日期筛选，追问指定预计成交日期时切换',async()=>{
  const question='查询2026年民办校在途商机，包含项目名称、预计成交日期';
  const first=await runAgent({...options(question,scripted([query(fixture),check])),yearHint:null});
  assert.equal(first.result?.filters.yearBasis,'created');
  assert.equal(first.clarification,undefined);
  assert.deepEqual(first.result?.fields,['项目名称','预计成交日期']);
  const reply=await runAgent({...options('改按预计成交日期筛选，其他不变',scripted([query({}),check])),yearHint:null,sessionId:first.sessionId});
  assert.equal(reply.result?.filters.yearBasis,'expected_close');
  assert.equal(reply.result?.totalRows,47);
  assert.deepEqual(reply.result?.fields,first.result?.fields);
});

test('Agent实际执行查询、校验和导出三个工具，原始示例47条',async()=>{const reply=await runAgent(options('导出2026年民办校团队在途商机Excel',scripted([query(fixture),check,exportFile()])));assert.equal(reply.result?.totalRows,47);assert(reply.exportReady);assert.equal(reply.modelCalls,3);assert.deepEqual(reply.steps.map(s=>s.tool),['query_opportunities','check_result','export_excel']);assert(reply.quality?.passed);const file=await checkedExport(db,'qa-owner',reply.sessionId,reply.resultId!);mkdirSync(new URL('../outputs/',import.meta.url),{recursive:true});writeFileSync(new URL('../outputs/agent-basic.xlsx',import.meta.url),file.bytes);writeFileSync(new URL('../outputs/agent-ui-basic.json',import.meta.url),JSON.stringify(reply));});
test('多轮条件继承：确保档及新增编号不改变2026和阶段范围',async()=>{const first=await runAgent(options('查询2026年教育事业群在途商机，包含'+DEFAULT_FIELDS.join('、'),scripted([query({...fixture,team:'教育',businessGroup:'教育'}),check])));const second=await runAgent({...options('只保留民办校团队、确保档，再加上项目编号',scripted([query({team:'民办校团队',commitment:'确保',year:null,stageMin:0,stageMax:100},{add_fields:['项目编号']}),check])),sessionId:first.sessionId});assert.equal(second.result?.filters.year,2026);assert.equal(second.result?.filters.stageMin,20);assert.equal(second.result?.filters.stageMax,80);assert.equal(second.result?.filters.commitment,'确保');assert.deepEqual(second.result?.fields,[...DEFAULT_FIELDS,'项目编号']);const count=conn.prepare("SELECT COUNT(*) n FROM opportunities WHERE team_id=7 AND expected_close_date>='2026-01-01' AND expected_close_date<'2027-01-01' AND project_stage BETWEEN 20 AND 80 AND performance_commitment='确保'").get() as {n:number};assert.equal(second.result?.totalRows,count.n);writeFileSync(new URL('../outputs/agent-ui-followup.json',import.meta.url),JSON.stringify(second));});
test('组合任务按团队分表，专项表不缩小主清单范围',async()=>{const reply=await runAgent(options('查询2026年教育事业群在途商机，按团队分表，将需要招投标但缺少挂网日期的单列，导出Excel',scripted([{name:'get_business_context',args:{}},query({...fixture,team:'教育',businessGroup:'教育'}),check,exportFile({split_by:'team',include_missing_publish_sheet:true})])));assert.equal(reply.result?.filters.tender,null);assert(reply.quality!.missingPublishCount>0);assert(Object.keys(reply.quality!.teamCounts).length>1);const file=await checkedExport(db,'qa-owner',reply.sessionId,reply.resultId!);assert(file.sheets.some(s=>s.name==='招投标挂网日期缺失'));const teamSheets=file.sheets.filter(s=>Object.hasOwn(reply.quality!.teamCounts,s.name));assert.equal(teamSheets.reduce((n,s)=>n+s.rows,0),reply.result!.totalRows);writeFileSync(new URL('../outputs/agent-grouped.xlsx',import.meta.url),file.bytes);writeFileSync(new URL('../outputs/agent-ui-grouped.json',import.meta.url),JSON.stringify(reply));writeFileSync(new URL('../outputs/agent-grouped-reference.json',import.meta.url),JSON.stringify({count:reply.result!.totalRows,fields:reply.result!.fields,missing:reply.quality!.missingPublishCount,teams:reply.quality!.teamCounts,sheets:file.sheets}));});
test('关键定义缺失时暂停，回答后继续原任务',async()=>{const first=await runAgent(options('查询2026年民办校团队的重点在途商机',scripted([{name:'ask_user',args:{question:'重点商机按多少金额筛选？',choices:['100万元以上','200万元以上']}}])));assert(first.clarification);assert(!first.result);const nextModel=scripted([query({...fixture,amountMin:1000000}),check]);const next=await runAgent({...options('金额100万元以上',async(messages,tools,signal)=>{assert(messages.some(m=>m.content?.includes('2026年民办校团队')));return nextModel(messages,tools,signal);}),sessionId:first.sessionId});assert.equal(next.result?.filters.amountMin,1000000);assert(next.result!.rows.every(r=>Number(r['项目金额'])>=1000000));});
test('导出前未校验会反馈错误，模型补做校验后恢复',async()=>{const reply=await runAgent(options('导出2026年民办校商机Excel',scripted([query(fixture),exportFile(),check,exportFile()])));assert(reply.exportReady);assert.equal(reply.steps[1].status,'error');assert.match(reply.steps[1].summary!,/check_result/);assert.equal(reply.steps[2].status,'done');});
test('无数据时保留原条件并说明如何继续查询',async()=>{const reply=await runAgent(options('查询2098年民办校商机',scripted([query({...fixture,year:2098}),check])));assert.equal(reply.result?.totalRows,0);assert.equal(reply.result?.filters.year,2098);assert(!reply.exportReady);assert.match(reply.message,/请核对年份、团队或项目阶段/);});
test('不同用户不能访问同一会话或下载结果',async()=>{const reply=await runAgent(options('查询民办校在途商机',scripted([query(fixture),check])));await assert.rejects(()=>openSession(db,'other-owner',reply.sessionId),/不可访问/);await assert.rejects(()=>checkedExport(db,'other-owner',reply.sessionId,reply.resultId!,true),/不可访问/);});
test('追加条件后旧结果不能继续导出',async()=>{const first=await runAgent(options('导出民办校在途商机',scripted([query(fixture),check,exportFile()])));await runAgent({...options('只保留确保档',scripted([query({commitment:'确保'}),check])),sessionId:first.sessionId});await assert.rejects(()=>checkedExport(db,'qa-owner',first.sessionId,first.resultId!),/条件已更新/);});
test('数据指纹发生变化时阻止陈旧文件下载',async()=>{const reply=await runAgent(options('导出民办校在途商机',scripted([query(fixture),check,exportFile()])));const id=reply.result!.rowIds[0];conn.prepare('UPDATE opportunities SET project_name=project_name||? WHERE project_id=?').run('（临时测试）',id);try{await assert.rejects(()=>checkedExport(db,'qa-owner',reply.sessionId,reply.resultId!),/数据发生变化/);}finally{conn.prepare("UPDATE opportunities SET project_name=REPLACE(project_name,'（临时测试）','') WHERE project_id=?").run(id);}});
test('非法工具最多纠错两次，业务数据保持5600条',async()=>{await assert.rejects(()=>runAgent(options('查询民办校商机',scripted([{name:'execute_sql',args:{sql:'DELETE FROM opportunities'}},{name:'shell',args:{command:'delete'}}]))),/工具操作未完成/);assert.equal((conn.prepare('SELECT COUNT(*) n FROM opportunities').get() as {n:number}).n,5600);});
test('没有有效结果时最多8轮，不伪造任务成功',async()=>{let n=0;await assert.rejects(()=>runAgent(options('查询民办校商机',async()=>({content:null,tool_calls:[{id:'call_'+(++n),type:'function',function:{name:'get_business_context',arguments:'{}'}}]}))),/尚未完成/);assert.equal(n,8);});
test('增量合并不接受原始SQL或未声明字段',()=>{assert.throws(()=>mergeAgentFilters(fixture,{sql:'SELECT *'},'只保留民办校','expected_close'),/不支持/);assert.throws(()=>mergeAgentFilters(fixture,{amountMin:-1},'金额条件','expected_close'),/非负/);assert.throws(()=>guardTask('删除全部商机'),/不修改/);});
test('会话版本检查阻止并发覆盖',async()=>{const a=await openSession(db,'revision-owner');const b=await openSession(db,'revision-owner',a.id);a.context.history.push({role:'user',content:'first'});await saveSession(db,'revision-owner',a);await assert.rejects(()=>saveSession(db,'revision-owner',b),/另一条任务/);});
test('真实工具模型适配发送tools并处理401，无静默回退',async()=>{const old=globalThis.fetch;try{let payload:Record<string,unknown>={};globalThis.fetch=async(_u,init)=>{payload=JSON.parse(String(init?.body));return Response.json({choices:[{message:{content:null,tool_calls:[{id:'call_actual',type:'function',function:{name:'get_business_context',arguments:'{}'}}]}}]});};const result=await qwenToolCaller({QWEN_API_KEY:'test-secret',QWEN_BASE_URL:'https://example.test/v1'})([{role:'user',content:'查询'}],[{type:'function'}]);assert(result.tool_calls?.length);assert(Array.isArray(payload.tools));assert.equal(payload.parallel_tool_calls,false);globalThis.fetch=async()=>new Response('',{status:401});await assert.rejects(()=>qwenToolCaller({QWEN_API_KEY:'test-secret',QWEN_BASE_URL:'https://example.test/v1'})([],[]),/鉴权失败/);}finally{globalThis.fetch=old;}});

test('专项表的招投标条件不会缩小主清单，明确主筛选时则保留',()=>{const request='查询2026年教育事业群在途商机，按团队分别整理，需要招投标但缺少预计挂网日期的项目单独列出，导出Excel';assert.equal(mergeAgentFilters(null,{...fixture,team:'教育',tender:true},request,'expected_close').tender,null);const explicit='只查询2026年教育事业群需要招投标的在途商机，将缺少挂网日期的单独列出';assert.equal(mergeAgentFilters(null,{...fixture,team:'教育',tender:true},explicit,'expected_close').tender,true);});
test('已确认的承诺和金额条件不被新增字段重置',()=>{const base={...fixture,commitment:'确保',amountMin:1000000} as Filters;const next=mergeAgentFilters(base,{commitment:null,amountMin:null},'再加上项目编号','expected_close',['项目编号']);assert.equal(next.commitment,'确保');assert.equal(next.amountMin,1000000);assert.equal(next.year,2026);});
test('新任务不会采用模型擅加的金额门槛，澄清前的真实金额要求仍保留',async()=>{const reply=await runAgent(options('查询2026年教育事业群在途商机，按团队分别整理，导出Excel',scripted([query({...fixture,team:null,businessGroup:'教育',amountMin:1000000}),check,exportFile({split_by:'team'})])));assert.equal(reply.result?.filters.amountMin,undefined);assert.equal(reply.result?.totalRows,205);const first=await runAgent({...options('查询民办校金额100万元以上的商机',scripted([{name:'ask_user',args:{question:'按哪个年份查询？'}}])),yearHint:null});const next=await runAgent({...options('按2026年预计成交日期',scripted([query({...fixture,amountMin:1000000}),check])),sessionId:first.sessionId});assert.equal(next.result?.filters.amountMin,1000000);assert.equal(next.result?.totalRows,17);});
test('A市追问统计完整清单并解释团队口径，原文件仍可下载',async()=>{const initial=await runAgent(options('导出2026年教育事业群在途商机',scripted([query({...fixture,team:null,businessGroup:'教育'}),check,exportFile({split_by:'team'})])));const reply=await runAgent({...options('这些项目有几个是A市的',scripted([{name:'summarize_current_result',args:{result_id:initial.resultId,dimension:'city',value:'A市'}}])),sessionId:initial.sessionId});assert.equal(reply.resultId,initial.resultId);assert.deepEqual(reply.result?.filters,initial.result?.filters);assert.equal(reply.result?.totalRows,205);assert.match(reply.message,/项目所在市为“A市”的有0个/);assert.match(reply.message,/“基教A市团队”，则有24个/);assert(reply.exportReady);assert.equal(reply.steps[0].tool,'summarize_current_result');assert.equal(reply.history?.length,4);const file=await checkedExport(db,'qa-owner',reply.sessionId,initial.resultId!);assert.equal(file.result.totalRows,205);writeFileSync(new URL('../outputs/agent-ui-summary.json',import.meta.url),JSON.stringify(reply));});
test('实际城市、招投标和团队分布均按当前完整结果统计，不限预览20行',async()=>{const initial=await runAgent(options('查询2026年教育事业群在途商机',scripted([query({...fixture,team:null,businessGroup:'教育'}),check])));const expected=(conn.prepare("SELECT count(*) n FROM opportunities p JOIN teams t ON t.team_id=p.team_id JOIN business_groups g ON g.business_group_id=t.business_group_id WHERE g.business_group_name='教育' AND expected_close_date>='2026-01-01' AND expected_close_date<'2027-01-01' AND project_stage BETWEEN 20 AND 80 AND city='青岛市'").get() as {n:number}).n;const city=await runAgent({...options('这些项目有几个在青岛市',scripted([{name:'summarize_current_result',args:{result_id:initial.resultId,dimension:'city',value:'青岛市'}}])),sessionId:initial.sessionId});assert.match(city.message,new RegExp(`青岛市”的有${expected}个`));assert(expected>0);const tender=await runAgent({...options('其中有多少需要招投标',scripted([{name:'summarize_current_result',args:{result_id:initial.resultId,dimension:'tender',value:'是'}}])),sessionId:initial.sessionId});assert.match(tender.message,/有153个/);const teams=await runAgent({...options('这些项目按团队统计分布',scripted([{name:'summarize_current_result',args:{result_id:initial.resultId,dimension:'team'}}])),sessionId:initial.sessionId});assert.match(teams.message,/基教A市团队 24个/);assert.match(teams.message,/民办校团队 47个/);assert.equal(teams.resultId,initial.resultId);});
test('统计追问不能误调用查询缩小清单，模型可纠正为统计工具',async()=>{const initial=await runAgent(options('查询教育事业群2026年在途商机',scripted([query({...fixture,team:null,businessGroup:'教育'}),check])));const reply=await runAgent({...options('这些项目有几个是A市的',scripted([query({team:'基教A市团队'}),{name:'summarize_current_result',args:{result_id:initial.resultId,dimension:'team',value:'A市'}}])),sessionId:initial.sessionId});assert.equal(reply.steps[0].status,'error');assert.equal(reply.steps[1].status,'done');assert.equal(reply.resultId,initial.resultId);assert.equal(reply.result?.totalRows,205);assert.match(reply.message,/则有24个/);});
test('连续对话完整保留超过两轮，模型上下文保持有界',async()=>{const original='查询2026年教育事业群在途商机';let reply=await runAgent(options(original,scripted([query({...fixture,team:null,businessGroup:'教育'}),check])));for(let i=0;i<8;i++){const model=scripted([{name:'summarize_current_result',args:{result_id:reply.resultId,dimension:'team'}}]);reply=await runAgent({...options('这些项目按团队统计分布',async(messages,tools,signal)=>{assert(messages.length<=14);assert(!messages[0].content?.includes('"history":'));return model(messages,tools,signal);}),sessionId:reply.sessionId});}assert.equal(reply.history?.length,18);assert.equal(reply.history?.[0].content,original);const stored=await openSession(db,'qa-owner',reply.sessionId);assert.equal(stored.context.history.length,18);writeFileSync(new URL('../outputs/agent-ui-long-history.json',import.meta.url),JSON.stringify(reply));});
test('未找到城市时返回真实0，城市与同名团队不混淆',()=>{const full={rows:[{'所在团队':'基教A市团队','项目所在市':'青岛市'}],totalRows:1} as never;assert.equal(summarizeResult(full,'city','不存在市').count,0);assert.equal(summarizeResult(full,'city','青岛').count,1);assert.equal(summarizeResult(full,'team','A市').count,1);assert.match(summarizeResult(full,'city','A市').message,/项目所在市为“A市”的有0个/);assert.throws(()=>summarizeResult(full,'unsupported' as never),/不在支持范围/);});
test('明确的统计追问指定统计工具，模型不能仅凭文字回复',async()=>{const initial=await runAgent(options('查询2026年教育事业群在途商机',scripted([query({...fixture,team:null,businessGroup:'教育'}),check])));const action=scripted([{name:'summarize_current_result',args:{result_id:initial.resultId,dimension:'team'}}]);const reply=await runAgent({...options('这些项目按团队统计分布',async(messages,tools,signal,options)=>{assert.equal(options?.toolName,'summarize_current_result');return action(messages,tools,signal,options);}),sessionId:initial.sessionId});assert.match(reply.message,/基教A市团队 24个/);const old=globalThis.fetch;try{globalThis.fetch=async(_url,init)=>{const payload=JSON.parse(String(init?.body));assert.deepEqual(payload.tool_choice,{type:'function',function:{name:'summarize_current_result'}});return Response.json({choices:[{message:{content:null,tool_calls:[{id:'summary-call',type:'function',function:{name:'summarize_current_result',arguments:'{}'}}]}}]});};await qwenToolCaller({QWEN_API_KEY:'test-key',QWEN_BASE_URL:'https://example.test/v1'})([],[],undefined,{toolName:'summarize_current_result'});}finally{globalThis.fetch=old;}});

test('商机阶段与项目阶段新增为实际列，保留医疗102条及创建年份口径',async()=>{const medical={...fixture,team:'医疗',yearBasis:'created',stageMin:100,stageMax:100,fields:['负责人','所在团队','项目名称','客户名称','项目金额','预计成交日期']};const first=await runAgent(options('查询医疗团队2026年创建的已赢单商机，包含'+medical.fields.join('、')+'，导出Excel',scripted([query(medical),check,exportFile()])));assert.equal(first.result?.totalRows,102);const original=await checkedExport(db,'qa-owner',first.sessionId,first.resultId!);const added=await runAgent({...options('加上商机阶段',scripted([{name:'update_result_fields',args:{operation:'add',fields:['项目金额']}}])),sessionId:first.sessionId});assert.deepEqual(added.result?.fields,[...medical.fields,'项目阶段']);assert.equal(added.result?.filters.yearBasis,'created');assert.equal(added.result?.filters.stageMin,100);assert.equal(added.result?.totalRows,102);assert(added.result!.rows.every(row=>row['项目阶段']==='100%'));assert.match(added.message,/新增“项目阶段”列/);const exported=await checkedExport(db,'qa-owner',added.sessionId,added.resultId!);assert.deepEqual(exported.result.rowIds,original.result.rowIds);assert(exported.result.fields.includes('项目阶段'));writeFileSync(new URL('../outputs/fields-ui-initial.json',import.meta.url),JSON.stringify(first));writeFileSync(new URL('../outputs/fields-ui-added.json',import.meta.url),JSON.stringify(added));writeFileSync(new URL('../outputs/fields-stage-export.xlsx',import.meta.url),exported.bytes);const again=await runAgent({...options('加上项目阶段',scripted([{name:'update_result_fields',args:{operation:'add',fields:['项目阶段']}}])),sessionId:added.sessionId});assert.equal(again.result?.fields.filter(f=>f==='项目阶段').length,1);assert.match(again.message,/无需重复添加/);});
test('含义不明确先提问，确认具体日期后再增加列并保留整份清单',async()=>{const first=await runAgent(options('查询2026年民办校在途商机并导出Excel',scripted([query(fixture),check,exportFile()])));const ask=await runAgent({...options('加上时间和商机阶段',scripted([{name:'ask_user',args:{question:'错误猜测',choices:[]}}])),sessionId:first.sessionId});assert(ask.clarification);assert.deepEqual(ask.choices,['预计成交日期','预计挂网日期','中标时间']);assert.equal(ask.resultId,first.resultId);assert.deepEqual(ask.result?.fields,first.result?.fields);await checkedExport(db,'qa-owner',ask.sessionId,ask.resultId!);const reply=await runAgent({...options('第三个',scripted([{name:'update_result_fields',args:{operation:'add',fields:['中标时间']}}])),sessionId:ask.sessionId});assert(reply.result?.fields.includes('项目阶段'));assert(reply.result?.fields.includes('中标时间'));assert.equal(reply.result?.totalRows,47);assert.equal(reply.result?.filters.stageMin,20);assert(!reply.clarification);assert(!(await openSession(db,'qa-owner',reply.sessionId)).context.pendingFieldEdit);writeFileSync(new URL('../outputs/fields-ui-clarify.json',import.meta.url),JSON.stringify(ask));writeFileSync(new URL('../outputs/fields-ui-confirmed.json',import.meta.url),JSON.stringify(reply));});
test('新增字段不再被静默丢弃，模糊字段不凭空生成',()=>{assert.deepEqual(fieldEditPlan('在下面展示部分加上项目阶段字段'),{kind:'edit',operation:'add',fields:['项目阶段']});assert.equal(fieldEditPlan('加上时间')?.kind,'clarify');assert.equal(fieldEditPlan('加上商机阶段和赢率')?.kind,'clarify');assert.equal(fieldEditPlan('调整一下')?.kind,'clarify');assert.equal(fieldEditPlan('只保留民办校团队、确保档，再加上项目编号'),null);assert.equal(mergeAgentFilters({...fixture,yearBasis:'created'},{},'加上项目阶段','expected_close').yearBasis,'created');});
test('初次查询按用户列名展示，模型默认字段和日期口径不覆盖明确要求',()=>{const f=mergeAgentFilters(null,{...fixture,yearBasis:'created',fields:DEFAULT_FIELDS},'查询医疗团队2026年已赢单商机，包含负责人、所在团队、项目名称、客户名称、项目金额、预计成交日期。','expected_close');assert.deepEqual(f.fields,['负责人','所在团队','项目名称','客户名称','项目金额','预计成交日期']);const defaultBasis=mergeAgentFilters(null,{...fixture,yearBasis:'created'},'查询2026年民办校在途商机','expected_close');assert.equal(defaultBasis.yearBasis,'expected_close');});

test('统计青岛3个后说列出来，实际展示3条并只导出这3条',async()=>{const first=await runAgent(options('导出2026年民办校在途商机',scripted([query(fixture),check,exportFile()])));const summary=await runAgent({...options('这些项目有几个在青岛',scripted([{name:'summarize_current_result',args:{result_id:first.resultId,dimension:'city',value:'青岛'}}])),sessionId:first.sessionId});assert.match(summary.message,/有3个/);assert.equal(summary.actions?.[0].label,'单独列出这3个项目');writeFileSync(new URL('../outputs/subset-ui-summary.json',import.meta.url),JSON.stringify(summary));const listed=await runAgent({...options('列出来',async(messages,tools,signal,choice)=>{assert.equal(choice?.toolName,'list_current_subset');return scripted([{name:'list_current_subset',args:{dimension:'city',value:'上海市'}}])(messages,tools,signal);}),sessionId:first.sessionId});assert.equal(listed.result?.totalRows,3);assert.equal(listed.result?.filters.city,'青岛市');assert.equal(listed.result?.filters.year,2026);assert.equal(listed.result?.filters.stageMin,20);assert.equal(listed.result?.filters.stageMax,80);assert.deepEqual(listed.result?.fields,DEFAULT_FIELDS);assert.match(listed.message,/47个项目.*3个项目/);const file=await checkedExport(db,'qa-owner',listed.sessionId,listed.resultId!);assert.equal(file.result.rows.length,3);assert.equal(file.result.filters.city,'青岛市');writeFileSync(new URL('../outputs/subset-ui-listed.json',import.meta.url),JSON.stringify(listed));writeFileSync(new URL('../outputs/subset-qingdao.xlsx',import.meta.url),file.bytes);});
test('不用先统计也能单独列出青岛项目；已有历史会话可承接列出来',async()=>{const first=await runAgent(options('查询2026年民办校在途商机',scripted([query(fixture),check])));const listed=await runAgent({...options('单独列出青岛的项目',scripted([{name:'list_current_subset',args:{}}])),sessionId:first.sessionId});assert.equal(listed.result?.totalRows,3);assert.equal(listed.result?.filters.city,'青岛市');assert.equal(listed.result?.filters.yearBasis,'expected_close');assert.deepEqual(previousSummary([{role:'assistant',content:'当前47个项目中，项目所在市为“青岛市”的有3个，占6.4%。'}],first.resultId!),{resultId:first.resultId,dimension:'city',value:'青岛市',count:3});});
test('无明确指代时先追问；单独列出不能扩大已有城市范围',async()=>{const first=await runAgent(options('查询2026年民办校在途商机',scripted([query(fixture),check])));const ask=await runAgent({...options('列出来',scripted([{name:'list_current_subset',args:{dimension:'city',value:'青岛市'}}])),sessionId:first.sessionId});assert(ask.clarification);assert.equal(ask.resultId,first.resultId);const narrow=await runAgent({...options('单独列出青岛的项目',scripted([{name:'list_current_subset',args:{}}])),sessionId:first.sessionId});const blocked=await runAgent({...options('单独列出上海市的项目',scripted([{name:'list_current_subset',args:{dimension:'city',value:'上海市'}}])),sessionId:first.sessionId});assert(blocked.clarification);assert.equal(blocked.resultId,narrow.resultId);assert.equal(blocked.result?.totalRows,3);});

test.after(()=>conn.close());
test('流式调用前快照环境值，后续环境读取变化不影响鉴权',async()=>{let live=true;const old=globalThis.fetch;try{const env={get QWEN_API_KEY(){return live?'test-session-key':'unavailable';},get QWEN_BASE_URL(){return 'https://provider.example/v1';}};const caller=qwenToolCaller(env);live=false;globalThis.fetch=async(_url,init)=>{assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer test-session-key');return Response.json({choices:[{message:{content:'完成'}}]});};await caller([],[]);}finally{globalThis.fetch=old;}});
