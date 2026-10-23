const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),XLSX=require('xlsx');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-import-atomic-'));
const dbFile=path.join(root,'test.db');
process.env.DATABASE_URL='file:'+dbFile.split(path.sep).join('/');
fs.writeFileSync(dbFile,'');
process.env.LOCAL_IMPORT_SOURCE_DIR=path.join(root,'sources');
process.env.LOCAL_IMPORT_RECOVERY_DIR=path.join(root,'recovery');
fs.writeFileSync(path.join(root,'schema.prisma'),fs.readFileSync('prisma/schema.prisma'));
const schema=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--schema',path.join(root,'schema.prisma'),'--skip-generate'],{encoding:'utf8',env:process.env});
if(schema.status!==0)throw Error((schema.stdout||"")+"\n"+(schema.stderr||""));
const{PrismaClient}=require('../.generated/client');const db=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
let failAssignmentWrite=true;
function wrap(tx){return new Proxy(tx,{get(target,key){if(key==='workAssignment')return new Proxy(target[key],{get(model,method){if(method==='createMany')return async args=>{if(failAssignmentWrite){failAssignmentWrite=false;throw Error('QA failure after worker batch')}return model.createMany(args)};return Reflect.get(model,method)}});return Reflect.get(target,key)}})}
const proxy=new Proxy(db,{get(target,key){if(key==='$transaction')return (callback,options)=>target.$transaction(typeof callback==='function'?tx=>callback(wrap(tx)):callback,options);return Reflect.get(target,key)}});
const cache={};function load(file){if(cache[file])return cache[file];const m={exports:{}};cache[file]=m.exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,{module:m,exports:m.exports,require:n=>n==='@/lib/prisma'?{prisma:proxy}:n.startsWith('@/')?load('src/'+n.slice(2)+'.ts'):require(n),process,Buffer,Date,Response,Request,FormData,File,Blob,URL,URLSearchParams,AbortSignal,Map,Set,console,fetch});return cache[file]=m.exports;}
const{NextRequest}=require('next/server');
const raw={'Họ tên':'QA PHUC HOI','Số CCCD':'000000000091','Nhà máy PV':'QA_FACTORY','Ngày PV':'01/10/2026','Tình trạng':'Đang chờ phỏng vấn'};
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([Object.keys(raw),Object.values(raw)]),'DS_TONG');
const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
function request(commit,preview,workbookBytes=bytes){const form=new FormData();form.append('file',new File([workbookBytes],'QA.xlsx'));form.append('importType','DS_TONG');form.append('confirm',commit?'true':'false');if(preview){form.append('previewFingerprint',preview.previewFingerprint);form.append('importRunId',preview.importRunId)}return new NextRequest('http://127.0.0.1:3000/api/excel-engine/import',{method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'},body:form});}
(async()=>{try{
 await db.factory.create({data:{code:'QA',name:'QA_FACTORY'}});await db.laborStatus.create({data:{name:'Đang chờ phỏng vấn',category:'WAITING'}});
 const route=load('src/app/api/excel-engine/import/route.ts');const preview=await(await route.POST(request(false))).json();assert.equal(preview.success,true,preview.message);assert.ok(preview.importRunId);
 const failed=await route.POST(request(true,preview));const error=await failed.json();assert.equal(failed.status,503,error.message);assert.equal(error.recoveryState,'RETRYABLE');assert.equal(await db.worker.count(),0);assert.equal(await db.workAssignment.count(),0);console.log('PASS actual SQLite rollback: worker batch undone after later assignment failure');
 const response=await route.POST(request(true,preview));const saved=await response.json();assert.equal(saved.success,true,saved.message);assert.equal(await db.worker.count(),1);assert.equal(await db.workAssignment.count(),1);const auditCount=await db.auditLog.count();
 const retry=await(await route.POST(request(true,preview))).json();assert.equal(retry.replayed,true);assert.equal(await db.worker.count(),1);assert.equal(await db.workAssignment.count(),1);assert.equal(await db.auditLog.count(),auditCount);console.log('PASS actual SQLite commit/retry: one worker, one assignment, no repeated audit or source');
 const sourceFile=path.join(process.env.LOCAL_IMPORT_SOURCE_DIR,saved.sourceId+'.json');assert.ok(fs.existsSync(sourceFile));fs.unlinkSync(sourceFile);fs.unlinkSync(path.join(process.env.LOCAL_IMPORT_RECOVERY_DIR,preview.importRunId,'completed.json'));const recovery=load('src/lib/import-recovery.ts');assert.equal((await recovery.listImportRecovery(db))[0].state,'RECOVERABLE');await recovery.recoverCommittedImport(db,preview.importRunId);assert.ok(fs.existsSync(sourceFile));assert.equal(await db.auditLog.count(),auditCount);console.log('PASS receipt-driven source recovery without replaying database writes');
 const worker=await db.worker.findFirst({include:{assignments:true}});const paidRaw={...raw,'Công ty':'QA_FACTORY','Tháng':'T10.2026','Thưởng lần 1':500000};const source={id:'fixture-source',type:'DS_THUONG'},row={row:2,values:paidRaw};
 const bonus=await db.bonusRecord.create({data:{workerId:worker.id,month:'T10.2026',company:'QA_FACTORY',interviewDate:'2026-10-01',bonus1:500000,totalBonus:500000,note:JSON.stringify({source:'SOURCE_EXCEL_ACTUAL_PAID'})}});
 const links=load('src/lib/source-assignment-link.ts');const decision=links.sourceLinkDecision(worker,source,row);assert.equal(decision.state,'MATCHED');const input={assignmentId:decision.assignmentId,linkToken:decision.linkToken};await db.$transaction(tx=>links.linkSourceBonus(tx,source,row,input,'QA'));assert.equal((await db.bonusRecord.findUnique({where:{id:bonus.id}})).assignmentId,worker.assignments[0].id);const second=await db.$transaction(tx=>links.linkSourceBonus(tx,source,row,input,'QA'));assert.equal(second.linked,false);console.log('PASS actual source-to-assignment link with audit and idempotent repeat');

 const raw2={...raw,'Họ tên':'QA SECOND','Số CCCD':'000000000092','Mã NV':'EMP2'};
 const person2=await db.worker.create({data:{idCard:raw2['Số CCCD'],fullName:raw2['Họ tên']}});
 const makeBonus=(code,month)=>db.bonusRecord.create({data:{workerId:person2.id,month,company:'QA_FACTORY',interviewDate:'2026-10-01',workerCode:code,note:JSON.stringify({source:'SOURCE_EXCEL_ACTUAL_PAID',sourceValues:{'Họ tên':raw2['Họ tên']}})}});
 const wrong=await makeBonus('OTHER','T09.2026'),correct=await makeBonus('EMP2','T10.2026');
 const book2=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book2,XLSX.utils.aoa_to_sheet([Object.keys(raw2),Object.values(raw2)]),'DS_TONG');const bytes2=XLSX.write(book2,{type:'buffer',bookType:'xlsx'});
 const preview2=await(await route.POST(request(false,null,bytes2))).json();const saved2=await(await route.POST(request(true,preview2,bytes2))).json();assert.equal(saved2.success,true,saved2.message);
 assert.equal((await db.bonusRecord.findUnique({where:{id:wrong.id}})).assignmentId,null,'automatic linking must not link a different employee code');assert.ok((await db.bonusRecord.findUnique({where:{id:correct.id}})).assignmentId);
 console.log('PASS DS_TONG automatic linking checks historical bonus employee code');
 console.log('Fixture only: '+root);
 }finally{await db.$disconnect()}})().catch(error=>{console.error(error);process.exitCode=1});
