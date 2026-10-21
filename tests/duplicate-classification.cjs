const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
let source, workers, writes=0;
const deps={
  'xlsx':require('xlsx'),
  'next/server':{NextResponse:{json:body=>body}},
  '@/lib/prisma':{prisma:{worker:{findMany:async()=>workers},laborStatus:{findMany:async()=>[]}}},
  '@/lib/local-request':{guard:async()=>null},
  '@/lib/import-source-store':{readImportSources:async()=>[source]},
  'node:fs/promises':{readFile:async()=>{throw Error('ENOENT')},mkdir:async()=>{writes++;},writeFile:async()=>{writes++;}}
};
function load(file){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,Date,Buffer,process,require:n=>n in deps?deps[n]:n.startsWith('@/lib/')?(deps[n]=load('src/lib/'+n.slice(6)+'.ts')):require(n)});return m.exports;}
const route=load('src/app/api/duplicates/route.ts');
function setup(type='DS_TONG'){
 const a={id:'a',workerId:'w',interviewFactory:'ALPHA',interviewDate:'05/05/2026',employeeCode:'EMP1',status:'NH',onboardingMonth:'T05.2026'};
 const w={id:'w',idCard:'001099000001',fullName:'TEST WORKER',phone:'0900000001',assignments:[a],bonusRecords:[],bankAccounts:[]};workers=[w];
 source={id:'s',file:'mock.xlsx',type,rows:[{row:2,warnings:[],duplicates:['Dòng 2: Trùng lặp nội bộ file với dòng 1'],values:{'Họ và tên':w.fullName,'Số CCCD':w.idCard,'Nhà máy PV':'ALPHA','Ngày PV':'05/05/2026','Mã nhân viên':'EMP1','Tình trạng':'NH','SĐT':w.phone,'Tháng':'Tháng 05'}}]};
 if(type==='DS_THUONG'){Object.assign(source.rows[0].values,{'Công ty':'ALPHA','Thưởng lần 1':1000000,'Tổng thưởng':1000000});w.bonusRecords=[{id:'b',workerId:'w',assignmentId:'a',company:'ALPHA',month:'T05.2026',workerCode:'EMP1',bonus1:1000000,totalBonus:1000000}];}
 return {w,a,raw:source.rows[0].values};
}
(async()=>{
 setup();let r=await route.GET({});assert.equal(r.success,true);assert.equal(r.data.length,0,'equivalent source must disappear');assert.equal(r.counts.unchangedCount,1);
 let f=setup();delete f.w.phone;r=await route.GET({});assert.equal(r.data[0].category,'MERGE_INFO','missing phone is an addition');
 f=setup();f.raw['SĐT']='0900000002';r=await route.GET({});assert.equal(r.data[0].category,'INTERVIEW_CONFLICT');
 f=setup();f.raw['Ngày bắt đầu làm']='06/05/2026';r=await route.GET({});assert.equal(r.data[0].category,'MERGE_INFO');assert.ok(r.data[0].extraRows.some(x=>x.label==='Ngày bắt đầu làm'));assert.equal(r.data[0].canApprove,false,'new fields unsupported by approval must remain for profile editing');
 f=setup('DS_THUONG');r=await route.GET({});assert.equal(r.data.length,0,'money formatting and month writing must not create work');
 f=setup('DS_THUONG');f.raw['Thưởng lần 1']='Không đạt thưởng';delete f.raw['Tổng thưởng'];Object.assign(f.w.bonusRecords[0],{bonus1:0,totalBonus:0,note:JSON.stringify({rewards:['Không đạt thưởng']})});r=await route.GET({});assert.equal(r.data.length,0,'stored source notes must not be treated as missing');
 delete f.w.bonusRecords[0].note;r=await route.GET({});assert.equal(r.data[0].category,'MERGE_INFO','new source note must remain visible');
 f=setup('DS_THUONG');f.raw['Thưởng lần 1']=2000000;f.raw['Tổng thưởng']=2000000;r=await route.GET({});assert.equal(r.data[0].category,'INTERVIEW_CONFLICT','different money requires verification');
 f=setup('DS_THUONG');f.raw['Tháng']='T05.2027';r=await route.GET({});assert.equal(r.data.length,1,'different reward year must never be hidden');assert.equal(r.data[0].leftSide.month,'—','do not compare to a reward for another year');
 f=setup();f.w.assignments=[];r=await route.GET({});assert.equal(r.data.length,1,'missing assignment must remain visible');
 f=setup();f.raw['Ngày cấp']='01/01/2020';f.w.idCardDate='02/01/2020';r=await route.GET({});assert.equal(r.data[0].category,'INTERVIEW_CONFLICT');assert.equal(r.data[0].canApprove,false,'unsupported changes cannot be silently approved');
 f=setup();f.raw['Mã NV']='EMP1';f.w.code='OLD_EMP_CODE';r=await route.GET({});assert.equal(r.data.length,0,'historical worker code must not conflict with the matched interview code');
 assert.equal(writes,0,'classification must never write');console.log('PASS 12 classification scenarios; zero writes');
})().catch(e=>{console.error(e);process.exitCode=1});
