import {database,isInitialized,modelEnv} from "../../../lib/database.ts";
import {aiReady} from "../../../lib/parse.ts";
import {AS_OF,TEAM_OPTIONS,GROUPS,ALL_FIELDS} from "../../../lib/contracts.ts";
import {json,failure} from "../../../lib/http.ts";
export async function GET(){try{const db=database();const ready=await isInitialized(db);const count=ready?Number((await db.prepare("SELECT COUNT(*) AS n FROM opportunities").first())?.n??0):0;return json({ready,recordCount:count,asOf:AS_OF,allSimulated:true,aiReady:aiReady(modelEnv()),agentReady:aiReady(modelEnv()),parserMode:aiReady(modelEnv())?"agent":"rules",teams:TEAM_OPTIONS,groups:GROUPS,fields:ALL_FIELDS});}catch(error){return failure(error);}}
