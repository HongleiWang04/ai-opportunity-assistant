"""Append reproducible synthetic diversity cases; retain all original 5,000 rows."""
from pathlib import Path
from datetime import date,timedelta
import sqlite3,json,random,sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parent.parent
path=root/'data/opportunities_demo.sqlite'
db=sqlite3.connect(':memory:')
with sqlite3.connect(path) as original:original.backup(db)
db.execute("DELETE FROM opportunities WHERE project_id LIKE 'MOCK-DIV-%'")
db.execute('DELETE FROM project_owners WHERE owner_id BETWEEN 10000 AND 10999')
before=db.execute('SELECT COUNT(*) FROM opportunities').fetchone()[0]
rng=random.Random(20261123)
places=[('北京市','北京市','海淀区'),('天津市','天津市','南开区'),('上海市','上海市','浦东新区'),('重庆市','重庆市','渝中区'),('河北省','石家庄市','长安区'),('山西省','太原市','小店区'),('辽宁省','沈阳市','和平区'),('辽宁省','大连市','中山区'),('吉林省','长春市','南关区'),('黑龙江省','哈尔滨市','南岗区'),('江苏省','苏州市','姑苏区'),('江苏省','无锡市','滨湖区'),('江苏省','南京市','鼓楼区'),('浙江省','杭州市','西湖区'),('浙江省','宁波市','鄞州区'),('浙江省','温州市','鹿城区'),('安徽省','合肥市','蜀山区'),('福建省','福州市','鼓楼区'),('福建省','厦门市','思明区'),('福建省','泉州市','丰泽区'),('江西省','南昌市','红谷滩区'),('江西省','赣州市','章贡区'),('山东省','青岛市','市南区'),('山东省','济南市','历下区'),('山东省','烟台市','芝罘区'),('山东省','潍坊市','奎文区'),('河南省','郑州市','金水区'),('河南省','洛阳市','洛龙区'),('湖北省','武汉市','洪山区'),('湖北省','宜昌市','西陵区'),('湖南省','长沙市','岳麓区'),('湖南省','株洲市','天元区'),('广东省','广州市','天河区'),('广东省','深圳市','南山区'),('广东省','佛山市','禅城区'),('广东省','东莞市','松山湖园区'),('广西壮族自治区','南宁市','青秀区'),('海南省','海口市','龙华区'),('四川省','成都市','武侯区'),('四川省','绵阳市','涪城区'),('贵州省','贵阳市','观山湖区'),('云南省','昆明市','五华区'),('陕西省','西安市','雁塔区'),('甘肃省','兰州市','城关区'),('宁夏回族自治区','银川市','金凤区'),('内蒙古自治区','呼和浩特市','新城区'),('新疆维吾尔自治区','乌鲁木齐市','新市区'),('青海省','西宁市','城西区')]
names=['王晨','李思远','陈一诺','赵子涵','周明轩','吴雨桐','孙嘉宁','郑文博','何思齐','许安然','宋知行','林予安']
teams=[1,3,4,5,7,8,9,10,11,12]
owners={}
for ti,team in enumerate(teams):
    owners[team]=[]
    for ni in range(4):
        oid=10000+ti*4+ni;name=names[ni] if team in [1,3] else names[(ti+ni)%len(names)]
        db.execute('INSERT INTO project_owners VALUES(?,?,?)',(oid,name,team));owners[team].append(oid)
