import {AS_OF,type Filters,type YearBasis} from "./contracts.ts";
export function needsBusinessQuery(question:string){return /(?:取消|去掉|移除).*(?:限制|筛选|条件)|从大到小|从小到大|排序|排列|取前\d+|预计利润.{0,8}(?:负数|亏损)|未填写.{0,8}挂网|下个月/.test(question);}
export function businessPatch(base:Filters|null,raw:Record<string,unknown>,question:string,hint:YearBasis|null){
  const patch={...raw};const cancel=/取消|去掉|移除|不限/.test(question)&&/限制|筛选|条件|不限/.test(question);
  const customer=question.match(/(?:把|查询客户[“"]?)([^，。]{2,80}?(?:公司|集团|学校|医院|中心|产业园))的/);
  if(customer){patch.customer=customer[1];if(!base){for(const key of ['team','businessGroup','province','city','district'])patch[key]=null;if(!/20\d{2}|今年|明年|去年/.test(question))patch.year=null;}}
  if(base){
    for(const [key,label] of [['city','城市'],['province','省'],['district','区县'],['commitment','承诺'],['owner','负责人'],['customer','客户']] as const){if(cancel&&(question.includes(label)||(base[key]&&question.includes(String(base[key])))))patch[key]=null;}
    if(!/排序|排列|从大到小|从小到大/.test(question)){delete patch.sortBy;delete patch.sortDirection;}
    if(!/前\s*\d+|条数|数量限制/.test(question))delete patch.limit;
    if(!/利润|亏损/.test(question))delete patch.profitStatus;
    if(!/挂网|缺失/.test(question))delete patch.missingPublishOnly;
    if(!/日期|时间|月|季度|20\d{2}/.test(question)){delete patch.dateFrom;delete patch.dateTo;}
    if(patch.customer===null&&!cancel)delete patch.customer;
  }
  if(/不限年份|全部年份|取消年份/.test(question))patch.year=null;
  const single=question.match(/(?:阶段|进度)(?:为|是|在)?\s*(\d{1,3})\s*[%％]/);const range=question.match(/(\d{1,3})\s*[%％]?\s*(?:-|—|至|到|~|～)\s*(\d{1,3})\s*[%％]/);
  if(range){patch.stageMin=Number(range[1]);patch.stageMax=Number(range[2]);}
  else if(single){patch.stageMin=patch.stageMax=Number(single[1]);}
  else if(/已赢单|已成交|已签单/.test(question)){patch.stageMin=patch.stageMax=100;}
  else if(/在途/.test(question)){patch.stageMin=20;patch.stageMax=80;}
  else if(/全部阶段|所有阶段|阶段不限|不限.{0,8}阶段/.test(question)){patch.stageMin=0;patch.stageMax=100;}
  if(/从大到小|降序/.test(question)){patch.sortBy=/利润/.test(question)?'profit':'amount';patch.sortDirection='desc';}
  if(/从小到大|升序/.test(question)){patch.sortBy=/利润/.test(question)?'profit':'amount';patch.sortDirection='asc';}
  if(/(?:成交日期|成交时间).*(?:从近到远|升序)/.test(question)){patch.sortBy='expected_close';patch.sortDirection='asc';}
  const top=question.match(/(?:取|看|列出)?前\s*(\d+)\s*(?:条|个)/);if(top)patch.limit=Number(top[1]);
  if(cancel&&/前\s*\d+|条数|数量限制/.test(question))patch.limit=null;
  if(/预计利润.{0,8}(?:负数|为负|小于0)|预计亏损/.test(question))patch.profitStatus='loss';
  if(/预计利润.{0,5}(?:为0|为零|等于0)/.test(question))patch.profitStatus='break_even';
  const special=/单独|单列|专项|工作表/.test(question);
  if(/(?:未填写|未填|缺少|缺失|没填).{0,10}挂网/.test(question)&&!special){patch.missingPublishOnly=true;patch.tender=true;}
  if(special)delete patch.missingPublishOnly;
  if(/下个月/.test(question)){
    const [year,month]=AS_OF.split('-').map(Number);patch.dateFrom=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);patch.dateTo=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);patch.year=Number(String(patch.dateFrom).slice(0,4));patch.yearBasis=/创建|录入/.test(question)?'created':/中标/.test(question)?'bid_award':/预计成交/.test(question)?'expected_close':base?.yearBasis??hint;
  }
  return patch;
}
