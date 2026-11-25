import {ALL_FIELDS} from "./contracts.ts";

export type FieldOperation="add"|"remove"|"replace";
export type PendingFieldEdit={operation:FieldOperation;fields:string[];choices:string[];};
export type FieldEditPlan={kind:"edit";operation:FieldOperation;fields:string[]}|{kind:"clarify";question:string;choices:string[];pending?:PendingFieldEdit}|null;
const aliases:Record<string,string>={"商机阶段":"项目阶段","商机进度":"项目阶段","项目进度":"项目阶段","阶段":"项目阶段","项目负责人":"负责人","项目经理":"负责人","项目编码":"项目编号","商机编号":"项目编号","商机名称":"项目名称","客户":"客户名称","金额":"项目金额","毛利":"预计毛利","利润":"预计利润","成交日期":"预计成交日期","成交时间":"预计成交日期","挂网日期":"预计挂网日期","挂网时间":"预计挂网日期","中标日期":"中标时间","招投标":"是否需要招投标","承诺":"业绩承诺"};
const labels=[...new Set([...ALL_FIELDS,...Object.keys(aliases)])].sort((a,b)=>b.length-a.length);
export function fieldsInText(text:string){
  const matches:{index:number;end:number;field:string}[]=[];
  for(const label of labels){let start=0;while(start<text.length){const index=text.indexOf(label,start);if(index<0)break;const end=index+label.length;if(!matches.some(m=>index<m.end&&end>m.index))matches.push({index,end,field:aliases[label]??label});start=end;}}
  matches.sort((a,b)=>a.index-b.index);return {fields:[...new Set(matches.map(m=>m.field))],rest:matches.reduceRight((value,m)=>value.slice(0,m.index)+" ".repeat(m.end-m.index)+value.slice(m.end),text)};
}
export function fieldEditPlan(question:string,pending?:PendingFieldEdit):FieldEditPlan{
  // A mixed request still belongs to the query tool, which changes filters too.
  if(/(?:取消|去掉|移除).*(?:限制|筛选条件)/.test(question))return null;
  if(/只保留|筛选|查询|20\d{2}年|\d\s*[%％]|(?:确保|冲刺|力争)档|(?:医疗|教育|政企|民办校|高教|基教|城市军团)(?:团队|事业群)/.test(question))return null;
  const marker=question.match(/只(?:显示|展示)|仅(?:显示|展示)|改为(?:显示|展示)|(?:加上|加个|增加|添加|补上|补充|新增|显示|展示|去掉|移除|隐藏|不要显示)/);
  if(!marker&&!pending){if(/^(?:请|帮我|麻烦)?(?:改|调整|修改|优化)(?:一下|下|这个|这些)?[。！!？?]*$/.test(question.trim()))return {kind:"clarify",question:"你希望调整什么：增加展示字段、修改筛选条件，还是统计当前清单？",choices:["增加展示字段","修改筛选条件","统计当前清单"]};return null;}
  const operation:FieldOperation=marker?(/只|仅|改为/.test(marker[0])?"replace":/去掉|移除|隐藏|不要/.test(marker[0])?"remove":"add"):pending!.operation;
  const text=marker?question.slice(marker.index!+marker[0].length):question;
  const found=fieldsInText(text);const fields=[...new Set([...(pending?.fields??[]),...found.fields])];
  const ordinal=text.trim().match(/^(?:我)?(?:选|选择)?第?([一二三123])(?:个|项)?(?:吧)?[。！!]*$/);
  if(!marker&&pending&&ordinal){const index="一二三".indexOf(ordinal[1]);const selected=pending.choices[index>=0?index:Number(ordinal[1])-1];if(selected&&ALL_FIELDS.includes(selected))return {kind:"edit",operation,fields:[...new Set([...pending.fields,selected])]};}
  const needsDate=/时间|日期/.test(found.rest);const needsStatus=/状态/.test(found.rest);
  const unknown=found.rest.replace(/(?:在下面|下面|下方|表格|清单|展示|显示|部分|加上|增加|添加|补充|字段|列名|一列|这(?:些|批|份)项目|项目|帮我|我想要|我想看|我选择|我选|请|也|再|以及|并且|同时|和|与|及|并|重新|导出|下载|Excel|的|吧|一下|[\s，,。！？!?:：；;、~～“”"'（）()])/gi,"");
  if(needsDate||needsStatus||!fields.length||unknown){
    const choices=needsDate?["预计成交日期","预计挂网日期","中标时间"]:needsStatus?["项目阶段","业绩承诺","是否需要招投标"]:["项目阶段","项目金额","预计成交日期"];
    const prompt=needsDate?"你想使用哪一种时间或日期：预计成交日期、预计挂网日期，还是中标时间？":needsStatus?"你说的状态是项目阶段、业绩承诺，还是是否需要招投标？":unknown?`我还不能确定“${unknown.slice(0,35)}”对应哪一列。请确认具体展示字段，可选项目阶段、项目金额、预计成交日期等现有字段。`:"你想调整哪一个展示字段？请告诉我具体列名；可选项目阶段、项目金额、预计成交日期等现有字段。";
    return {kind:"clarify",question:prompt,choices,pending:{operation,fields,choices}};
  }
  return {kind:"edit",operation,fields};
}
