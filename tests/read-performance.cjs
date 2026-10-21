const cp=require('child_process'),fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('assert/strict');
const N=Number(process.env.PERF_ROWS||2000);
const baselineRef=process.env.PERF_BASELINE_REF||'d58ad67d3a3a27cc0852decda3093b3c82306b26';
const baselineFiles={duplicates:'src/app/api/duplicates/route.ts',workers:'src/app/api/worker-source-rows/route.ts',reports:'src/app/api/reports/route.ts'};
let version='v1',reads=0;
const workers=Array.from({length:N},(_,i)=>{const card=String(100000000000+i),phone='0'+String(900000000+i);const a={id:'a'+i,workerId:'w'+i,interviewDate:'04/05/2026',interviewFactory:'ALPHA',employeeCode:'EMP'+i,status:'NH',onboardingMonth:'T05.2026',createdAt:'2026-01-01',updatedAt:'v1',events:[],bonusRecords:[]};return {id:'w'+i,idCard:card,fullName:'TEST WORKER '+i,phone,createdAt:'2026-01-01',updatedAt:'v1',archivedAt:null,assignments:[a],bonusRecords:[],bankAccounts:[]};});
const sources=[{id:'source',file:'synthetic.xlsx',sheet:'DS Tổng',type:'DS_TONG',createdAt:'2026-01-01',rows:workers.map((w,i)=>({row:i+2,warnings:[],duplicates:['Dòng '+(i+2)+': Trùng lặp nội bộ file với dòng 1'],values:{'Họ và tên':w.fullName,'Số CCCD':w.idCard,'Ngày PV':'04/05/2026','Nhà máy PV':'ALPHA','Mã nhân viên':'EMP'+i,'Tình trạng':'NH','SĐT':i%5===0?'0999999999':w.phone,'Tháng nhận việc':'Tháng 05'}}))}];
const deps={
 '@/lib/local-request':{guard:async()=>null},'@/lib/read-data-version':{readDataVersion:async()=>version},
 '@/lib/prisma':{prisma:{worker:{findMany:async()=>{reads++;return workers}},laborStatus:{findMany:async()=>[]},auditLog:{findMany:async()=>[]},policyEnrollment:{findMany:async()=>[]},bonusRecord:{findMany:async()=>[]}}},
 '@/lib/import-source-store':{readImportSources:async()=>sources},
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200})}},
 'node:fs/promises':{readFile:async()=>{throw Error('ENOENT')}},'node:fs':{existsSync:()=>false},
};
function load(file){const m={exports:{}};vm.runInNewContext(ts.transpileModule(file.startsWith('baseline:')?cp.execFileSync('git',['show',baselineRef+':'+baselineFiles[file.slice(9)]],{encoding:'utf8'}):fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,Date,URLSearchParams,Buffer,process,console,require:n=>n in deps?deps[n]:n.startsWith('@/')?(deps[n]=load('src/'+n.slice(2)+'.ts')):require(n)});return m.exports;}
const request=query=>({nextUrl:{searchParams:new URLSearchParams(query)}});
async function timed(route,query){const start=performance.now();const r=await route.GET(request(query));assert.equal(r.body.success,true,JSON.stringify(r.body));return {body:r.body,ms:Math.round((performance.now()-start)*10)/10,bytes:Buffer.byteLength(JSON.stringify(r.body))};}
const plain=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 const before=load('baseline:duplicates'),after=load('src/app/api/duplicates/route.ts');
 const baseline=await timed(before,'');const legacy=await timed(after,'');assert.deepEqual(plain(legacy.body),plain(baseline.body),'classification, counts and all detail values must match baseline');
 const cold=await timed(after,'view=list&page=1&pageSize=20');const readCount=reads;const warm=await timed(after,'view=list&page=2&pageSize=20');assert.equal(reads,readCount,'page changes must reuse the snapshot');assert.equal(cold.body.data.length,20);assert.equal(warm.body.data.length,20);assert.equal(cold.body.filteredTotal,Math.ceil(N/5));assert.equal(cold.body.data[0].leftSide,undefined);assert.equal(cold.body.data[0].editableFields,undefined);
 const detail=await timed(after,'id='+encodeURIComponent(cold.body.data[0].id));assert.ok(detail.body.data.editableFields.length);assert.deepEqual(plain(detail.body.data),plain(baseline.body.data[0]));assert.equal(reads,readCount,'detail opening must not scan every worker again');
 const search=await timed(after,'view=list&search=TEST+WORKER+0');assert.ok(search.body.data.every(a=>a.fullName.includes('TEST WORKER 0')));
 const missing=await after.GET(request('id=missing'));assert.equal(missing.status,404);
 version='v2';await timed(after,'view=list');assert.equal(reads,readCount+1,'version changes must rebuild the snapshot');
 const oldWorkers=load('baseline:workers'),newWorkers=load('src/app/api/worker-source-rows/route.ts');
 const workerBefore=await timed(oldWorkers,'page=1&pageSize=20');const workerCold=await timed(newWorkers,'page=1&pageSize=20');assert.deepEqual(plain(workerCold.body),plain(workerBefore.body),'worker rows, totals and options must match baseline');
 const workerReads=reads;const workerWarm=await timed(newWorkers,'page=2&pageSize=20&view=list');assert.equal(reads,workerReads,'worker pagination must not reload all DB relations');assert.equal(workerWarm.body.unlinkedBonusRows,undefined);assert.equal(workerWarm.body.unlinkedBonusRowCount,0);
 const oldReports=load('baseline:reports'),newReports=load('src/app/api/reports/route.ts');
 const reportBefore=await timed(oldReports,'');const reportCold=await timed(newReports,'');assert.deepEqual(plain(reportCold.body),plain(reportBefore.body),'reports must match baseline');const reportReads=reads;const reportWarm=await timed(newReports,'');assert.equal(reads,reportReads);
 sources.push({id:'reward-source',type:'DS_THUONG',file:'reward.xlsx',createdAt:'2026-01-01',rows:workers.slice(0,3).map((w,i)=>({row:i+2,warnings:[],duplicates:[],values:{'Họ tên':w.fullName,'Số CCCD':w.idCard,'Công ty':'ALPHA','Mã nhân viên':'EMP'+i,'Ngày PV':'04/05/2026','Tháng':'Tháng 05','Thưởng lần 1':'1000'}}))});version='v3';
 const fullRewardReport=await timed(oldReports,'');const overview=await timed(newReports,'view=overview');assert.equal(overview.body.data.sourcePaid.rowCount,3);assert.equal(overview.body.data.sourcePaid.rows,undefined);assert.equal(overview.body.data.sourcePaid.total,fullRewardReport.body.data.sourcePaid.total);assert.deepEqual(plain(overview.body.data.recruitment),plain(fullRewardReport.body.data.recruitment));
 const rowPage=await timed(newReports,'view=sourceRows&page=2&pageSize=2');assert.equal(rowPage.body.data.rows.length,1);assert.equal(rowPage.body.data.filteredTotal,3);assert.deepEqual(plain(rowPage.body.data.rows),plain(fullRewardReport.body.data.sourcePaid.rows.slice(2)));
 const searchedRewards=await timed(newReports,'view=sourceRows&page=1&pageSize=2&tableSearch=TEST+WORKER+1');assert.equal(searchedRewards.body.data.filteredTotal,1);assert.equal(searchedRewards.body.data.rows[0].name,'TEST WORKER 1');
 const cache=deps['@/lib/read-cache'];cache.invalidateReadCache();let calls=0;await Promise.all(Array.from({length:20},()=>cache.cachedRead('parallel','1',async()=>{calls++;return 7})));assert.equal(calls,1,'concurrent reads must share one in-flight computation');
 await cache.cachedRead('parallel','2',async()=>{calls++;return 8});assert.equal(calls,2);cache.invalidateReadCache();await cache.cachedRead('parallel','2',async()=>{calls++;return 9});assert.equal(calls,3);
 await assert.rejects(cache.cachedRead('failure','1',async()=>{throw Error('load failed')}));assert.equal(await cache.cachedRead('failure','1',async()=>42),42,'failed loads must be retryable');
 for(let i=0;i<10;i++)await cache.cachedRead('bounded'+i,'1',async()=>i);let reloaded=false;await cache.cachedRead('bounded0','1',async()=>{reloaded=true;return 0});assert.equal(reloaded,true,'cache must evict entries beyond its bound');
 let released;const pending=cache.cachedRead('race','1',()=>new Promise(resolve=>released=resolve));await Promise.resolve();cache.invalidateReadCache();released('old');await pending;assert.equal(await cache.cachedRead('race','1',async()=>'fresh'),'fresh','an invalidated in-flight load must not repopulate the cache');
 console.log(JSON.stringify({syntheticWorkers:N,alerts:baseline.body.data.length,duplicates:{baselineMs:baseline.ms,baselineBytes:baseline.bytes,coldListMs:cold.ms,warmPageMs:warm.ms,listBytes:cold.bytes,detailMs:detail.ms},workers:{baselineMs:workerBefore.ms,coldMs:workerCold.ms,warmPageMs:workerWarm.ms},reports:{baselineMs:reportBefore.ms,coldMs:reportCold.ms,warmMs:reportWarm.ms}},null,2));
 console.log('PASS baseline equality, pagination/search/detail, data-version refresh, concurrency, retry, bounded cache and invalidation races; no database or source writes');
})().catch(e=>{console.error(e);process.exitCode=1});
