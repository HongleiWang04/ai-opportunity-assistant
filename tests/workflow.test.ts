import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";
import {mkdirSync,writeFileSync} from "node:fs";
import {parseRules,parseQuestion} from "../lib/parse.ts";
import {emptyFilters,validateFilters,DEFAULT_FIELDS,ALL_FIELDS,type Filters} from "../lib/contracts.ts";
import {runQuery,type Database,type D1Statement} from "../lib/queries.ts";
import {workbookBytes,exportFilename} from "../lib/excel.ts";

const source=fileURLToPath(new URL("../data/opportunities_demo.sqlite",import.meta.url));
const conn=new DatabaseSync(source,{readOnly:true});
const database:Database={prepare(sql:string){let args:unknown[]=[];const statement=conn.prepare(sql);const wrapped:D1Statement={bind(...values){args=values;return wrapped;},async first(){return statement.get(...args as never[]) as Record<string,unknown>??null;},async all(){return {results:statement.all(...args as never[]) as Record<string,unknown>[]};}};return wrapped;},async batch(){throw new Error("read-only test adapter");}};
const question="我需要一份2026民办校团队所有的在途商机（商机进度为20%-80%）的名单，包含字段如下：负责人，所在团队，项目名称，客户名称，是否需要招投标，预计成交日期、预计挂网日期、项目金额，导出Excel";
const parsed=parseRules(question,"expected_close");
const fixture=()=>({...emptyFilters(),team:"民办校团队",year:2026,yearBasis:"expected_close"} as Filters);

