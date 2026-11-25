import {ALL_FIELDS,isBareListing,validateFilters,wantsAllListingFields} from "../lib/contracts.ts";
import {amountOnlyQuestion,amountQueryFilters,amountResultMessage,projectAmountCondition} from "../lib/amount-query.ts";
import {DATASET_AS_OF, DATASET_COUNT} from "../lib/dataset.ts";
import {workbookBytes, exportFilename} from "../lib/excel.ts";
import {parseRules} from "../lib/parse.ts";
import {emptyResultFeedback, knownProjectCity, normalizeProjectLocation} from "../lib/project-lookup.ts";
import {runQuery, type Database, type D1Statement} from "../lib/queries.ts";
import {followUpStageQuery,namedWinCity,stageFollowUpFilters,stageFollowUpMessage} from "../lib/stage-query.ts";

type SQLiteValue=string|number|null|Uint8Array;
type SQLiteStatement={
  bind(values: SQLiteValue[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
};
type SQLiteDatabase={
  run(sql: string): void;
  prepare(sql: string): SQLiteStatement;
  close(): void;
};
type SQLiteInit=(options: {locateFile: (name: string) => string}) => Promise<{
  Database: new (data: Uint8Array) => SQLiteDatabase;
}>;

let connection: Promise<Database>|undefined;
async function openDatabase(): Promise<Database> {
  const directory = new URL("./assets/", document.baseURI);
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("sql-wasm.js", directory).href;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("无法加载 SQLite，请刷新后重试。"));
    document.head.appendChild(script);
  });
  const init = (window as Window & {initSqlJs?: SQLiteInit}).initSqlJs;
  if (!init) throw new Error("SQLite 尚未就绪。");
  const [engine, response] = await Promise.all([
    init({locateFile: name => new URL(name,directory).href}),
    fetch(new URL("opportunities_demo.sqlite", directory)),
  ]);
  if (!response.ok) throw new Error("无法加载模拟商机库，请刷新后重试。");
  const db = new engine.Database(new Uint8Array(await response.arrayBuffer()));
  db.run("PRAGMA query_only=ON");
  return {
    prepare(sql) {
      let values: SQLiteValue[] = [];
      const statement: D1Statement = {
        bind(...args) {
          values = args as SQLiteValue[];
          return statement;
        },
        async first() {
          const query = db.prepare(sql);
          try {
            query.bind(values);
            return query.step() ? query.getAsObject() : null;
          } finally { query.free(); }
        },
        async all() {
          const query = db.prepare(sql);
          try {
            query.bind(values);
            const results: Record<string, unknown>[] = [];
            while (query.step()) results.push(query.getAsObject());
            return {results};
          } finally { query.free(); }
        },
      };
      return statement;
    },
    async batch() { throw new Error("公开演示采用只读数据库。"); },
  };
}

export const demoRequest: typeof fetch = async (path, init) => {
  try {
    const db = await (connection ??= openDatabase().catch(error => {
      connection = undefined;
      throw error;
    }));
    if (path === "/api/meta") {
      return Response.json({ready:true,recordCount:DATASET_COUNT,asOf:DATASET_AS_OF,agentReady:false,aiReady:false});
    }
    const input = JSON.parse(String(init?.body ?? "{}"));
    if (path === "/api/query") {
      const question=typeof input.question==="string"?input.question:"";
      const condition=projectAmountCondition(question);
      const amount=amountOnlyQuestion(question,condition)?condition:null;
      const prior=question&&input.baseFilters?validateFilters(input.baseFilters):null;
      const stage=followUpStageQuery(question,prior);
      const base=(amount||isBareListing(question))?prior:null;
      const parsed=question&&!amount&&!stage?parseRules(question):null;
      let filters=amount?await amountQueryFilters(db,base,amount):
        stage?await stageFollowUpFilters(db,stage):
        parsed?await normalizeProjectLocation(db,base?{...base,fields:[...ALL_FIELDS]}:parsed.filters):validateFilters(input.filters);
      if(amount&&wantsAllListingFields(question))filters={...filters,fields:[...ALL_FIELDS]};
      const mentionedCity=namedWinCity(question);
      if(mentionedCity){
        const city=await knownProjectCity(db,mentionedCity);
        if(!city)throw new Error("请核对赢单项目所在的城市。");
        filters={...filters,city};
      }
      const result = await runQuery(db,filters,Number(input.page ?? 1),20);
      const emptyFeedback = result.totalRows === 0 ? await emptyResultFeedback(db,filters) : undefined;
      const queryMessage=amount?amountResultMessage(amount,result,!!base):stage?await stageFollowUpMessage(db,stage,result):undefined;
      return Response.json({...result,parserMethod:parsed?.method??(amount||stage?"rules":"manual"),notes:parsed?.notes,emptyFeedback,queryMessage});
    }
    if (path === "/api/export") {
      const result = await runQuery(db,input.filters,1,20,true);
      const bytes = workbookBytes(result);
      return new Response(bytes.buffer as ArrayBuffer,{headers:{
        "Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(exportFilename(result))}`,
        "X-Export-Row-Count":String(result.totalRows),
      }});
    }
    return Response.json({error:"这个查询入口不存在。"}, {status:404});
  } catch (error) {
    return Response.json({error: error instanceof Error ? error.message : "请求未完成，请重试。"}, {status:400});
  }
};