types={1:['智慧门诊改造','病案数据治理','临床辅助决策试点','院内知识库','医学影像平台','设备维保续约','互联网医院接口集成','诊疗流程优化'],2:['教务管理平台','学情分析试点','校园网络升级','招生管理系统','家校协同平台','机房维保续约','教学资源订阅','校企协同平台'],3:['政务数据治理','数字档案平台','公共服务门户','文旅知识库试点','政务云迁移','办公系统续约','园区招商平台','便民热线集成'],4:['交通数据平台','园区能耗监测','城市运维续约','能源管理试点','智慧停车平台','城市更新数据治理','管网巡检平台','应急调度系统']}
group_for={team:1 if team==1 else 3 if team==3 else 4 if team==4 else 2 for team in teams}
amounts=[1,9999,100000,1000000,10000000,50000000,100000000,800000000,1250050,3000000]
for i in range(600):
    team=teams[i%len(teams)];group=group_for[team]
    created=date(2024+i%2,1,1)+timedelta(days=rng.randrange(250))
    stage=[0,20,40,60,80,90,100][i%7]
    close=min(created+timedelta(days=45+rng.randrange(180)),date(2025,12,31))
    if group!=2 and i%9==0 and stage!=100:created=date(2025,9,1)+timedelta(days=i%90);close=date(2026,12,1)+timedelta(days=i%50)
    province,city,district=places[(i*17+i//len(places))%len(places)]
    amount=amounts[i%len(amounts)] if i%5==0 else rng.randrange(10000,900000001)
    gross=round(amount*(.08+(i%11)*.025));profit=-max(1,round(amount*.03)) if i%23==0 else 0 if i%31==0 else round(gross*.6)
    tender=int(i%4!=0);publish=None if not tender or i%11==0 else (created+timedelta(days=15)).isoformat();bid=(close-timedelta(days=5)).isoformat() if tender and stage==100 else None
    kind=types[group][(i//len(teams))%len(types[group])]
    customer=f'{city}{["明德","知行","远帆","启明","同创"][i//6%5]}{["","医疗集团","教育集团","公共服务中心","产业园"][group]}（模拟）'
    if i<3:
        team=7;group=2;created=date(2025,2,1)+timedelta(days=i*20);close=date(2025,10,1)+timedelta(days=i*10);stage=[20,40,60][i];province,city,district='浙江省','杭州市','西湖区';customer='杭州市明德教育集团（模拟）';kind=['教务管理平台','招生管理系统','校园网络升级'][i];tender=1;publish=None if i==1 else '2025-08-15';bid=None
    project=f'{city}{kind}项目{created.year}-{i+1:03d}（模拟）'
    row=(f'MOCK-DIV-{i+1:04d}',owners[team][i//10%4],team,project,customer,amount,gross,profit,stage,publish,close.isoformat(),['力争','确保','冲刺'][i%3],tender,bid,province,city,district,created.isoformat())
    db.execute('INSERT INTO opportunities VALUES('+','.join('?' for _ in row)+')',row)
for key,value in [('as_of_date','2026-11-23'),('row_count','5600'),('dataset_version','sales-diversity-v2')]:db.execute('INSERT INTO dataset_metadata VALUES(?,?) ON CONFLICT(metadata_key) DO UPDATE SET metadata_value=excluded.metadata_value',(key,value))
db.commit();assert not db.execute('PRAGMA foreign_key_check').fetchall();assert db.execute('SELECT COUNT(*) FROM opportunities').fetchone()[0]==5600
with sqlite3.connect(path) as target:db.backup(target)
def literal(v):return 'NULL' if v is None else str(v) if isinstance(v,int) else "'"+str(v).replace("'","''")+"'"
statements=[]
for table in ['business_groups','teams','team_closure','project_owners','opportunities']:
    rows=db.execute(f'SELECT * FROM {table} ORDER BY 1,2').fetchall()
    for start in range(0,len(rows),70):statements.append(f'INSERT OR IGNORE INTO {table} VALUES '+','.join('('+','.join(literal(v) for v in row)+')' for row in rows[start:start+70]))
for key,value in db.execute('SELECT * FROM dataset_metadata ORDER BY metadata_key').fetchall():statements.append(f'INSERT INTO dataset_metadata VALUES ({literal(key)},{literal(value)}) ON CONFLICT(metadata_key) DO UPDATE SET metadata_value=excluded.metadata_value')
statements.append("INSERT INTO dataset_metadata VALUES ('initialized','true') ON CONFLICT(metadata_key) DO UPDATE SET metadata_value='true'")
# Mark ready last, including upgrades of an already initialized hosted database.
version=next(i for i,s in enumerate(statements) if "'dataset_version'" in s);statements.append(statements.pop(version))
(root/'data/seed.json').write_text(json.dumps(statements,ensure_ascii=False),encoding='utf-8')
report={'all_simulated':True,'original_rows_retained':before,'added_rows':600,'total_rows':5600,'version':'sales-diversity-v2','cities':db.execute('SELECT COUNT(DISTINCT city) FROM opportunities').fetchone()[0],'provinces':db.execute('SELECT COUNT(DISTINCT province) FROM opportunities').fetchone()[0],'owners':db.execute('SELECT COUNT(*) FROM project_owners').fetchone()[0],'same_name_owner_names':db.execute('SELECT COUNT(*) FROM (SELECT owner_name FROM project_owners GROUP BY owner_name HAVING COUNT(*)>1)').fetchone()[0],'negative_expected_profit':db.execute('SELECT COUNT(*) FROM opportunities WHERE expected_profit_cents<0').fetchone()[0],'zero_expected_profit':db.execute('SELECT COUNT(*) FROM opportunities WHERE expected_profit_cents=0').fetchone()[0],'min_amount_yuan':db.execute('SELECT MIN(project_amount_cents)/100.0 FROM opportunities').fetchone()[0],'max_amount_yuan':db.execute('SELECT MAX(project_amount_cents)/100.0 FROM opportunities').fetchone()[0],'shared_customer_anchor':'杭州市明德教育集团（模拟）','seed_statements':len(statements)}
(root/'data/diversity-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
