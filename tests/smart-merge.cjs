const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const assert = require('assert/strict');
const X = require('xlsx');

const deps = { xlsx: X };
function load(f) {
  const m = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    {
      module: m,
      exports: m.exports,
      Buffer,
      Date,
      require: (n) => { if (n === '@/lib/duplicate-check') return require('./load-duplicate-check.js');
        if (!(n in deps)) throw Error(n);
        return deps[n];
      },
    }
  );
  return m.exports;
}

deps['@/lib/import-review'] = load('src/lib/import-review.ts');
deps['@/lib/worker-validation'] = load('src/lib/worker-validation.ts');
deps['@/lib/source-format'] = load('src/lib/source-format.ts');
deps['@/lib/factory-matching'] = load('src/lib/factory-matching.ts');
deps['@/lib/worker-import'] = load('src/lib/worker-import.ts');
deps['@/lib/auth'] = {
  guard: async () => null,
  identity: async () => ({ username: 'QA_MERGE_TESTER' }),
};
deps['@/lib/domain'] = {
  assignmentRelations: async () => {},
  today: () => '2026-10-15',
  day: (v) => v,
};

// In-memory mock database
const dbWorkers = [];
const dbAssignments = [];
const dbBanks = [];
const dbEvents = [];
const dbAudits = [];

const mockPrisma = {
  worker: {
    findMany: async () => dbWorkers.map(w => ({
      ...w,
      assignments: dbAssignments.filter(a => a.workerId === w.id),
      bankAccounts: dbBanks.filter(b => b.workerId === w.id)
    })),
    findUnique: async ({ where }) => dbWorkers.find(w => w.idCard === where.idCard || w.id === where.id) || null,
    create: async ({ data }) => {
      const nw = { id: 'w-' + (dbWorkers.length + 1), ...data };
      dbWorkers.push(nw);
      return nw;
    },
    update: async ({ where, data }) => {
      const target = dbWorkers.find(w => w.id === where.id || w.idCard === where.idCard);
      Object.assign(target, data);
      return target;
    }
  },
  workAssignment: {
    create: async ({ data }) => {
      const na = { id: 'a-' + (dbAssignments.length + 1), ...data };
      dbAssignments.push(na);
      return na;
    },
    update: async ({ where, data }) => {
      const target = dbAssignments.find(a => a.id === where.id);
      Object.assign(target, data);
      return target;
    }
  },
  bankAccount: {
    findFirst: async ({ where }) => dbBanks.find(b => b.workerId === where.workerId && b.accountNumber === where.accountNumber) || null,
    create: async ({ data }) => {
      const nb = { id: 'b-' + (dbBanks.length + 1), ...data };
      dbBanks.push(nb);
      return nb;
    }
  },
  laborStatus: {
    findMany: async () => [{ name: 'Đang làm việc', warnsDuplicate: true, isActive: true }],
    upsert: async () => {}
  },
  assignmentEvent: {
    create: async ({ data }) => { dbEvents.push(data); return data; }
  },
  auditLog: {
    create: async ({ data }) => { dbAudits.push(data); return data; }
  },
  $transaction: async (fn) => fn(mockPrisma)
};

deps['@/lib/prisma'] = { prisma: mockPrisma };
deps['next/server'] = {
  NextResponse: { json: (body, options) => ({ body, options }) },
};
deps['@/lib/import-source-store'] = {
  saveImportSource: async () => 'mock-source-id',
};

deps['@/lib/bonus-import'] = load('src/lib/bonus-import.ts');
deps['node:crypto'] = { default: require('node:crypto') };
mockPrisma.worker.createMany = async ({data}) => { dbWorkers.push(...data); return {count:data.length}; };
mockPrisma.workAssignment.createMany = async ({data}) => { dbAssignments.push(...data); return {count:data.length}; };
mockPrisma.assignmentEvent.createMany = async ({data}) => { dbEvents.push(...data); return {count:data.length}; };
mockPrisma.bonusRecord = {findMany:async()=>[]};
const route = load('src/app/api/excel-engine/import/route.ts');

