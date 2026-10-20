const fs = require('fs'), ts = require('typescript'), vm = require('vm'), assert = require('assert/strict');
const deps = { 'node:crypto': require('crypto') };
function load(file) { const m = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { module: m, exports: m.exports, Date, require: n => { if (n in deps)
        return deps[n]; if (n.startsWith('@/lib/'))
        return deps[n] = load('src/lib/' + n.slice(6) + '.ts'); return require(n); } }); return m.exports; }
const a = { id: 'a', workerId: 'w', interviewDate: '2026-05-23', interviewFactory: 'Vsip', employeeCode: 'OLD', status: 'NH', leaveDate: '2026-05-24' };
const w = { id: 'w', idCard: '002193005426', fullName: 'TEST', phone: '0900000001', assignments: [a] };
const src = { id: 's', type: 'DS_TONG', file: 'test.xlsx' };
const row = { row: 2, values: { 'Họ và tên': 'TEST', 'Số CCCD': w.idCard, 'Nhà máy PV': 'Goertek', 'Ngày PV': '23/05/2026', 'Mã NV': 'NEW', 'Tình trạng': 'NH', 'Ngày NH': '01/06/2026' } };
const events = [], audits = [], created = [];
let updates = 0;
const tx = { worker: { findUnique: async () => w, update: async ({ data }) => { updates++; Object.assign(w, data); return w; } }, workAssignment: { update: async ({ data }) => { updates++; Object.assign(a, data); return a; }, create: async ({ data }) => { created.push(data); return { id: 'new', ...data }; } }, assignmentEvent: { create: async ({ data }) => { events.push(data); return data; } }, auditLog: { findFirst: async () => null, create: async ({ data }) => { audits.push(data); return data; } }, policyEnrollment: { count: async () => 0 } };
(async () => {
    const policy = load('src/lib/duplicate-resolution.ts');
    const request = (resolution, extra = {}) => ({ resolution, confirmResolution: true, reviewerNote: 'Đã đối chiếu nguồn', targetAssignmentId: 'a', reviewToken: policy.reviewToken(w, a, row.values), ...extra });
    await assert.rejects(policy.resolveReview(tx, src, row, { resolution: 'APPLY_FIELDS' }, 'reviewer'), /xác nhận|lý do/);
    assert.equal(updates, 0);
    let result = await policy.resolveReview(tx, src, row, request('KEEP_EXISTING'), 'reviewer');
    assert.equal(result.removeSource, true);
    assert.equal(updates, 0);
    assert.equal(created.length, 0);
    assert.equal(a.interviewFactory, 'Vsip');
    assert.equal(JSON.parse(audits[0].details).source.values['Nhà máy PV'], 'Goertek');
    await policy.resolveReview(tx, src, row, request('APPLY_FIELDS', { selectedFields: ['assignment.employeeCode'] }), 'reviewer');
    assert.equal(a.employeeCode, 'NEW');
    assert.equal(a.interviewFactory, 'Vsip');
    assert.equal(a.leaveDate, '2026-05-24');
    assert.ok(events.some(e => e.note.includes('OLD') && e.note.includes('NEW')));
    await assert.rejects(policy.resolveReview(tx, src, row, request('APPLY_FIELDS', { selectedFields: ['worker.idCard'] }), 'reviewer'), /trường/);
    await assert.rejects(policy.resolveReview(tx, src, row, request('APPLY_FIELDS', { selectedFields: ['assignment.employeeCode'], reviewToken: 'stale' }), 'reviewer'), /thay đổi/);
    await assert.rejects(policy.resolveReview(tx, src, row, request('NEW_INTERVIEW', { correctedInterviewDate: '2026-05-23' }), 'reviewer'), /một lần|đã có/);
    result = await policy.resolveReview(tx, src, row, request('NEW_INTERVIEW', { correctedInterviewDate: '2026-05-25' }), 'reviewer');
    assert.equal(created.length, 1);
    assert.equal(a.interviewDate, '2026-05-23');
    assert.equal(a.interviewFactory, 'Vsip');
    assert.equal(created[0].interviewFactory, 'Goertek');
    assert.equal(result.removeSource, true);
    result=await policy.resolveReview(tx,src,row,{resolution:'APPROVE_SOURCE',confirmResolution:true,targetAssignmentId:'a',reviewToken:policy.reviewToken(w,a,row.values)},'reviewer');
    assert.equal(result.removeSource,true);assert.equal(a.interviewFactory,'Goertek');assert.equal(a.leaveDate,'01/06/2026');
    const approved=JSON.parse(audits[audits.length-1].details);assert.equal(approved.before.assignment.interviewFactory,'Vsip');assert.equal(approved.after.assignment.interviewFactory,'Goertek');assert.equal(approved.reviewer,'reviewer');assert.equal(approved.decision,'APPROVE_SOURCE');
    const previousUpdates=updates;
    result=await policy.resolveReview(tx,src,row,{resolution:'DISCARD_SOURCE',confirmResolution:true,targetAssignmentId:'a',reviewToken:policy.reviewToken(w,a,row.values)},'reviewer');assert.equal(result.removeSource,true);assert.equal(updates,previousUpdates);
    let savedBonus;
    tx.bonusRecord={findFirst:async()=>null,create:async({data})=>{savedBonus={id:'bonus',...data};return savedBonus;}};
    const rewardRow={row:3,values:{...row.values,'Công ty':'Goertek','Tháng':'T05.2026','Thưởng lần 1':1000}};
    result=await policy.resolveReview(tx,{...src,type:'DS_THUONG'},rewardRow,{resolution:'APPROVE_SOURCE',confirmResolution:true,targetAssignmentId:'a',reviewToken:policy.reviewToken(w,a,rewardRow.values)},'reviewer');assert.equal(result.removeSource,true);assert.equal(savedBonus.totalBonus,1000);assert.equal(savedBonus.assignmentId,'a');assert.equal(JSON.parse(audits[audits.length-1].details).after.bonus.totalBonus,1000);
    console.log('PASS reviewer decisions: confirmed discard, selected-field updates, before/after history, stale and protected-field rejection, corrected-date history');
})().catch(e => { console.error(e); process.exitCode = 1; });
