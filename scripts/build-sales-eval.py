import sqlite3,json
from pathlib import Path
root=Path(__file__).resolve().parent.parent
db=sqlite3.connect(root/'data/opportunities_demo.sqlite');db.row_factory=sqlite3.Row
tasks=[]
default=['负责人','所在团队','项目名称','客户名称','是否需要招投标','预计成交日期','预计挂网日期','项目金额']
def expect(**kw):return dict(stageMin=20,stageMax=80,**kw)
def add(i,q,group=None,new=True,kind='query',f=None,**checks):
    item={'id':i,'question':q,'group':group or str(i),'newTask':new,'kind':kind,'expected':checks}
    if f is not None:
        clauses=[];args=[]
        for k,col in [('year',''),('team','t.team_name'),('owner','o.owner_name'),('city','p.city'),('commitment','p.performance_commitment'),('customer','p.customer_name')]:
            if k not in f:continue
            if k=='year':col={'created':'p.created_date','expected_close':'p.expected_close_date'}[f.get('basis','expected_close')];clauses.extend([col+'>=?',col+'<?']);args.extend([str(f[k])+'-01-01',str(f[k]+1)+'-01-01'])
            elif k=='team':clauses.append('p.team_id IN (SELECT c.descendant_team_id FROM team_closure c JOIN teams a ON a.team_id=c.ancestor_team_id WHERE a.team_name=?)');args.append(f[k])
            else:clauses.append(col+'=?');args.append(f[k])
        clauses.append('p.project_stage BETWEEN ? AND ?');args.extend([f.get('stageMin',20),f.get('stageMax',80)])
        for k,op in [('amountMin','>='),('amountMax','<=')]:
            if k in f:clauses.append('p.project_amount_cents'+op+'?');args.append(round(f[k]*100))
        if 'tender' in f:clauses.append('p.requires_tender=?');args.append(int(f['tender']))
        if f.get('missing'):clauses.append('p.expected_publish_date IS NULL');clauses.append('p.requires_tender=1')
        if f.get('loss'):clauses.append('p.expected_profit_cents<0')
        if 'from' in f:clauses.append('p.expected_close_date>=?');args.append(f['from'])
        if 'to' in f:clauses.append('p.expected_close_date<=?');args.append(f['to'])
        order={'amount_desc':'p.project_amount_cents DESC,p.project_id','close_asc':'p.expected_close_date,p.project_id'}.get(f.get('sort'),'p.expected_close_date,p.project_id')
        rows=db.execute('SELECT p.project_id,p.project_amount_cents FROM opportunities p JOIN teams t ON t.team_id=p.team_id JOIN project_owners o ON o.owner_id=p.owner_id WHERE '+' AND '.join(clauses)+' ORDER BY '+order,args).fetchall()
        if f.get('limit'):rows=rows[:f['limit']]
        item['oracle']=f;item['expected'].update(rows=len(rows),ids=[r['project_id'] for r in rows],amountCents=sum(r['project_amount_cents'] for r in rows))
    tasks.append(item)
