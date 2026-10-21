const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  { spawn, spawnSync } = require("node:child_process"),
  XLSX = require("xlsx");
const root = path.resolve(".local/qa-" + Date.now());
fs.mkdirSync(root, { recursive: true });
const hash = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const originals = ["prisma/dev.db", "prisma/schema.prisma", ".env"]
  .filter(fs.existsSync)
  .map((f) => [f, hash(f)]);
const db = path.join(root, "test.db").replace(/\\/g, "/");
fs.writeFileSync(
  path.join(root, "schema.prisma"),
  fs.readFileSync("prisma/schema.prisma", "utf8"),
);
fs.writeFileSync(db, "");
const pushed = spawnSync(
  process.execPath,
  [
    "node_modules/prisma/build/index.js",
    "db",
    "push",
    "--schema",
    path.join(root, "schema.prisma"),
    "--skip-generate",
  ],
  {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "file:" + db },
  },
);
if (pushed.status !== 0) throw new Error(pushed.stderr || pushed.stdout);
const fixtureClient = new (require("../.generated/client").PrismaClient)({
  datasources: { db: { url: "file:" + db } },
});
let qaFactoryId = "";
const fixtureReady = require("../scripts/seed-catalogs.cjs")(
  fixtureClient,
)
  .then(async () => {
    const factory = await
    fixtureClient.factory.upsert({
      where: { name: "QA TEST FACTORY" },
      create: {
        code: "QA-TEST-FACTORY",
        name: "QA TEST FACTORY",
      },
      update: { isActive: true },
    });
    qaFactoryId = factory.id;
  })
  .finally(() => fixtureClient.$disconnect());
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    process.env.QA_PRODUCTION === "1" ? "start" : "dev",
    "-p",
    "3101",
    "-H",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      LOCAL_BUILD_DIR:
        process.env.QA_PRODUCTION === "1" ? ".next-evolution" : ".next-qa",
      DATABASE_URL: "file:" + db,
      LOCAL_IMPORT_SOURCE_DIR: path.join(root, "source-imports"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
server.stdout.on("data", (d) => {
  logs = (logs + d).slice(-12000);
});
server.stderr.on("data", (d) => {
  logs = (logs + d).slice(-12000);
});
const base = "http://127.0.0.1:3101";
let checks = 0;
async function req(url, method = "GET", data, cookie = "", expected = 200) {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(method !== "GET" ? { Origin: base } : {}),
      ...(data instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  });
  assert.equal(
    r.status,
    expected,
    `${method} ${url}: ${r.status} ${await (r.status !== expected ? r.text() : Promise.resolve(""))}`,
  );
  checks++;
  return r;
}
async function json(url, method, data, cookie, expected = 200) {
  return (await req(url, method, data, cookie, expected)).json();
}
(async () => {
  await fixtureReady;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + "/api/workers");
      if (r.status === 200) break;
    } catch {}
    if (server.exitCode !== null) throw new Error("Server exited: " + logs);
    await new Promise((r) => setTimeout(r, 500));
    if (i === 99) throw new Error("Server not ready: " + logs);
  }
  await req("/api/workers");
  const data = {
    fullName: "QA TEST WORKER",
    idCard: "000000000001",
    phone: "0900000001",
    interviewFactory: "QA TEST FACTORY",
    status: "Đang làm việc",
    interviewDate: "01/10/2026",
    onboardingMonth: "T10.2026",
  };
  let w = (await json("/api/workers", "POST", data, "", 201)).data;
  await req("/api/workers", "POST", data, "", 409);
  await req("/api/workers", "POST", { ...data, rehire: true }, "", 409);
  await req(
    "/api/workers",
    "POST",
    { ...data, idCard: "000000000002" },
    "",
    409,
  );
  await req(
    "/api/workers",
    "POST",
    { ...data, idCard: "000000000002", confirmPhoneDuplicate: true },
    "",
    201,
  );
  let change = {
    assignmentId: w.assignments[0].id,
    updatedAt: w.updatedAt,
    assignmentUpdatedAt: w.assignments[0].updatedAt,
    status: "Đã nghỉ việc",
    leaveDate: "31/02/2026",
    leaveReason: "QA",
  };
  await req("/api/workers/" + w.id, "PUT", change, "", 400);
  change.leaveDate = "10/10/2026";
  change.dob = null;
  change.address = null;
  change.expectedTrainingDate = null;
  w = (await json("/api/workers/" + w.id, "PUT", change, "")).data;
  await req("/api/workers/" + w.id, "PUT", change, "", 409);
  const old = w.assignments[0].id;
  w = (
    await json(
      "/api/workers",
      "POST",
      { ...data, rehire: true, interviewDate: "11/10/2026", status: "Đang chờ phỏng vấn" },
      "",
      201,
    )
  ).data;
  assert.equal(w.assignments.length, 2);
  assert.equal(w.assignments.find((a) => a.id === old).status, "Đã nghỉ việc");
  await req("/api/workers/" + w.id, "DELETE", undefined, "", 409);
  const bonus = {
    workerId: w.id,
    assignmentId: w.assignments[0].id,
    company: "QA TEST FACTORY",
    month: "T10.2026",
    bonus1: 300000,
    bonus2: 0,
    bonus3: 0,
    bonus4: 0,
    bonus5: 0,
    bonus6: 0,
    bonus7: 0,
    policy: "QA",
  };
  await req(
    "/api/bonuses",
    "POST",
    { ...bonus, bonus1: -1 },
    "",
    400,
  );
  let b = (await json("/api/bonuses", "POST", bonus, "", 201))
    .data;
  await req("/api/bonuses", "POST", bonus, "", 409);
  b = (
    await json(
      "/api/bonuses",
      "PATCH",
      { ...bonus, id: b.id, updatedAt: b.updatedAt, bonus1: 500000 },
      "",
    )
  ).data;
  await req(
    "/api/bonuses",
    "PUT",
    { id: b.id, status: "LOCKED" },
    "",
    409,
  );
  b = (
    await json(
      "/api/bonuses",
      "PUT",
      { id: b.id, status: "APPROVED", approver: "Spoofed" },
      "",
    )
  ).data;
  assert.equal(b.approvedBy, "Người dùng local");
  await req(
    "/api/bonuses",
    "PATCH",
    { ...bonus, id: b.id, updatedAt: b.updatedAt },
    "",
    409,
  );
  b = (
    await json(
      "/api/bonuses",
      "PUT",
      { id: b.id, status: "LOCKED" },
      "",
    )
  ).data;
  await req(
    "/api/bonuses",
    "PUT",
    { id: b.id, status: "DRAFT" },
    "",
    400,
  );
  await req(
    "/api/bonuses",
    "PUT",
    { id: b.id, status: "APPROVED" },
    "",
    409,
  );
  let account = (
    await json(
      "/api/bank-accounts",
      "POST",
      {
        workerId: w.id,
        bankName: "QA BANK",
        accountNumber: "00012345",
        accountHolderName: data.fullName,
      },
      "",
    )
  ).data;
  assert.equal(account.verificationStatus, "UNVERIFIED");
  assert.equal(account.isNameVerified, false);
  account = (
    await json(
      "/api/bank-accounts",
      "PUT",
      { ...account, accountNumber: "00054321" },
      "",
    )
  ).data;
  assert.equal(account.verificationStatus, "UNVERIFIED");
  await req(
    "/api/bank-accounts/verify",
    "POST",
    { bankName: "QA BANK", accountNumber: "00054321" },
    "",
    503,
  );
  await req(
    "/api/excel-engine/export?type=PAYMENT_BATCH&month=T10.2026",
    "GET",
    undefined,
    "",
    409,
  );
  await req(
    "/api/excel-engine/export?type=PAYMENT_BATCH&month=T10.2026",
    "GET",
    undefined,
    "",
    409,
  );
  await req(
    "/api/excel-engine/export?type=WORKERS",
    "GET",
    undefined,
    "",
    200,
  );
  const exported = await req(
    "/api/excel-engine/export?type=WORKERS",
    "GET",
    undefined,
    "",
  );
  assert.ok((await exported.arrayBuffer()).byteLength > 0);
  await req(
    "/api/excel-engine/export?type=DUPLICATES",
    "GET",
    undefined,
    "",
  );
  await req(
    "/api/excel-engine/export?type=TEMPLATE",
    "GET",
    undefined,
    "",
  );
  const policy = {
    name: "QA POLICY",
    factory: "QA TEST FACTORY",
    factoryId: qaFactoryId,
    isActive: true,
    rules: Array.from({ length: 7 }, (_, i) => ({
      step: i + 1,
      milestone: `Mốc ${i + 1}`,
      amount: 100000,
    })),
  };
  const pol = (
    await json("/api/policies", "POST", policy, "", 201)
  ).data;
  await req(
    "/api/policies",
    "PUT",
    { ...policy, id: pol.id, updatedAt: pol.updatedAt, isActive: false },
    "",
  );
  const lookup = (
    await json("/api/lookup", "POST", {
      idCard: data.idCard,
      lastPhone4: "0001",
    })
  ).data;
  assert.equal(lookup.bankAccount.accountNumber, "••••4321");
  assert.equal(lookup.idCard, undefined);
  assert.equal(lookup.bonusRecords[0].status, "LOCKED");
  await req(
    "/api/lookup",
    "POST",
    { idCard: data.idCard, lastPhone4: "1" },
    "",
    400,
  );
  await req(
    "/api/lookup",
    "POST",
    { idCard: data.idCard, lastPhone4: "9999" },
    "",
    404,
  );
  function file(rows) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "DS_TONG");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }
  const excel = file([
    {
      "Họ và tên": "QA IMPORT",
      "số CCCD": "000000000003",
      SĐT: "0900000003",
      "Nhà máy PV": "QA TEST FACTORY",
      "Tình trạng": "Đang chờ phỏng vấn",
      "Ngày PV": 46307,
    },
    {
      "Họ và tên": "BAD NUMERIC",
      "số CCCD": 123,
      "Nhà máy PV": "QA TEST FACTORY",
    },
    {
      "Họ và tên": data.fullName,
      "số CCCD": data.idCard,
      "Nhà máy PV": "QA TEST FACTORY",
      "Ngày PV": "01/10/2026",
    },
  ]);
  function form(commit) {
    const f = new FormData();
    f.append("file", new Blob([excel]), "qa.xlsx");
    if (commit) f.append("confirm", "true");
    return f;
  }
  const preview = await json(
    "/api/excel-engine/import",
    "POST",
    form(false),
    "",
  );
  assert.equal(preview.preview, true);
  assert.equal(preview.summary.readyCount, 1);
  assert.equal(preview.summary.duplicateCount, 1);
  assert.equal(preview.summary.errorCount, 1);
  let workers = await json("/api/workers", "GET", undefined, "");
  assert.equal(workers.data.length, 2);
  const imported = await json(
    "/api/excel-engine/import",
    "POST",
    form(true),
    "",
  );
  assert.equal(imported.summary.successCount, 1);
  workers = await json("/api/workers", "GET", undefined, "");
  assert.equal(workers.data.length, 3);
  const importedSourceRows = await json(
    "/api/worker-source-rows?search=QA IMPORT",
    "GET",
    undefined,
    "",
  );
  const importedSourceRow = importedSourceRows.data.find(
    (row) => row.isSourceRow && row.idCard === "000000000003",
  );
  assert.ok(importedSourceRow?.sourceId);
  await req(
    "/api/workers",
    "DELETE",
    {
      workerId: importedSourceRow.workerId,
      assignmentId: importedSourceRow.assignments?.[0]?.id,
      idCard: importedSourceRow.idCard,
      isSourceRow: true,
      sourceId: importedSourceRow.sourceId,
      sourceRow: importedSourceRow.sourceRow,
    },
    "",
  );
  workers = await json("/api/workers?search=000000000003", "GET", undefined, "");
  assert.equal(workers.data.length, 1, "deleting a source row must keep its normalized worker");
  assert.equal(workers.data[0].assignments.length, 1);
  const sourceRowsAfterDelete = await json(
    "/api/worker-source-rows?search=QA IMPORT",
    "GET",
    undefined,
    "",
  );
  assert.equal(
    sourceRowsAfterDelete.data.some((row) => row.sourceId === importedSourceRow.sourceId && row.sourceRow === importedSourceRow.sourceRow),
    false,
  );

  const factory = (
    await json(
      "/api/catalogs",
      "POST",
      { kind: "FACTORY", name: "QA V3 FACTORY", code: "QA-V3", isActive: true },
      "",
      201,
    )
  ).data;
  const team = (
    await json(
      "/api/catalogs",
      "POST",
      { kind: "TEAM", name: "QA V3 TEAM", code: "QA-TEAM", isActive: true },
      "",
      201,
    )
  ).data;
  const recruiter = (
    await json(
      "/api/catalogs",
      "POST",
      {
        kind: "RECRUITER",
        name: "QA RECRUITER",
        code: "QA-REC",
        teamId: team.id,
        isActive: true,
      },
      "",
      201,
    )
  ).data;
  const order = (
    await json(
      "/api/orders",
      "POST",
      {
        code: "QA-ORDER",
        name: "QA V3 ORDER",
        factory: factory.name,
        factoryId: factory.id,
        isActive: true,
      },
      "",
      201,
    )
  ).data;
  const batch = (
    await json(
      "/api/orders",
      "POST",
      {
        kind: "BATCH",
        orderId: order.id,
        code: "QA-OCT",
        name: "QA OCT BATCH",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        periodMonth: "2026-10",
        target: 2,
      },
      "",
      201,
    )
  ).data;
  const policyV3 = (
    await json(
      "/api/policies",
      "POST",
      {
        name: "QA V3 POLICY",
        factory: factory.name,
        factoryId: factory.id,
        orderId: order.id,
        isActive: true,
        effectiveFrom: "2026-10-01",
        effectiveTo: "2026-10-31",
        rules: [
          { step: 1, milestone: "3 công", thresholdDays: 3, amount: 300000 },
          { step: 2, milestone: "7 công", thresholdDays: 7, amount: 500000 },
        ],
      },
      "",
      201,
    )
  ).data;
  const v3input = {
    fullName: "QA V3 PERSON",
    idCard: "000000000004",
    phone: "0900000004",
    dob: "01/01/1990",
    gender: "Nam",
    province: "QA PROVINCE",
    interviewFactory: factory.name,
    orderId: order.id,
    batchId: batch.id,
    recruiterId: recruiter.id,
    interviewDate: "2026-10-01",
    passedDate: "2026-10-01",
    startDate: "2026-10-02",
    interviewResult: "PASS",
    status: "Đang làm việc",
    employeeCode: "QA-EMP-001",
  };
  let person = (await json("/api/workers", "POST", v3input, "", 201))
    .data;
  const first = person.assignments[0];
  assert.equal(first.team, team.name);
  assert.equal(first.recruiter, recruiter.name);
  person = (
    await json(
      "/api/workers/" + person.id,
      "PUT",
      {
        assignmentId: first.id,
        updatedAt: person.updatedAt,
        assignmentUpdatedAt: first.updatedAt,
        confirmedWorkDays: 3,
        workDaysAsOf: "2026-10-04",
      },
      "",
    )
  ).data;
  const enrollment = (
    await json(
      "/api/enrollments",
      "POST",
      { assignmentId: first.id, policyId: policyV3.id },
      "",
      201,
    )
  ).data;
  await req(
    "/api/enrollments",
    "POST",
    { assignmentId: first.id, policyId: policyV3.id },
    "",
    409,
  );
  let stage1 = enrollment.stages[0],
    stage2 = enrollment.stages[1];
  await req(
    "/api/enrollments",
    "PUT",
    {
      id: stage1.id,
      updatedAt: stage1.updatedAt,
      eligible: false,
      achieved: true,
      achievedOn: "2026-10-04",
    },
    "",
    400,
  );
  stage1 = (
    await json(
      "/api/enrollments",
      "PUT",
      {
        id: stage1.id,
        updatedAt: stage1.updatedAt,
        eligible: true,
        eligibleAsOf: "2026-10-10",
        achieved: true,
        achievedOn: "2026-10-04",
        note: "QA manual evidence",
      },
      "",
    )
  ).data;
  await req(
    "/api/enrollments",
    "PUT",
    {
      id: stage2.id,
      updatedAt: stage2.updatedAt,
      eligible: true,
      eligibleAsOf: "2026-10-10",
      achieved: false,
    },
    "",
  );
  await req(
    "/api/reward-payments",
    "POST",
    {
      stageId: stage1.id,
      amount: 100000,
      paidOn: "2026-10-05",
      reference: "QA-PAY-001",
      confirmActualPayment: false,
    },
    "",
    400,
  );
  await req(
    "/api/reward-payments",
    "POST",
    {
      stageId: stage1.id,
      amount: 100000,
      paidOn: "2026-10-05",
      reference: "QA-PAY-001",
      confirmActualPayment: true,
    },
    "",
    201,
  );
  await req(
    "/api/reward-payments",
    "POST",
    {
      stageId: stage1.id,
      amount: 100000,
      paidOn: "2026-10-05",
      reference: "QA-PAY-001",
      confirmActualPayment: true,
    },
    "",
    409,
  );
  await req(
    "/api/reward-payments",
    "POST",
    {
      stageId: stage1.id,
      amount: 250000,
      paidOn: "2026-10-05",
      reference: "QA-PAY-OVER",
      confirmActualPayment: true,
    },
    "",
    409,
  );
  let report = (
    await json(
      "/api/reports?month=2026-10&orderId=" + order.id,
      "GET",
      undefined,
      "",
    )
  ).data;
  assert.equal(report.recruitment.summary.passed, 1);
  assert.equal(report.recruitment.teams[0].name, team.name);
  assert.equal(report.rewards.summary.achieveRate, 50);
  assert.equal(report.rewards.summary.paid, 100000);
  assert.equal(report.rewards.summary.earned, 300000);
  const history = (
    await json(
      "/api/worker-history?search=QA-EMP-001",
      "GET",
      undefined,
      "",
    )
  ).data;
  assert.equal(history[0].id, person.id);
  assert.equal(
    history[0].assignments[0].enrollments[0].stages[0].payments.length,
    1,
  );
  await req(
    "/api/policies",
    "PUT",
    {
      ...policyV3,
      id: policyV3.id,
      updatedAt: policyV3.updatedAt,
      name: "QA V3 POLICY CHANGED",
      rules: [
        { step: 1, milestone: "New amount", thresholdDays: 3, amount: 900000 },
      ],
    },
    "",
  );
  const preserved = (
    await json(
      "/api/enrollments?assignmentId=" + first.id,
      "GET",
      undefined,
      "",
    )
  ).data[0];
  assert.equal(preserved.stages[0].amount, 300000);
  assert.equal(preserved.policyName, "QA V3 POLICY");
  person = (
    await json(
      "/api/workers/" + person.id,
      "PUT",
      {
        assignmentId: first.id,
        updatedAt: person.updatedAt,
        assignmentUpdatedAt: person.assignments[0].updatedAt,
        status: "Nghỉ hẳn",
        leaveDate: "2026-10-10",
        leaveReason: "QA",
      },
      "",
    )
  ).data;
  person = (
    await json(
      "/api/workers",
      "POST",
      {
        ...v3input,
        interviewDate: "2026-10-11",
        passedDate: "",
        startDate: "",
        interviewResult: "PENDING",
        status: "Chưa đào tạo",
        employeeCode: "QA-EMP-002",
      },
      "",
      201,
    )
  ).data;
  assert.equal(person.assignments.length, 2);
  report = (
    await json(
      "/api/reports?month=2026-10&orderId=" + order.id,
      "GET",
      undefined,
      "",
    )
  ).data;
  assert.equal(report.recruitment.summary.total, 2);
  assert.equal(report.recruitment.summary.people, 1);
  assert.equal(report.recruitment.summary.returning, 1);
  assert.equal(report.recruitment.summary.passed, 1);
  assert.equal(report.recruitment.orders[0].target, 2);
  assert.equal(report.recruitment.orders[0].targetPassRate, 50);
  const latest = person.assignments[0];
  person = (
    await json(
      "/api/workers/" + person.id,
      "PUT",
      {
        assignmentId: latest.id,
        updatedAt: person.updatedAt,
        assignmentUpdatedAt: latest.updatedAt,
        status: "Bỏ phỏng vấn",
        interviewResult: "ABANDONED",
      },
      "",
    )
  ).data;
  await req("/api/workers/" + person.id, "DELETE", undefined, "");
  assert.equal(
    (
      await json(
        "/api/worker-history?id=" + person.id,
        "GET",
        undefined,
        "",
      )
    ).data[0].assignments.length,
    2,
  );
  await req("/api/workers/" + person.id, "PATCH", {}, "");
  await req(
    "/api/catalogs",
    "DELETE",
    { kind: "RECRUITER", id: recruiter.id, updatedAt: recruiter.updatedAt },
    "",
  );
  assert.equal(
    (
      await json(
        "/api/worker-history?id=" + person.id,
        "GET",
        undefined,
        "",
      )
    ).data[0].assignments[0].recruiter,
    "QA RECRUITER",
  );
  const audit = await json("/api/audit", "GET", undefined, "");
  assert.ok(audit.total >= 10);
  const csrf = await fetch(base + "/api/workers", {
    method: "POST",
    headers: { Cookie: "", "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assert.equal(csrf.status, 403);
  checks++;
  console.log(
    `PASS ${checks} HTTP checks: direct local access, CSRF, rehire/history, stale updates, bonus draft/approval/lock, bank validation, blocked payment, Excel preview/import/export, policy and audit. Isolated test database only.`,
  );
  fs.writeFileSync(
    path.join(root, "result.json"),
    JSON.stringify(
      { passed: true, checks, at: new Date().toISOString() },
      null,
      2,
    ),
  );
})()
  .catch((err) => {
    console.error(err.message);
    fs.writeFileSync(path.join(root, "server.log"), logs);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const [file, original] of originals)
      assert.equal(hash(file), original, `Original file changed: ${file}`);
    if (process.platform === "win32")
      spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else server.kill("SIGTERM");
    console.log("Original database, schema and .env hashes unchanged.");
  });
