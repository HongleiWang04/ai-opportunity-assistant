import {workbookBytes,zipFiles} from "./excel.ts";
import type {QueryResult} from "./contracts.ts";
import type {ExportPlan} from "./agent-contracts.ts";

function unpackStoredArchive(bytes:Uint8Array){const out:Record<string,string>={};const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const decoder=new TextDecoder();let offset=0;while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){if(view.getUint16(offset+8,true)!==0)throw new Error("导出模板压缩格式不支持。");const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);const name=decoder.decode(bytes.slice(offset+30,offset+30+nameLength));const start=offset+30+nameLength+extra;out[name]=decoder.decode(bytes.slice(start,start+length));offset=start+length;}return out;}
const escaped=(value:unknown)=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
export function missingPublishRows(full:QueryResult){return full.rows.map((row,i)=>({row,id:full.rowIds[i]})).filter(({row})=>row["是否需要招投标"]==="是"&&row["预计挂网日期"]===null);}
function projection(full:QueryResult,indexes:number[]):QueryResult{return {...full,rows:indexes.map(i=>Object.fromEntries(full.fields.map(field=>[field,full.rows[i][field]??null]))),rowIds:indexes.map(i=>full.rowIds[i]),totalRows:indexes.length,totalAmount:indexes.reduce((sum,i)=>sum+Math.round(Number(full.rows[i]["项目金额"]??0)*100),0)/100,page:1,pageSize:Math.max(1,indexes.length)};}
export function agentWorkbook(full:QueryResult,fields:string[],plan:ExportPlan){
  const projected={...full,fields};const allIndexes=full.rows.map((_,i)=>i);const master=projection(projected,allIndexes);
  const files=unpackStoredArchive(workbookBytes(master));const sheets=[{name:"商机清单",xml:files["xl/worksheets/sheet1.xml"],rows:master.totalRows}];
  if(plan.splitBy==="team"){
    const names=[...new Set(full.rows.map(row=>String(row["所在团队"])))].sort();
    for(const name of names){const indexes=allIndexes.filter(i=>full.rows[i]["所在团队"]===name);const subset=projection(projected,indexes);sheets.push({name:name.slice(0,31),xml:unpackStoredArchive(workbookBytes(subset))["xl/worksheets/sheet1.xml"],rows:indexes.length});}
  }
  if(plan.includeMissingPublishSheet){const indexes=allIndexes.filter(i=>full.rows[i]["是否需要招投标"]==="是"&&full.rows[i]["预计挂网日期"]===null);const subset=projection(projected,indexes);sheets.push({name:"招投标挂网日期缺失",xml:unpackStoredArchive(workbookBytes(subset))["xl/worksheets/sheet1.xml"],rows:indexes.length});}
  let notes=files["xl/worksheets/sheet2.xml"];const originalCount=Number(notes.match(/dimension ref="A1:B(\d+)"/)?.[1]??14);
  const f=full.filters;
  // Every active business filter must remain visible in the workbook notes.
  const extra=[['导出结构',plan.splitBy==="team"?'完整清单＋按团队分表':'完整清单'],['挂网日期缺失专项表',plan.includeMissingPublishSheet?'仅列需要招投标且预计挂网日期为空的项目':'未添加'],['表间关系','团队分表及专项表均为完整清单的子集，请勿重复加总'],['工作表记录数',sheets.map(s=>`${s.name}：${s.rows}条`).join('；')],['字段顺序',fields.join('、')],['项目负责人筛选',f.owner??'不限'],['省市区县筛选',[f.province,f.city,f.district].filter(Boolean).join(' / ')||'不限'],['项目金额下限（元）',f.amountMin??'不限'],['项目金额上限（元）',f.amountMax??'不限']];
  extra.push(['客户名称关键字',f.customer??'不限'],['日期区间',[f.dateFrom??'不限',f.dateTo??'不限'].join(' 至 ')],['预计利润状态',f.profitStatus??'不限'],['仅挂网日期缺失',f.missingPublishOnly?'是':'否'],['排序及前N条',`${f.sortBy??'expected_close'} ${f.sortDirection??'asc'}；${f.limit??'不限条数'}`]);
  const appended=extra.map((row,i)=>`<row r="${originalCount+i+1}" ht="42" customHeight="1">${row.map((v,j)=>`<c r="${j===0?'A':'B'}${originalCount+i+1}" s="0" t="inlineStr"><is><t>${escaped(v)}</t></is></c>`).join('')}</row>`).join('');
  notes=notes.replace(`A1:B${originalCount}`,`A1:B${originalCount+extra.length}`).replace('</sheetData>',appended+'</sheetData>');sheets.push({name:'查询说明',xml:notes,rows:originalCount+extra.length});
  for(const key of Object.keys(files))if(key.startsWith('xl/worksheets/'))delete files[key];
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  files['xl/workbook.xml']=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${escaped(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  files['xl/_rels/workbook.xml.rels']=`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`;
  files['[Content_Types].xml']=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  sheets.forEach((sheet,i)=>{files[`xl/worksheets/sheet${i+1}.xml`]=sheet.xml;});return {bytes:zipFiles(files),sheets:sheets.map(({name,rows})=>({name,rows}))};
}
