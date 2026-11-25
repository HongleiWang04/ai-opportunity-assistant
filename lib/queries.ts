import {validateFilters,AS_OF,type Filters,type QueryResult} from "./contracts.ts";
export type D1Statement={bind:(...values:unknown[])=>D1Statement;all:()=>Promise<{results:Record<string,unknown>[]} >;first:()=>Promise<Record<string,unknown>|null>;};
export type Database={prepare:(sql:string)=>D1Statement;batch:(statements:D1Statement[])=>Promise<unknown>;};
export const FROM_SQL=` FROM opportunities p JOIN teams t ON t.team_id=p.team_id JOIN business_groups g ON g.business_group_id=t.business_group_id JOIN project_owners u ON u.owner_id=p.owner_id AND u.team_id=p.team_id `;
export const FIELD_SQL:Record<string,string>={"事业群":"g.business_group_name","负责人":"u.owner_name","所在团队":"t.team_name","项目编号":"p.project_id","项目名称":"p.project_name","客户名称":"p.customer_name","项目金额":"p.project_amount_cents/100.0","预计毛利":"p.expected_gross_profit_cents/100.0","预计利润":"p.expected_profit_cents/100.0","项目阶段":"CAST(p.project_stage AS TEXT)||'%'","预计挂网日期":"p.expected_publish_date","预计成交日期":"p.expected_close_date","业绩承诺":"p.performance_commitment","是否需要招投标":"CASE WHEN p.requires_tender=1 THEN '是' ELSE '否' END","中标时间":"p.bid_award_date","项目所在省":"p.province","项目所在市":"p.city","项目所在区县":"p.district"};
export function buildWhere(filters:Filters){
  const f=validateFilters(filters);const clauses=["p.project_stage BETWEEN ? AND ?"];const args:unknown[]=[f.stageMin,f.stageMax];
  if(f.team){clauses.push("EXISTS (SELECT 1 FROM team_closure c JOIN teams a ON a.team_id=c.ancestor_team_id WHERE c.descendant_team_id=p.team_id AND a.team_name=?)");args.push(f.team);}
  if(f.businessGroup){clauses.push("g.business_group_name=?");args.push(f.businessGroup);}
  if(f.year){const column={expected_close:"p.expected_close_date",created:"p.created_date",bid_award:"p.bid_award_date"}[f.yearBasis!];clauses.push(`${column}>=? AND ${column}<?`);args.push(`${f.year}-01-01`,`${f.year+1}-01-01`);}
  if(f.commitment){clauses.push("p.performance_commitment=?");args.push(f.commitment);}
  if(f.tender!==null){clauses.push("p.requires_tender=?");args.push(Number(f.tender));}
  if(f.customer){clauses.push("p.customer_name LIKE ? ESCAPE '\\'");args.push('%'+f.customer.replace(/[\\%_]/g,'\\$&')+'%');}
  if(f.projectName){clauses.push("instr(p.project_name,?)>0");args.push(f.projectName);}
  if(f.projectId){clauses.push("p.project_id=?");args.push(f.projectId);}
  if(f.missingPublishOnly)clauses.push('p.requires_tender=1 AND p.expected_publish_date IS NULL');
  if(f.profitStatus)clauses.push('p.expected_profit_cents'+{loss:'<0',break_even:'=0',profit:'>0'}[f.profitStatus]);
  const dateColumn={expected_close:'p.expected_close_date',created:'p.created_date',bid_award:'p.bid_award_date'}[f.yearBasis??'expected_close'];
  if(f.dateFrom){clauses.push(dateColumn+'>=?');args.push(f.dateFrom);}
  if(f.dateTo){clauses.push(dateColumn+'<=?');args.push(f.dateTo);}
  if(f.amountMin!=null){clauses.push("p.project_amount_cents>=?");args.push(Math.round(f.amountMin*100));}
  if(f.amountMax!=null){clauses.push("p.project_amount_cents<=?");args.push(Math.round(f.amountMax*100));}
  for(const key of ["owner","province","city","district"] as const)if(f[key]){const column={owner:"u.owner_name",province:"p.province",city:"p.city",district:"p.district"}[key];clauses.push(`${column}=?`);args.push(f[key]);}
  return {where:" WHERE "+clauses.join(" AND "),args,filters:f};
}
export async function runQuery(db:Database,raw:unknown,page=1,pageSize=20,exportAll=false):Promise<QueryResult>{
  if(!Number.isInteger(page)||page<1||page>10000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new Error("分页参数不正确。");
  const {where,args,filters}=buildWhere(validateFilters(raw));
  const sortColumn={expected_close:'p.expected_close_date',amount:'p.project_amount_cents',profit:'p.expected_profit_cents'}[filters.sortBy??'expected_close'];const order=` ORDER BY ${sortColumn} ${filters.sortDirection==='desc'?'DESC':'ASC'},p.project_id`;
  const summarySql=filters.limit?'SELECT COUNT(*) AS n,COALESCE(SUM(project_amount_cents),0) AS cents,COALESCE(SUM(requires_tender),0) AS tender FROM (SELECT p.project_amount_cents,p.requires_tender'+FROM_SQL+where+order+' LIMIT ?)':'SELECT COUNT(*) AS n,COALESCE(SUM(p.project_amount_cents),0) AS cents,COALESCE(SUM(p.requires_tender),0) AS tender'+FROM_SQL+where;
  const summary=await db.prepare(summarySql).bind(...args,...(filters.limit?[filters.limit]:[])).first();
  const total=Number(summary?.n??0);const actualPage=exportAll?1:Math.min(page,Math.max(1,Math.ceil(total/pageSize)));
  let sql="SELECT p.project_id AS _row_id,"+filters.fields.map(field=>FIELD_SQL[field]+` AS "${field}"`).join(",")+FROM_SQL+where+order;
  const parameters=[...args];if(!exportAll){sql+=" LIMIT ? OFFSET ?";const offset=(actualPage-1)*pageSize;parameters.push(Math.min(pageSize,Math.max(0,total-offset)),offset);}else if(filters.limit){sql+=' LIMIT ?';parameters.push(filters.limit);}
  const result=await db.prepare(sql).bind(...parameters).all();const ids=result.results.map(r=>String(r._row_id));
  const rows=result.results.map(row=>Object.fromEntries(filters.fields.map(field=>[field,row[field]??null])) as Record<string,string|number|null>);
  return {filters,fields:filters.fields,rows,rowIds:ids,totalRows:total,page:actualPage,pageSize:exportAll?Math.max(1,total):pageSize,totalAmount:Number(summary?.cents??0)/100,tenderCount:Number(summary?.tender??0),asOf:AS_OF,allSimulated:true};
}
