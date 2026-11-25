import type {YearBasis} from "./contracts.ts";

function dateFilterText(question:string){
  return question.split(/[。！？\n；;]/).map(part=>part.split(/(?:包含|包括|显示|展示|加上|补上|添加|增加|字段(?:为|如下|包括|包含)?)[：:]?/)[0]).join("\n");
}

export function explicitYearBasis(text:string):YearBasis|null {
  const intent=dateFilterText(text);
  const matches=intent.matchAll(/创建|录入|新增|项目时间|商机时间|中标(?:年份|时间|日期)|年\s*中标|预计\s*(?:20\d{2}\s*年\s*|今年|明年|去年)?成交|成交年份|成交日期|成交时间/g);
  const bases=new Set([...matches].map(([match]):YearBasis=>/中标/.test(match)?"bid_award":/成交/.test(match)?"expected_close":"created"));
  return bases.size===1?bases.values().next().value??null:null;
}
