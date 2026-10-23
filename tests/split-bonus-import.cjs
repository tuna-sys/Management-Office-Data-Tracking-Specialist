const fs=require('fs'),assert=require('node:assert/strict');
const prefix=fs.readFileSync('tests/bonus-import-acceptance.cjs','utf8').split('const raw = {')[0];
const {parseBonusImportRow}=new Function('require',prefix+'return bonusImport;')(require);
const reportPrefix=fs.readFileSync('tests/source-paid-report.cjs','utf8').split('const row = ')[0];
const report=new Function('require',reportPrefix+'return report;')(require);
const raw={'Họ tên':'QA','Số CCCD':'000000000001','Công ty':'QA','Tháng':'T05.2026','Ngày PV':'01/05/2026','Tổng thưởng':999};
for(let i=1;i<=7;i++){raw['Tên thưởng L'+i]='Mốc '+i;raw['Tiền thưởng L'+i]=(i*100000).toLocaleString('en-US')+' đ';raw['Lý do L'+i]='Đủ '+(i*7)+' công';raw['Thưởng lần '+i]=9999999;}
const p=parseBonusImportRow(raw);
assert.deepEqual(Array.from(p.bonuses),[100000,200000,300000,400000,500000,600000,700000]);assert.equal(p.totalBonus,2800000);
assert.equal(p.rewardDetails[0].name,'Mốc 1');assert.equal(p.rewardDetails[0].reason,'Đủ 7 công');
const result=report([{id:'qa',type:'DS_THUONG',file:'QA.xlsx',rows:[{row:2,values:raw}]}],[],[],new URLSearchParams());
assert.equal(result.total,2800000);assert.match(result.rows[0].sourceRewards,/Mốc 1/);assert.match(result.rows[0].sourceRewards,/Đủ 7 công/);
raw['Tiền thưởng L1']='';raw['Tiền thưởng L2']='-';raw['Tiền thưởng L3']=0;
assert.deepEqual(Array.from(parseBonusImportRow(raw).bonuses).slice(0,3),[0,0,0]);
console.log('PASS split L1-L7 amounts, names/reasons, no double counting, total from split amounts, empty/zero values override legacy');
