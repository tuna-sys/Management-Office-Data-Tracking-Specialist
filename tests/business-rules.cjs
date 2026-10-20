const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, deps = {}) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { module: m, exports: m.exports, Date, URLSearchParams,
    require: n => { if (n === '@/lib/duplicate-check') return require('./load-duplicate-check.js');  if (!(n in deps)) throw Error(`Unexpected dependency ${n}`); return deps[n]; } });
  return m.exports;
}
const server = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) } };
const validation = load('src/lib/worker-validation.ts');
const domain = { ...load('src/lib/domain.ts', { 'next/server': server, '@/lib/worker-validation': validation }), today: () => '2026-10-17' };
const auth = { guard: async () => null, identity: async () => ({ username: 'tester' }) };
const stamp = new Date('2026-10-01T00:00:00Z');
function route(file, tx) {
  return load(file, { 'next/server': server, '@/lib/domain': domain, '@/lib/local-request': auth,
    '@/lib/worker-validation': validation, '@/lib/reporting': {},
    '@/lib/prisma': { prisma: { $transaction: fn => fn(tx) } } });
}
const request = body => ({ json: async () => body });
function workerFixture(status = 'Đang làm việc') {
  const a = { id: 'a', status, interviewFactory: 'A', interviewDate: '2026-09-01',
    passedDate: '2026-09-02', interviewResult: 'PASS', startDate: '2026-09-03', updatedAt: stamp };
  const w = { id: 'w', fullName: 'Test', idCard: '123456789012', updatedAt: stamp, assignments: [a] };
  const tx = { worker: { findUnique: async () => w, update: async () => w },
    workAssignment: { update: async () => a }, assignmentEvent: { create: async () => ({}) },
    policyEnrollment: { count: async () => 0 }, auditLog: { create: async () => ({}) },
    laborStatus: { findMany: async () => [], findUnique: async ({where}) => ({ name: where.name, isActive: true,
      endsAssignment: ['Nghỉ hẳn', 'Hết hợp đồng', 'Bỏ xưởng', 'Bỏ vì sức khỏe', 'Hết phí', 'Kết thúc tùy chỉnh'].includes(where.name) }) } };
  const body = { assignmentId: 'a', updatedAt: stamp.toISOString(), assignmentUpdatedAt: stamp.toISOString() };
  return { tx, body };
}
test('reject future work-day confirmation', async () => {
  const {tx, body} = workerFixture();
  const result = await route('src/app/api/workers/[id]/route.ts', tx).PUT(request({ ...body,
    confirmedWorkDays: 30, workDaysAsOf: '2026-11-01' }), {params: {id:'w'}});
  assert.equal(result.status, 400);
});
for (const status of ['Nghỉ hẳn', 'Hết hợp đồng', 'Bỏ xưởng', 'Bỏ vì sức khỏe', 'Hết phí', 'Kết thúc tùy chỉnh']) {
  test(`do not reopen ended assignment: ${status}`, async () => {
    const {tx, body} = workerFixture(status);
    const result = await route('src/app/api/workers/[id]/route.ts', tx).PUT(request({...body, status:'Đang làm việc'}), {params:{id:'w'}});
    assert.equal(result.status, 409);
  });
  test(`do not start rehire in ended status: ${status}`, async () => {
    const {tx} = workerFixture();
    const result = await route('src/app/api/workers/route.ts', tx).POST(request({
      fullName:'Test',idCard:'123456789012',interviewFactory:'A',status,
      leaveDate:'2026-10-16',leaveReason:'Test',
    }));
    assert.equal(result.status,400);
    assert.match(result.body.message,/Đợt tuyển mới/);
  });
}
test('allow current work-day confirmation', async () => {
  const {tx, body} = workerFixture();
  const result = await route('src/app/api/workers/[id]/route.ts', tx).PUT(request({...body,
    confirmedWorkDays: 20, workDaysAsOf:'2026-10-17'}), {params:{id:'w'}});
  assert.equal(result.status, 200);
});
for (const [workDaysAsOf, expected] of [['2026-11-01',400], ['2026-10-16',400], [null,400], ['2026-10-15',200], ['2026-10-14',200]]) {
  test(`stage uses work confirmed by achievement date: ${workDaysAsOf}`, async () => {
    const s = { id:'s', updatedAt:stamp, thresholdDays:15, payments:[], enrollment:{assignment:{
      passedDate:'2026-09-02', confirmedWorkDays:20, workDaysAsOf }} };
    const tx = {rewardStage:{ findUnique:async()=>s, update:async()=>s },auditLog:{create:async()=>({})}};
    const result = await route('src/app/api/enrollments/route.ts',tx).PUT(request({id:'s',updatedAt:stamp.toISOString(),
      eligible:true,achieved:true,eligibleAsOf:'2026-10-17',achievedOn:'2026-10-15'}));
    assert.equal(result.status,expected);
  });
}
test('archiving keeps financial history and filters', () => {
  const reporting = load('src/lib/reporting.ts', {'@/lib/domain':domain,'@/lib/worker-validation':validation});
  const worker = {archivedAt:null};
  const e = {factory:'A', policyName:'P', assignment:{worker,interviewDate:'2026-10-01',interviewFactory:'A'},
    stages:[{label:'M',amount:100000,eligible:true,achieved:true,payments:[{amount:40000}]}]};
  const before = reporting.rewardReport([e],new URLSearchParams()).summary;
  worker.archivedAt = '2026-10-17';
  const after = reporting.rewardReport([e],new URLSearchParams()).summary;
  assert.deepEqual(after,before);
  assert.equal(after.outstanding,60000);
  assert.equal(reporting.rewardReport([e],new URLSearchParams('factory=B')).summary.paid,0);
});
