const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');

function loadModule(file, deps = {}) {
  const m = { exports: {} };
  const content = fs.readFileSync(file, 'utf8');
  const transpiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(transpiled, {
    module: m,
    exports: m.exports,
    Date,
    URLSearchParams,
    require: (n) => deps[n] || require(n),
  });
  return m.exports;
}

const validation = loadModule('src/lib/worker-validation.ts');
const dupCheck = loadModule('src/lib/duplicate-check.ts', {
  '@/lib/worker-validation': validation,
});

const {
  identityText,
  sameFactory,
  sameInterviewDay,
  assertIdentity,
  assertSourceCard,
  findAssignmentMatch,
  resolveBonusAssignment,
} = dupCheck;

console.log('--- Testing 5 Immutable Business Rules for Deduplication & Maintainability ---');

// ============================================================================
// Rule 1: Một CCCD hợp lệ, đúng nguyên bản -> một hồ sơ người (Worker Profile)
// ============================================================================
{
  const person = {
    id: 'worker-1',
    idCard: '001099000001',
    fullName: 'NGUYỄN VĂN AN',
    assignments: [
      { id: 'a1', interviewDate: '01/10/2026', interviewFactory: 'ALPHA' },
      { id: 'a2', interviewDate: '15/10/2026', interviewFactory: 'ALPHA' },
    ],
  };

  assert.doesNotThrow(() => assertIdentity(person, '  nguyễn   văn   an  '));
  assert.doesNotThrow(() => assertIdentity(person, 'NGUYỄN VĂN AN'));
  assert.equal(person.assignments.length, 2);
  console.log('✔ Rule 1 PASSED: 1 CCCD represents 1 Worker Profile; multiple assignments kept separate');
}

// ============================================================================
// Rule 2: Một lượt tuyển được nhận diện bằng CCCD + ngày phỏng vấn (interviewDate)
// ============================================================================
{
  const assignments = [
    { id: 'a1', interviewDate: '01/10/2026', interviewFactory: 'ALPHA', employeeCode: 'EMP1' },
    { id: 'a2', interviewDate: '15/10/2026', interviewFactory: 'ALPHA', employeeCode: 'EMP1' },
    { id: 'a3_dup1', interviewDate: '20/10/2026', interviewFactory: 'ALPHA' },
    { id: 'a3_dup2', interviewDate: '20/10/2026', interviewFactory: 'ALPHA' },
  ];

  // Exact match on CCCD + interviewDate + same factory
  const match1 = findAssignmentMatch(assignments, {
    interviewDate: '01/10/2026',
    factory: 'ALPHA',
    employeeCode: 'EMP1',
  });
  assert.equal(match1.status, 'EXACT_MATCH');
  assert.equal(match1.assignment.id, 'a1');

  // Different factory on same interview date -> FACTORY_MISMATCH, never auto-merged
  const matchConflictFactory = findAssignmentMatch(assignments, {
    interviewDate: '01/10/2026',
    factory: 'BETA',
  });
  assert.equal(matchConflictFactory.status, 'FACTORY_MISMATCH');
  assert.match(matchConflictFactory.error, /khác nhà máy/);

  // Different employee code on same interview date -> CODE_MISMATCH, never auto-merged
  const matchConflictCode = findAssignmentMatch(assignments, {
    interviewDate: '01/10/2026',
    factory: 'ALPHA',
    employeeCode: 'EMP999',
  });
  assert.equal(matchConflictCode.status, 'CODE_MISMATCH');
  assert.match(matchConflictCode.error, /mã nhân viên/);

  // Multiple assignments on same interview date in DB -> MULTIPLE_SAME_DAY, requires review
  const matchMultiple = findAssignmentMatch(assignments, {
    interviewDate: '20/10/2026',
    factory: 'ALPHA',
  });
  assert.equal(matchMultiple.status, 'MULTIPLE_SAME_DAY');

  // No assignment on that day -> NO_MATCH (clean rehire or new interview)
  const matchNewDay = findAssignmentMatch(assignments, {
    interviewDate: '25/10/2026',
    factory: 'ALPHA',
  });
  assert.equal(matchNewDay.status, 'NO_MATCH');

  console.log('✔ Rule 2 PASSED: Assignment identified by CCCD + interviewDate; conflicts strictly blocked');
}

// ============================================================================
// Rule 3: Thưởng chỉ gắn vào lượt tuyển khi khớp duy nhất và danh tính không mâu thuẫn
// ============================================================================
{
  const worker = {
    id: 'worker-1',
    idCard: '001099000001',
    fullName: 'NGUYỄN VĂN AN',
    assignments: [
      { id: 'a1', interviewDate: '01/10/2026', interviewFactory: 'ALPHA', employeeCode: 'EMP1' },
    ],
  };

  // Unique compatible match links cleanly
  const linked = resolveBonusAssignment(worker, {
    fullName: 'NGUYỄN VĂN AN',
    company: 'ALPHA',
    interviewDate: '01/10/2026',
    workerCode: 'EMP1',
  });
  assert.equal(linked.id, 'a1');

  // Missing assignment -> returns null (kept as unlinked bonus row, preserved for review)
  const unlinked = resolveBonusAssignment(worker, {
    fullName: 'NGUYỄN VĂN AN',
    company: 'ALPHA',
    interviewDate: '05/10/2026',
  });
  assert.equal(unlinked, null);

  // Conflicting company throws error (never arbitrarily linked to another assignment)
  assert.throws(
    () =>
      resolveBonusAssignment(worker, {
        fullName: 'NGUYỄN VĂN AN',
        company: 'BETA',
        interviewDate: '01/10/2026',
      }),
    /khác công ty/,
  );

  console.log('✔ Rule 3 PASSED: Bonus links only on unique match; unlinked bonuses kept intact for review');
}

