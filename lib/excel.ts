import {YEAR_LABELS,type QueryResult} from "./contracts.ts";

const utf8=new TextEncoder();
const xml=(value:unknown)=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
function column(index:number){let name="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;}
const CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const n of bytes)crc=CRC_TABLE[(crc^n)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function join(parts:Uint8Array[]){const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const part of parts){result.set(part,pos);pos+=part.length;}return result;}
// Standards-based, stored ZIP entries keep export independent of a Node filesystem.
// The same exporter executes in the local preview and in a Cloudflare Worker.
export function zipFiles(files:Record<string,string>):Uint8Array {
  const local:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0;
  for(const [path,content] of Object.entries(files)){
    const name=utf8.encode(path),data=utf8.encode(content),crc=crc32(data);
    const header=new Uint8Array(30);const v=new DataView(header.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(12,0x5d76,true);
    v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
    local.push(header,name,data);
    const directory=new Uint8Array(46);const d=new DataView(directory.buffer);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);d.setUint16(14,0x5d76,true);
    d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);
    central.push(directory,name);offset+=header.length+name.length+data.length;
  }
  const directory=join(central);const end=new Uint8Array(22);const e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,Object.keys(files).length,true);e.setUint16(10,Object.keys(files).length,true);e.setUint32(12,directory.length,true);e.setUint32(16,offset,true);
  return join([...local,directory,end]);
}
function cell(ref:string,value:unknown,style=0){
  if(value===null||value===undefined)return `<c r="${ref}" s="${style}"/>`;
  if(typeof value==="number")return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function dateSerial(value:string){return (Date.parse(value+"T00:00:00Z")-Date.UTC(1899,11,30))/86400000;}
export function workbookBytes(result:QueryResult):Uint8Array {
  const fields=result.fields;const last=column(fields.length-1);const lastRow=result.rows.length+1;
  const columns=fields.map((field,i)=>`<col min="${i+1}" max="${i+1}" width="${field==="项目名称"?56:field==="客户名称"?40:field==="项目编号"?24:/金额|毛利|利润/.test(field)?20:/日期|时间/.test(field)?19:field==="负责人"?14:20}" customWidth="1"/>`).join("");
  const rows=[`<row r="1" ht="30" customHeight="1">${fields.map((f,i)=>cell(column(i)+"1",f,1)).join("")}</row>`];
  result.rows.forEach((row,index)=>{const n=index+2;rows.push(`<row r="${n}" ht="38" customHeight="1">`+fields.map((f,i)=>{
    const value=row[f];if(value!==null&&/日期|中标时间/.test(f))return cell(column(i)+n,dateSerial(String(value)),2);
    if(value!==null&&f==="项目阶段")return cell(column(i)+n,Number(String(value).replace("%",""))/100,4);
    return cell(column(i)+n,value,/金额|毛利|利润/.test(f)?3:0);
  }).join("")+"</row>");});
  const f=result.filters;const info=[
    ["查询说明","商机助手 · 模拟数据导出"],["数据性质","全部为模拟商机，不代表任何公司实际业务"],
    ["数据快照",result.asOf],["团队",f.team??"全部团队"],["事业群",f.businessGroup??"全部事业群"],
    ["年份",f.year??"全部年份"],["年份口径",f.yearBasis?YEAR_LABELS[f.yearBasis]:"不限"],
    ["项目阶段",`${f.stageMin}%—${f.stageMax}%（包含端点）`],["业绩承诺",f.commitment??"不限"],
    ["是否需要招投标",f.tender===null?"不限":f.tender?"是":"否"],["导出记录数",result.rows.length],
    ["金额单位","人民币元；金额单元格为数值"],["空白日期","不适用或尚未录入，未自动补写"],
    ["团队层级","查询上级团队时包含全部下属团队"],
  ];
  if(f.projectName)info.push(["项目名称关键字",f.projectName]);
  if(f.projectId)info.push(["项目编号",f.projectId]);
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="38"/><cols>${columns}</cols><sheetData>${rows.join("")}</sheetData><autoFilter ref="A1:${last}${lastRow}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
  const notes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B${info.length}"/><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="68" customWidth="1"/></cols><sheetData>${info.map((r,i)=>`<row r="${i+1}" ht="30" customHeight="1">${r.map((v,j)=>cell(column(j)+(i+1),v,i===0?1:0)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF25304A"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5145CD"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom style="hair"><color rgb="FFE7EAF2"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zipFiles({
    "[Content_Types].xml":`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels":`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="商机清单" sheetId="1" r:id="rId1"/><sheet name="查询说明" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels":`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml":styles,"xl/worksheets/sheet1.xml":sheet,"xl/worksheets/sheet2.xml":notes,
  });
}
export function exportFilename(result:QueryResult){const f=result.filters;const type=f.stageMin===20&&f.stageMax===80?"在途商机":f.stageMin===100&&f.stageMax===100?"已赢单商机":"商机";return `${f.year?f.year+"年":""}${f.team??f.businessGroup??"全部团队"}${type}清单.xlsx`;}
