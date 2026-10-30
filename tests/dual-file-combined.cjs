const fs = require('node:fs');
const assert = require('node:assert/strict');
const X = require('xlsx');

let harness = fs.readFileSync('tests/smart-merge.cjs', 'utf8').split('(async () => {')[0];
harness = harness.replace('const route = load(', `
const dbBonusRecords = [];
mockPrisma.bonusRecord = {
  findMany: async () => dbBonusRecords,
  createMany: async ({ data }) => { dbBonusRecords.push(...data); return { count: data.length }; }
};
mockPrisma.bankAccount.createMany = async ({ data }) => { dbBanks.push(...data); return { count: data.length }; };
deps['@/lib/bonus-import'] = load('src/lib/bonus-import.ts');
deps['node:crypto'] = { default: require('node:crypto') };
const route = load(`);

new Function('require', harness + `
(async () => {
  console.log('=== Test Suite: Dual-File Combined Preview -> Commit Workflow ===');

  function makeXlsxBuffer(sheetName, rows) {
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), sheetName);
    return X.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  const dsTongRows = [
    {
      'Họ và tên': 'NGUYỄN VĂN A',
      'số CCCD': '001099000001',
      'Nhà máy PV': 'ALPHA',
      'Ngày PV': '01/10/2026',
      'Tình trạng': 'Đang chờ phỏng vấn',
      'Mã nhân viên': 'EMP1',
    },
    {
      'Họ và tên': 'TRẦN THỊ B',
      'số CCCD': '001099000002',
      'Nhà máy PV': 'ALPHA',
      'Ngày PV': '05/10/2026',
      'Tình trạng': 'Đang chờ phỏng vấn',
      'Mã nhân viên': 'EMP2',
    },
  ];

  const dsThuongRows = [
    {
      'Họ tên': 'NGUYỄN VĂN A',
      'Số CCCD': '001099000001',
      'Công ty': 'ALPHA',
      'Tháng': 'T10.2026',
      'Ngày PV': '01/10/2026',
      'Mã nhân viên': 'EMP1',
      'Thưởng lần 1': 500000,
    },
    {
      'Họ tên': 'TRẦN THỊ B',
      'Số CCCD': '001099000002',
      'Công ty': 'ALPHA',
      'Tháng': 'T10.2026',
      'Ngày PV': '05/10/2026',
      'Mã nhân viên': 'EMP2',
      'Thưởng lần 1': 600000,
    },
    {
      'Họ tên': 'LÊ VĂN C',
      'Số CCCD': '001099000099',
      'Công ty': 'ALPHA',
      'Tháng': 'T10.2026',
      'Ngày PV': '10/10/2026',
      'Mã nhân viên': 'EMP99',
      'Thưởng lần 1': 300000,
    },
  ];

  const bufTong = makeXlsxBuffer('DS_TONG', dsTongRows);
  const bufThuong = makeXlsxBuffer('DS_THUONG', dsThuongRows);

  const fileTong = { name: 'DS_TONG.xlsx', size: bufTong.length, arrayBuffer: async () => bufTong };
  const fileThuong = { name: 'DS_THUONG.xlsx', size: bufThuong.length, arrayBuffer: async () => bufThuong };

  // --------------------------------------------------------------------------
  // Test 1: Max 2 files boundary enforcement (> 2 files must return 400)
  // --------------------------------------------------------------------------
  {
    console.log('--- Test 1: Rejecting > 2 files with HTTP 400 ---');
    const dummyBuf = makeXlsxBuffer('DUMMY', [{ 'A': 1 }]);
    const fileExtra = { name: 'EXTRA.xlsx', size: dummyBuf.length, arrayBuffer: async () => dummyBuf };

    const req3Files = {
      formData: async () => ({
        getAll: (k) => k === 'files' ? [fileTong, fileThuong, fileExtra] : [],
        get: (k) => null,
      }),
    };
    const res = await route.POST(req3Files);
    assert.equal(res.options?.status, 400, 'Must return HTTP 400 when > 2 files provided');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /tối đa 2 file đồng thời/i, 'Error message must specify max 2 files limit');
    console.log('✔ Test 1 PASSED: > 2 files rejected with 400 and clear message');
  }

  // --------------------------------------------------------------------------
  // Test 2: Preview mode with 2 files (DS_TONG + DS_THUONG)
  // ĐẶC BIỆT: Kiểm tra dòng tìm thấy lượt PV nhưng bị loại ở bước kiểm tra thưởng tiếp theo
  // --------------------------------------------------------------------------
  let previewFingerprint = '';
  {
    console.log('--- Test 2: In-Memory Preview with 2 Files (DS_TONG + DS_THUONG) ---');
    dbWorkers.length = 0;
    dbAssignments.length = 0;
    dbBonusRecords.length = 0;

    // Giả lập Worker B đã có bản ghi thưởng đã khóa (APPROVED) trong CSDL:
    // Dòng này trong DS_THUONG sẽ TÌM THẤY lượt PV phù hợp từ DS_TONG, nhưng sau đó BỊ CHẶN ở bước kiểm tra thưởng tiếp theo!
    dbWorkers.push({ id: 'w-2', idCard: '001099000002', fullName: 'TRẦN THỊ B', assignments: [] });
    dbBonusRecords.push({
      id: 'b-locked-2',
      workerId: 'w-2',
      month: 'T10.2026',
      company: 'ALPHA',
      interviewDate: '05/10/2026',
      status: 'APPROVED',
      totalBonus: 1000000,
    });

    const reqPreview = {
      formData: async () => ({
        getAll: () => [],
        get: (k) => {
          if (k === 'file') return fileTong;
          if (k === 'secondaryFile') return fileThuong;
          if (k === 'confirm') return 'false';
          if (k === 'importType') return 'AUTO';
          if (k === 'smartMerge') return 'true';
          return null;
        },
      }),
    };

    const res = await route.POST(reqPreview);
    assert.equal(res.body.success, true, 'Preview should succeed');
    assert.equal(res.body.preview, true, 'Response must indicate preview mode');
    assert.equal(res.body.detectedType, 'COMBINED', 'Combined sheets must be detected as COMBINED');

    // Kiểm tra bộ đếm:
    // - validAssignments = 2 (từ DS_TONG)
    // - uniqueWorkers = 3 (A, B, C)
    // - matchedAssignmentCount = 2 (Cả Worker A và Worker B đều tìm thấy lượt tuyển phù hợp)
    // - linkedBonusCount = 1 (CHỈ Worker A vượt toàn bộ kiểm tra thưởng và sẵn sàng nạp; Worker B bị chặn vì đợt đã khóa!)
    // - unlinkedBonusCount = 1 (Worker C không có lượt tuyển, nạp dự thảo chờ đối chiếu)
    assert.equal(res.body.summary.validAssignments, 2, '2 valid recruitment assignments in DS_TONG');
    assert.equal(res.body.summary.uniqueWorkers, 3, '3 unique valid worker CCCDs across DS_TONG and DS_THUONG');
    assert.equal(res.body.summary.matchedAssignmentCount, 2, 'Tìm thấy 2 dòng có lượt PV phù hợp (Worker A và Worker B)');
    assert.equal(res.body.summary.linkedBonusCount, 1, 'Chỉ 1 dòng thưởng vượt qua toàn bộ kiểm tra và sẵn sàng nạp (Worker B bị loại ở bước sau)');
    assert.equal(res.body.summary.unlinkedBonusCount, 1, '1 dòng thưởng chưa có lượt PV khớp ngày (Worker C)');

    // Kiểm tra reviewBreakdown phân loại đúng nhóm đợt thưởng đã có/đã khóa
    assert.ok(res.body.summary.reviewBreakdown, 'Response must include reviewBreakdown');
    assert.equal(res.body.summary.reviewBreakdown.existingBonusCount, 1, 'Dòng Worker B bị chặn được phân loại chuẩn vào existingBonusCount');

    // Check fingerprint
    assert.ok(res.body.previewFingerprint, 'Preview must return a previewFingerprint');
    assert.match(res.body.previewFingerprint, /^cells-v1:/, 'Fingerprint must follow cells-v1 format');
    previewFingerprint = res.body.previewFingerprint;

    // Verify zero database writes during preview (trừ mock data có sẵn)
    assert.equal(dbWorkers.length, 1, 'No new workers written during preview');
    assert.equal(dbAssignments.length, 0, 'Zero assignments written during preview');
    console.log('✔ Test 2 PASSED: Dòng tìm thấy lượt PV nhưng bị loại ở bước thưởng tiếp theo KHÔNG bị tính sai vào linkedBonusCount; reviewBreakdown phân loại chuẩn');
  }

  // --------------------------------------------------------------------------
  // Test 3: Commit with altered fingerprint must be rejected with 409 Conflict
  // --------------------------------------------------------------------------
  {
    console.log('--- Test 3: Commit with Altered Fingerprint Rejected (409 Conflict) ---');
    const reqTampered = {
      formData: async () => ({
        getAll: () => [],
        get: (k) => {
          if (k === 'file') return fileTong;
          if (k === 'secondaryFile') return fileThuong;
          if (k === 'confirm') return 'true';
          if (k === 'importType') return 'COMBINED';
          if (k === 'smartMerge') return 'true';
          if (k === 'previewFingerprint') return 'cells-v1:tampered_hash_value_999999';
          return null;
        },
      }),
    };

    const res = await route.POST(reqTampered);
    assert.equal(res.options?.status, 409, 'Must return HTTP 409 Conflict when fingerprint does not match');
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Dữ liệu trong các ô đã thay đổi sau lần quét/);
    console.log('✔ Test 3 PASSED: Fingerprint tampering properly rejected with 409 Conflict');
  }

  // --------------------------------------------------------------------------
  // Test 4: Commit with identical files and matching fingerprint succeeds
  // --------------------------------------------------------------------------
  {
    console.log('--- Test 4: Commit with Matching Fingerprint and 2 Files ---');
    const reqCommit = {
      formData: async () => ({
        getAll: () => [],
        get: (k) => {
          if (k === 'file') return fileTong;
          if (k === 'secondaryFile') return fileThuong;
          if (k === 'confirm') return 'true';
          if (k === 'importType') return 'COMBINED';
          if (k === 'smartMerge') return 'true';
          if (k === 'previewFingerprint') return previewFingerprint;
          return null;
        },
      }),
    };

    const res = await route.POST(reqCommit);
    if (!res.body.success) {
      console.log('Test 4 failed body:', res.body, 'status:', res.options?.status);
    }
    assert.equal(res.body.success, true, 'Commit with valid fingerprint should succeed');
    assert.equal(res.body.preview, false, 'Response must indicate commit mode');
    assert.ok(res.body.normalizedSaved > 0, 'Normalized records must be saved');
    assert.ok(dbWorkers.length >= 2, 'Workers should be persisted on commit');
    assert.ok(dbAssignments.length >= 2, 'Assignments should be persisted on commit');
    console.log('✔ Test 4 PASSED: Dual-file commit with exact fingerprint succeeds and persists to database');
  }

  // --------------------------------------------------------------------------
  // Test 5: Commit with cell value modification rejected (fingerprint changed)
  // --------------------------------------------------------------------------
  {
    console.log('--- Test 5: Commit with Modified File Data Rejected ---');
    // Modify one cell value in DS_THUONG
    const modifiedThuongRows = [
      { ...dsThuongRows[0], 'Thưởng lần 1': 9999999 },
      dsThuongRows[1],
    ];
    const bufModified = makeXlsxBuffer('DS_THUONG', modifiedThuongRows);
    const fileModified = { name: 'DS_THUONG.xlsx', size: bufModified.length, arrayBuffer: async () => bufModified };

    const reqModified = {
      formData: async () => ({
        getAll: () => [],
        get: (k) => {
          if (k === 'file') return fileTong;
          if (k === 'secondaryFile') return fileModified;
          if (k === 'confirm') return 'true';
          if (k === 'importType') return 'COMBINED';
          if (k === 'smartMerge') return 'true';
          if (k === 'previewFingerprint') return previewFingerprint; // Old fingerprint
          return null;
        },
      }),
    };

    const res = await route.POST(reqModified);
    assert.equal(res.options?.status, 409, 'Must return HTTP 409 when file content changed');
    assert.equal(res.body.success, false);
    console.log('✔ Test 5 PASSED: Changed file contents invalidate fingerprint and reject commit');
  }

  console.log('=== ALL 5 DUAL-FILE COMBINED TESTS PASSED! ===');
})().catch((err) => {
  console.error('FAILED with error:', err);
  process.exit(1);
});
`)(require);