base=dict(year=2026,team='民办校团队')
add(1,'我需要一份2026年民办校团队所有在途商机，进度20%-80%，包含负责人、所在团队、项目名称、客户名称、是否需要招投标、预计成交日期、预计挂网日期、项目金额，导出Excel。','A',f=base,fields=default,export=True)
add(2,'这些项目有几个在青岛？','A',False,'summary',f=base,message=['有3个'],tool='summarize_current_result')
add(3,'列出来','A',False,f=dict(base,city='青岛市'),tool='list_current_subset')
add(4,'加上商机阶段','A',False,f=dict(base,city='青岛市'),fields=default+['项目阶段'])
add(5,'取消青岛市限制，其他条件不变','A',False,f=base,fields=default+['项目阶段'])
add(6,'只看确保档','A',False,f=dict(base,commitment='确保'))
add(7,'再去掉业绩承诺限制，其他条件不变','A',False,f=base)
add(8,'加上时间','A',False,'clarify',choices=['预计成交日期','预计挂网日期','中标时间'])
add(9,'我想看中标时间','A',False,f=base,containsFields=['中标时间','项目阶段'])
add(10,'查2025年教育事业群全部阶段的项目，按项目金额从大到小取前10条。',f=dict(year=2025,team='教育',stageMin=0,stageMax=100,sort='amount_desc',limit=10))
add(11,'查询2025年基教A市团队全部阶段项目，包含项目编号、所在团队、项目所在市、项目阶段。',f=dict(year=2025,team='基教A市团队',stageMin=0,stageMax=100),fields=['项目编号','所在团队','项目所在市','项目阶段'])
add(12,'给我2025年项目阶段为90%的商机名单。',f=dict(year=2025,stageMin=90,stageMax=90))
add(13,'查王晨负责的所有在途商机，不限年份，包含负责人、所在团队、项目名称、项目金额。','B',f=dict(owner='王晨'),fields=['负责人','所在团队','项目名称','项目金额'])
add(14,'只看医疗团队，其他条件不变','B',False,f=dict(owner='王晨',team='医疗'))
add(15,'查询2025年创建的医疗商机，项目阶段不限。','C',f=dict(year=2025,basis='created',team='医疗',stageMin=0,stageMax=100))
add(16,'改按预计成交日期筛选2026年，其他条件不变','C',False,f=dict(year=2026,team='医疗',stageMin=0,stageMax=100))
add(17,'查询2024年政企事业群全部阶段、项目金额10万到50万元的项目，项目金额和项目编号放在前面。',f=dict(year=2024,team='政企',stageMin=0,stageMax=100,amountMin=100000,amountMax=500000),firstFields=['项目金额','项目编号'])
add(18,'查询2025年民办校团队不需要招投标的在途项目。',f=dict(year=2025,team='民办校团队',tender=False))
add(19,'列出2025年全部阶段、需要招投标但未填写预计挂网日期的项目，导出清单。',f=dict(year=2025,stageMin=0,stageMax=100,missing=True),export=True)
add(20,'找出预计利润为负数的项目，不限年份和项目阶段。',f=dict(stageMin=0,stageMax=100,loss=True))
add(21,'有哪些项目金额不超过1元？不限年份和项目阶段。',f=dict(stageMin=0,stageMax=100,amountMax=1))
add(22,'查询0%阶段且不需要招投标的全部商机，不限年份。',f=dict(stageMin=0,stageMax=0,tender=False))
add(23,'下个月预计成交的所有阶段项目，按预计成交日期从近到远排序。',f=dict(stageMin=0,stageMax=100,**{'from':'2026-12-01','to':'2026-12-31'},sort='close_asc'))
add(24,'把杭州市明德教育集团的所有阶段商机列出来，显示客户名称、项目编号、项目名称、项目金额。','D',f=dict(stageMin=0,stageMax=100,customer='杭州市明德教育集团（模拟）'),fields=['客户名称','项目编号','项目名称','项目金额'])
add(25,'按项目金额从大到小排列，其他不变','D',False,f=dict(stageMin=0,stageMax=100,customer='杭州市明德教育集团（模拟）',sort='amount_desc'))
add(26,'我想看重点商机','E',kind='clarify')
add(27,'金额100万元及以上的在途项目，不限年份，导出Excel。','E',False,f=dict(amountMin=1000000),export=True)
add(28,'帮我删除所有0%阶段商机',kind='blocked',message=['不修改|不执行|仅查询'])
add(29,'这些项目为什么没成交，帮我预测成交概率',kind='blocked',message=['不能|不支持|无法'])
add(30,'查询2025年教育事业群全部在途商机，按团队分表，需要招投标但缺少预计挂网日期的项目单独放一个工作表，导出Excel。',f=dict(year=2025,team='教育'),export=True,split=True,missingSheet=True)
assert len(tasks)==30
(root/'eval/sales-30-tasks.json').write_text(json.dumps(tasks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'id':x['id'],'rows':x['expected'].get('rows'),'kind':x['kind']} for x in tasks],ensure_ascii=False))
