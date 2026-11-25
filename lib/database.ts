import {env} from "cloudflare:workers";
import seed from "../data/seed.json";
import type {Database} from "./queries.ts";
import {DATASET_VERSION} from "./dataset.ts";
export function database():Database{const db=(env as unknown as {DB?:Database}).DB;if(!db)throw new Error("数据库连接尚未就绪。");return db;}
export function modelEnv(){return env as unknown as {QWEN_API_KEY?:string;QWEN_BASE_URL?:string;QWEN_MODEL?:string};}
export async function isInitialized(db:Database){const row=await db.prepare("SELECT metadata_value FROM dataset_metadata WHERE metadata_key='dataset_version'").first();return row?.metadata_value===DATASET_VERSION;}
export async function initialize(db:Database,cursor:number){if(!Number.isInteger(cursor)||cursor<0||cursor>=seed.length)throw new Error("初始化参数不正确。");const stop=Math.min(cursor+20,seed.length);await db.batch(seed.slice(cursor,stop).map(sql=>db.prepare(sql)));return {done:stop===seed.length,nextCursor:stop===seed.length?null:stop,completed:stop,total:seed.length};}
