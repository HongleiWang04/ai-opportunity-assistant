import {database,initialize,isInitialized} from "../../../lib/database.ts";
import {body,json,failure} from "../../../lib/http.ts";
export async function POST(request:Request){try{const input=await body(request);const db=database();if(await isInitialized(db))return json({done:true,nextCursor:null});return json(await initialize(db,Number(input.cursor??0)));}catch(error){return failure(error);}}