function makeRequest(rows, commit, smartMerge = true) {
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), 'DS_TONG');
  const bytes = X.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const file = { name: 'test.xlsx', size: bytes.length, arrayBuffer: async () => bytes };
  return {
    formData: async () => ({
      get: (k) => {
        if (k === 'file') return file;
        if (k === 'confirm') return commit ? 'true' : 'false';
        if (k === 'importType') return 'DS_TONG';
        if (k === 'smartMerge') return smartMerge ? 'true' : 'false';
        return null;
      }
    })
  };
}

(async () => {
  console.log('--- Step 1: Initial Import of Basic Worker ---');
  const step1Rows = [
    {
      'Họ và tên': 'NGUYỄN VĂN MERGE',
      'số CCCD': '001099000001',
      'Nhà máy PV': 'LUXSHARE-QC',
      'Ngày PV': '15/10/2026',
      'Tình trạng': 'Đang chờ phỏng vấn'
    }
  ];
  const r1 = await route.POST(makeRequest(step1Rows, true));
  assert.equal(r1.body.success, true);
  assert.equal(r1.body.normalizedSaved, 1);
  assert.equal(dbWorkers.length, 1);
  assert.equal(dbAssignments.length, 1);
  assert.ok(!dbWorkers[0].phone);
  assert.ok(!dbAssignments[0].employeeCode);

  console.log('--- Step 2: Second Import with Supplementary Fields (Smart Merge ON) ---');
  const step2Rows = [
    {
      'Họ và tên': 'NGUYỄN VĂN MERGE',
      'số CCCD': '001099000001',
      'Nhà máy PV': 'LUXSHARE-QC',
      'Ngày PV': '15/10/2026',
      'SĐT': '0988776655',
      'Mã nhân viên': 'LX-8899',
      'Team': 'Team Ép Nhựa',
      'Ngày bắt đầu làm': '20/10/2026',
      'STK': '998877665544',
      'Ngân hàng': 'Vietcombank'
    }
  ];

  // Preview check
  const r2Preview = await route.POST(makeRequest(step2Rows, false));
  assert.equal(r2Preview.body.summary.mergedCount, 1);
  assert.equal(r2Preview.body.summary.readyCount, 1);
  assert.equal(r2Preview.body.summary.duplicateCount, 0);

  // Commit check
  const r2Commit = await route.POST(makeRequest(step2Rows, true));
  assert.equal(r2Commit.body.success, true);
  assert.equal(r2Commit.body.normalizedSaved, 1);
  assert.equal(dbWorkers.length, 1, 'Still 1 worker, no duplicate worker created');
  assert.equal(dbAssignments.length, 1, 'Still 1 assignment, no duplicate assignment created');
  assert.equal(dbWorkers[0].phone, '0988776655', 'Worker phone supplemented');
  assert.equal(dbAssignments[0].employeeCode, 'LX-8899', 'Assignment employeeCode supplemented');
  assert.equal(dbAssignments[0].team, 'Team Ép Nhựa', 'Assignment team supplemented');
  assert.equal(dbAssignments[0].startDate, '20/10/2026', 'Assignment startDate supplemented');
  assert.equal(dbBanks.length, 1, 'Bank account created from supplemental STK');
  assert.equal(dbBanks[0].accountNumber, '998877665544');
  assert.equal(dbBanks[0].bankName, 'Vietcombank');

  console.log('--- Step 3: Third Import with Exact Same File (No new fields to supplement) ---');
  const r3 = await route.POST(makeRequest(step2Rows, false));
  assert.equal(r3.body.summary.mergedCount, 0, 'No fields to merge');
  assert.equal(r3.body.summary.duplicateCount, 1, 'Correctly detected as 100% duplicate');
  assert.equal(r3.body.summary.readyCount, 0);

  console.log('✅ ALL SMART MERGE AUTOMATED TESTS PASSED SUCCESSFULLY!');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