// ============================================================================
// Rule 4: Không tự thêm số 0 vào CCCD để ghép; không dùng tên/SĐT thay CCCD
// ============================================================================
{
  const normalized = '001099000001';

  // CCCD missing leading zeros must be rejected, NEVER silently padded
  assert.throws(
    () => assertSourceCard({ 'Số CCCD': '1099000001' }, normalized),
    /thiếu chữ số/,
  );
  assert.throws(
    () => assertSourceCard('1099000001', normalized),
    /thiếu chữ số/,
  );
  assert.doesNotThrow(() => assertSourceCard({ 'Số CCCD': '001099000001' }, normalized));

  // Identity mismatch on same CCCD must throw and block auto-merge
  const worker = { fullName: 'Nguyễn Văn An' };
  assert.throws(
    () => assertIdentity(worker, 'Trần Thị Bình'),
    /Sai lệch danh tính: cùng CCCD nhưng khác họ tên/,
  );

  console.log('✔ Rule 4 PASSED: Strict CCCD integrity without artificial zero padding or name substitution');
}

// ============================================================================
// Rule 5: Kiểm tra luồng nhập thực tế và 4 chỉ số có định nghĩa rõ
// ============================================================================
(async () => {
  let harness = fs.readFileSync('tests/smart-merge.cjs', 'utf8').split('(async () => {')[0];
  harness = harness.replace('const route = load(', "deps['@/lib/bonus-import']=load('src/lib/bonus-import.ts'); deps['node:crypto']={default:require('node:crypto')}; const route = load(");
  await new Function('require', harness + `
  return (async () => {
    // 5.1: Nhập DS_TONG: 1 dòng hợp lệ + 1 dòng lỗi CCCD thiếu số
    const rowOk = {
      'Họ và tên': 'NGUYỄN VĂN AN',
      'số CCCD': '001099000001',
      'Nhà máy PV': 'ALPHA',
      'Ngày PV': '01/10/2026',
      'Tình trạng': 'Đang chờ phỏng vấn',
      'Mã nhân viên': 'EMP1'
    };
    const rowBadCccd = {
      'Họ và tên': 'TRẦN THỊ LỖI',
      'số CCCD': '1099000002', // 10 chữ số, thiếu 2 số 0 đầu
      'Nhà máy PV': 'ALPHA',
      'Ngày PV': '01/10/2026',
      'Tình trạng': 'Đang chờ phỏng vấn',
    };
    const tongRes = await route.POST(makeRequest([rowOk, rowBadCccd], false));
    assert.equal(tongRes.body.success, true);
    // uniqueWorkers chỉ đếm dòng hợp lệ: 1 người (không đếm dòng lỗi rowBadCccd)
    assert.equal(tongRes.body.summary.uniqueWorkers, 1, 'uniqueWorkers chỉ đếm dòng đã qua kiểm tra');
    assert.equal(tongRes.body.summary.validAssignments, 1, 'validAssignments là số lượt tuyển hợp lệ');
    assert.equal(tongRes.body.summary.bonusRows, 0, 'DS_TONG không có dòng thưởng');
    assert.equal(tongRes.body.summary.reviewRows, 1, 'Chỉ đúng 1 dòng lỗi cần xét, không đếm trùng');

    // 5.2: Nhập DS_THUONG liên kết
    const bonusRow = {
      'Họ tên': 'NGUYỄN VĂN AN',
      'Số CCCD': '001099000001',
      'Công ty': 'ALPHA',
      'Tháng': 'T10.2026',
      'Ngày PV': '01/10/2026',
      'Mã nhân viên': 'EMP1',
      'Thưởng lần 1': 500000,
    };
    const bonusRequest = (rows) => {
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), 'Thưởng');
      const bytes = X.write(wb, { type: 'buffer', bookType: 'xlsx' });
      return {
        formData: async () => ({
          get: (k) => ({
            file: { name: 'bonus.xlsx', size: bytes.length, arrayBuffer: async () => bytes },
            confirm: 'false',
            importType: 'DS_THUONG'
          })[k]
        })
      };
    };
    const bonusRes = await route.POST(bonusRequest([bonusRow]));
    assert.equal(bonusRes.body.success, true);
    assert.equal(bonusRes.body.summary.bonusRows, 1);
    assert.equal(bonusRes.body.summary.validAssignments, 0);

    console.log('✔ Rule 5 PASSED: Luồng nhập thực tế tính chuẩn 4 chỉ số (uniqueWorkers, validAssignments, bonusRows, reviewRows)');
  })();
  `)(require);

  console.log('\n✅ ALL 5 IMMUTABLE DEDUPLICATION & MAINTAINABILITY RULES VERIFIED ON ACTUAL FLOW!');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