test("原始业务问题提取八个字段及年份口径",()=>{assert.equal(parsed.filters.team,"民办校团队");assert.equal(parsed.filters.year,2026);assert.equal(parsed.filters.yearBasis,"expected_close");assert.deepEqual(parsed.filters.fields,DEFAULT_FIELDS);assert.equal(parsed.filters.tender,null);});
test("示例SQL完整结果为47条，网页首页20条",async()=>{const result=await runQuery(database,parsed.filters);assert.equal(result.totalRows,47);assert.equal(result.rows.length,20);assert.equal(result.fields.length,8);});
test("分页无重复或遗漏，导出全量47条",async()=>{const results=await Promise.all([1,2,3].map(page=>runQuery(database,fixture(),page)));assert.deepEqual(results.map(r=>r.rows.length),[20,20,7]);const full=await runQuery(database,fixture(),1,20,true);assert.deepEqual(results.flatMap(r=>r.rowIds),full.rowIds);assert.equal(new Set(full.rowIds).size,47);});
test("20%和80%端点均被包含，90%和100%排除",async()=>{const f={...fixture(),fields:["项目阶段"]};const r=await runQuery(database,f,1,20,true);const stages=r.rows.map(x=>x["项目阶段"]);assert.equal(stages.filter(x=>x==="20%").length,13);assert.equal(stages.filter(x=>x==="80%").length,12);assert(!stages.includes("90%"));assert(!stages.includes("100%"));});
test("基教团队包含A至E市的1529条商机",async()=>{const r=await runQuery(database,{...emptyFilters(),team:"基教团队",stageMin:0,stageMax:100},1,20,true);assert.equal(r.totalRows,1529);assert.equal(new Set(r.rows.map(x=>x["所在团队"])).size,5);});
test("教育上级团队包含3117条下级商机",async()=>{const r=await runQuery(database,{...emptyFilters(),team:"教育",stageMin:0,stageMax:100});assert.equal(r.totalRows,3117);});
test("创建年份2026完整1800条，不混用预计成交年份",async()=>{const r=await runQuery(database,{...emptyFilters(),year:2026,yearBasis:"created",stageMin:0,stageMax:100});assert.equal(r.totalRows,1800);assert.equal(parseRules("2026年创建的医疗商机","expected_close").filters.yearBasis,"created");});
test("自然语言年份默认按创建日期，展示列不改变口径",()=>{assert.equal(parseRules("查询2026年民办校在途商机，包含预计成交日期").filters.yearBasis,"created");assert.equal(parseRules("查询2026年中标的民办校商机").filters.yearBasis,"bid_award");assert.throws(()=>validateFilters({...fixture(),yearBasis:null}),/年份/);});
test("已赢单只取100%，数据库共3068条",async()=>{const f=parseRules("查询全部已赢单商机").filters;assert.equal(f.stageMin,100);assert.equal(f.stageMax,100);const r=await runQuery(database,f);assert.equal(r.totalRows,3068);});
test("承诺和招投标条件正常提取",()=>{const f=parseRules("查询民办校团队确保且不需要招投标的在途商机").filters;assert.equal(f.commitment,"确保");assert.equal(f.tender,false);});
test("不存在年份返回真实空结果",async()=>{const r=await runQuery(database,{...fixture(),year:2098});assert.equal(r.totalRows,0);assert.equal(r.totalAmount,0);assert.deepEqual(r.rows,[]);});
test("未知团队和注入字符串不进入SQL",()=>{assert.throws(()=>validateFilters({...fixture(),team:"民办校团队' OR 1=1 --"}),/未找到团队/);assert.throws(()=>validateFilters({...fixture(),fields:["项目金额; DROP TABLE opportunities"]}),/不支持的字段/);});
test("非法阶段、承诺和分页被拒绝",async()=>{assert.throws(()=>validateFilters({...fixture(),stageMin:90,stageMax:20}),/下限/);assert.throws(()=>validateFilters({...fixture(),commitment:"保底"}),/业绩承诺/);await assert.rejects(()=>runQuery(database,fixture(),0),/分页/);});
test("删除、更新及原因预测请求不伪装成查询",()=>{assert.throws(()=>parseRules("删除民办校团队的全部商机"),/不执行数据修改/);assert.throws(()=>parseRules("分析民办校商机流失原因"),/不推断/);});
test("导出字段保持用户指定顺序",async()=>{const f=parseRules("查询2026年民办校在途商机，只要项目金额、项目名称、项目编号","expected_close").filters;assert.deepEqual(f.fields,["项目金额","项目名称","项目编号"]);const r=await runQuery(database,f);assert.deepEqual(Object.keys(r.rows[0]),f.fields);});
test("缺失挂网日期保留null，金额保留数值",async()=>{const r=await runQuery(database,fixture(),1,20,true);assert(r.rows.some(row=>row["预计挂网日期"]===null));assert(r.rows.every(row=>typeof row["项目金额"]==="number"));const cents=r.rows.reduce((sum,row)=>sum+Math.round(Number(row["项目金额"])*100),0);assert.equal(cents,Math.round(r.totalAmount*100));});
test("只读数据库不能删除商机",()=>{assert.throws(()=>conn.exec("DELETE FROM opportunities"),/readonly/);});
test("模型未配置时明确返回rules，生成有效Excel包",async()=>{const p=await parseQuestion(question,"expected_close",{});assert.equal(p.method,"rules");const r=await runQuery(database,p.filters,1,20,true);const bytes=workbookBytes(r);assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);assert.equal(exportFilename(r),"2026年民办校团队在途商机清单.xlsx");mkdirSync(new URL("../outputs/",import.meta.url),{recursive:true});writeFileSync(new URL("../outputs/2026年民办校团队在途商机清单.xlsx",import.meta.url),bytes);writeFileSync(new URL("../outputs/export-reference.json",import.meta.url),JSON.stringify(r));});
test("真实模型适配只提取条件，服务返回401时不静默伪装为AI成功",async()=>{const previous=globalThis.fetch;try{globalThis.fetch=async()=>new Response("upstream failure",{status:401});await assert.rejects(()=>parseQuestion(question,"expected_close",{QWEN_API_KEY:"test-secret",QWEN_BASE_URL:"https://provider.example/v1"}),/鉴权失败/);}finally{globalThis.fetch=previous;}});
test("模型返回结构化条件后仍校验字段和SQL边界",async()=>{const previous=globalThis.fetch;try{let captured="";globalThis.fetch=async(_url,init)=>{captured=String(init?.body);return Response.json({choices:[{message:{content:JSON.stringify({filters:fixture(),clarification:null})}}]});};const p=await parseQuestion(question,"expected_close",{QWEN_API_KEY:"test-secret",QWEN_BASE_URL:"https://provider.example/v1",QWEN_MODEL:"qwen-flash"});assert.equal(p.method,"qwen");assert.equal(p.filters.team,"民办校团队");assert(!captured.includes("合肥市明德"));assert.equal(p.filters.fields.length,8);}finally{globalThis.fetch=previous;}});

test.after(()=>conn.close());
