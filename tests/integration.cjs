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
const fixtureReady = require("../scripts/seed-catalogs.cjs")(
  fixtureClient,
).finally(() => fixtureClient.$disconnect());
const password = crypto.randomBytes(24).toString("hex");
const users = ["ADMIN", "HR", "FINANCE", "VIEWER"].map((role) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    username: role.toLowerCase(),
    role,
    salt,
    hash: crypto.scryptSync(password, salt, 64).toString("hex"),
    version: crypto.randomUUID(),
  };
});
const authFile = path.join(root, "auth.json");
fs.writeFileSync(
  authFile,
  JSON.stringify({ secret: crypto.randomBytes(32).toString("hex"), users }),
);
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
      LOCAL_DEMO_AUTO_VIEW: "0",
      LOCAL_BUILD_DIR:
        process.env.QA_PRODUCTION === "1" ? ".next-evolution" : ".next-qa",
      DATABASE_URL: "file:" + db,
      LOCAL_AUTH_FILE: authFile,
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
      const r = await fetch(base + "/api/auth/me");
      if (r.status === 401) break;
    } catch {}
    if (server.exitCode !== null) throw new Error("Server exited: " + logs);
    await new Promise((r) => setTimeout(r, 500));
    if (i === 99) throw new Error("Server not ready: " + logs);
  }
  const cookies = {};
  for (const role of ["admin", "hr", "finance", "viewer"]) {
    const r = await req("/api/auth/login", "POST", {
      username: role,
      password,
    });
    cookies[role] = r.headers.get("set-cookie").split(";")[0];
  }
  await req("/api/workers", "GET", undefined, "", 401);
  await req("/api/workers", "POST", {}, cookies.viewer, 403);
  await req("/api/bonuses", "POST", {}, cookies.hr, 403);
  const data = {
    fullName: "QA TEST WORKER",
    idCard: "000000000001",
    phone: "0900000001",
    interviewFactory: "QA TEST FACTORY",
    status: "Đang làm việc",
    interviewDate: "01/10/2026",
    onboardingMonth: "T10.2026",
  };
  let w = (await json("/api/workers", "POST", data, cookies.hr, 201)).data;
  await req("/api/workers", "POST", data, cookies.hr, 409);
  await req("/api/workers", "POST", { ...data, rehire: true }, cookies.hr, 409);
  await req(
    "/api/workers",
    "POST",
    { ...data, idCard: "000000000002" },
    cookies.hr,
    409,
  );
  await req(
    "/api/workers",
    "POST",
    { ...data, idCard: "000000000002", confirmPhoneDuplicate: true },
    cookies.hr,
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
  await req("/api/workers/" + w.id, "PUT", change, cookies.hr, 400);
  change.leaveDate = "10/10/2026";
  change.dob = null;
  change.address = null;
  change.expectedTrainingDate = null;
  w = (await json("/api/workers/" + w.id, "PUT", change, cookies.hr)).data;
  await req("/api/workers/" + w.id, "PUT", change, cookies.hr, 409);
  const old = w.assignments[0].id;
  w = (
    await json(
      "/api/workers",
      "POST",
      { ...data, rehire: true, status: "Đang chờ phỏng vấn" },
      cookies.hr,
      201,
    )
  ).data;
  assert.equal(w.assignments.length, 2);
  assert.equal(w.assignments.find((a) => a.id === old).status, "Đã nghỉ việc");
  await req("/api/workers/" + w.id, "DELETE", undefined, cookies.admin, 409);
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
    cookies.finance,
    400,
  );
  let b = (await json("/api/bonuses", "POST", bonus, cookies.finance, 201))
    .data;
  await req("/api/bonuses", "POST", bonus, cookies.finance, 409);
  b = (
    await json(
      "/api/bonuses",
      "PATCH",
      { ...bonus, id: b.id, updatedAt: b.updatedAt, bonus1: 500000 },
      cookies.finance,
    )
  ).data;
  await req(
    "/api/bonuses",
    "PUT",
    { id: b.id, status: "LOCKED" },
    cookies.finance,
    409,
  );
  b = (
    await json(
      "/api/bonuses",
      "PUT",
      { id: b.id, status: "APPROVED", approver: "Spoofed" },
      cookies.finance,
    )
  ).data;
  assert.equal(b.approvedBy, "finance");
  await req(
    "/api/bonuses",
    "PATCH",
    { ...bonus, id: b.id, updatedAt: b.updatedAt },
    cookies.finance,
    409,
  );
  b = (
    await json(
      "/api/bonuses",
      "PUT",
      { id: b.id, status: "LOCKED" },
      cookies.finance,
    )
  ).data;
  await req(
    "/api/bonuses",
    "PUT",
    { id: b.id, status: "DRAFT" },
    cookies.finance,
    400,
  );
  await req(
    "/api/bonuses",
    "PUT",
    { id: b.id, status: "APPROVED" },
    cookies.finance,
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
      cookies.finance,
    )
  ).data;
  assert.equal(account.verificationStatus, "UNVERIFIED");
  assert.equal(account.isNameVerified, false);
  account = (
    await json(
      "/api/bank-accounts",
      "PUT",
      { ...account, accountNumber: "00054321" },
      cookies.finance,
    )
  ).data;
  assert.equal(account.verificationStatus, "UNVERIFIED");
  await req(
    "/api/bank-accounts/verify",
    "POST",
    { bankName: "QA BANK", accountNumber: "00054321" },
    cookies.finance,
    503,
  );
  await req(
    "/api/excel-engine/export?type=PAYMENT_BATCH&month=T10.2026",
    "GET",
    undefined,
    cookies.finance,
    409,
  );
  await req(
    "/api/excel-engine/export?type=PAYMENT_BATCH&month=T10.2026",
    "GET",
    undefined,
    cookies.hr,
    403,
  );
  await req(
    "/api/excel-engine/export?type=WORKERS",
    "GET",
    undefined,
    cookies.viewer,
    403,
  );
  const exported = await req(
    "/api/excel-engine/export?type=WORKERS",
    "GET",
    undefined,
    cookies.hr,
  );
  assert.ok((await exported.arrayBuffer()).byteLength > 0);
  await req(
    "/api/excel-engine/export?type=DUPLICATES",
    "GET",
    undefined,
    cookies.hr,
  );
  await req(
    "/api/excel-engine/export?type=TEMPLATE",
    "GET",
    undefined,
    cookies.hr,
  );
  const policy = {
    name: "QA POLICY",
    factory: "QA TEST FACTORY",
    isActive: true,
    rules: Array.from({ length: 7 }, (_, i) => ({
      step: i + 1,
      milestone: `Mốc ${i + 1}`,
      amount: 100000,
    })),
  };
  const pol = (
    await json("/api/policies", "POST", policy, cookies.finance, 201)
  ).data;
  await req(
    "/api/policies",
    "PUT",
    { ...policy, id: pol.id, updatedAt: pol.updatedAt, isActive: false },
    cookies.finance,
  );
  await req("/api/policies", "POST", policy, cookies.hr, 403);
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
    cookies.hr,
  );
  assert.equal(preview.preview, true);
  assert.equal(preview.summary.readyCount, 1);
  assert.equal(preview.summary.duplicateCount, 1);
  assert.equal(preview.summary.errorCount, 1);
  let workers = await json("/api/workers", "GET", undefined, cookies.hr);
  assert.equal(workers.data.length, 2);
  const imported = await json(
    "/api/excel-engine/import",
    "POST",
    form(true),
    cookies.hr,
  );
  assert.equal(imported.summary.successCount, 1);
  workers = await json("/api/workers", "GET", undefined, cookies.hr);
  assert.equal(workers.data.length, 3);

  const factory = (
    await json(
      "/api/catalogs",
      "POST",
      { kind: "FACTORY", name: "QA V3 FACTORY", code: "QA-V3", isActive: true },
      cookies.hr,
      201,
    )
  ).data;
  const team = (
    await json(
      "/api/catalogs",
      "POST",
      { kind: "TEAM", name: "QA V3 TEAM", code: "QA-TEAM", isActive: true },
      cookies.hr,
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
      cookies.hr,
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
      cookies.hr,
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
      cookies.hr,
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
        orderId: order.id,
        isActive: true,
        effectiveFrom: "2026-10-01",
        effectiveTo: "2026-10-31",
        rules: [
          { step: 1, milestone: "3 công", thresholdDays: 3, amount: 300000 },
          { step: 2, milestone: "7 công", thresholdDays: 7, amount: 500000 },
        ],
      },
      cookies.finance,
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
  let person = (await json("/api/workers", "POST", v3input, cookies.hr, 201))
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
        confirmedWorkDays: 7,
        workDaysAsOf: "2026-10-10",
      },
      cookies.hr,
    )
  ).data;
  const enrollment = (
    await json(
      "/api/enrollments",
      "POST",
      { assignmentId: first.id, policyId: policyV3.id },
      cookies.finance,
      201,
    )
  ).data;
  await req(
    "/api/enrollments",
    "POST",
    { assignmentId: first.id, policyId: policyV3.id },
    cookies.finance,
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
    cookies.finance,
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
      cookies.finance,
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
    cookies.finance,
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
    cookies.finance,
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
    cookies.finance,
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
    cookies.finance,
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
    cookies.finance,
    409,
  );
  let report = (
    await json(
      "/api/reports?month=2026-10&orderId=" + order.id,
      "GET",
      undefined,
      cookies.admin,
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
      cookies.hr,
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
    cookies.finance,
  );
  const preserved = (
    await json(
      "/api/enrollments?assignmentId=" + first.id,
      "GET",
      undefined,
      cookies.finance,
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
      cookies.hr,
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
      cookies.hr,
      201,
    )
  ).data;
  assert.equal(person.assignments.length, 2);
  report = (
    await json(
      "/api/reports?month=2026-10&orderId=" + order.id,
      "GET",
      undefined,
      cookies.admin,
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
      cookies.hr,
    )
  ).data;
  await req("/api/workers/" + person.id, "DELETE", undefined, cookies.hr);
  assert.equal(
    (
      await json(
        "/api/worker-history?id=" + person.id,
        "GET",
        undefined,
        cookies.hr,
      )
    ).data[0].assignments.length,
    2,
  );
  await req("/api/workers/" + person.id, "PATCH", {}, cookies.hr);
  await req(
    "/api/catalogs",
    "DELETE",
    { kind: "RECRUITER", id: recruiter.id, updatedAt: recruiter.updatedAt },
    cookies.hr,
  );
  assert.equal(
    (
      await json(
        "/api/worker-history?id=" + person.id,
        "GET",
        undefined,
        cookies.hr,
      )
    ).data[0].assignments[0].recruiter,
    "QA RECRUITER",
  );
  const audit = await json("/api/audit", "GET", undefined, cookies.admin);
  assert.ok(audit.total >= 10);
  await req("/api/audit", "GET", undefined, cookies.hr, 403);
  await req("/api/users", "GET", undefined, cookies.viewer, 403);
  const newPassword = crypto.randomBytes(24).toString("hex");
  await req(
    "/api/users",
    "POST",
    {
      mode: "create",
      username: "qauser",
      role: "VIEWER",
      password: newPassword,
    },
    cookies.admin,
  );
  await req(
    "/api/users",
    "POST",
    { mode: "update", username: "admin", role: "HR" },
    cookies.admin,
    400,
  );
  const q = await req("/api/auth/login", "POST", {
    username: "qauser",
    password: newPassword,
  });
  const qCookie = q.headers.get("set-cookie").split(";")[0];
  await req(
    "/api/users",
    "POST",
    { mode: "update", username: "qauser", role: "HR" },
    cookies.admin,
  );
  await req("/api/auth/me", "GET", undefined, qCookie, 401);
  await req(
    "/api/users",
    "POST",
    { mode: "update", username: "qauser", role: "HR", isActive: false },
    cookies.admin,
  );
  await req(
    "/api/auth/login",
    "POST",
    { username: "qauser", password: newPassword },
    "",
    401,
  );
  await req("/api/auth/me", "GET", undefined, cookies.admin + "tampered", 401);
  const csrf = await fetch(base + "/api/workers", {
    method: "POST",
    headers: { Cookie: cookies.admin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assert.equal(csrf.status, 403);
  checks++;
  const authAudit = await json(
    "/api/audit?module=AUTH",
    "GET",
    undefined,
    cookies.admin,
  );
  assert.ok(authAudit.total >= 2);
  await req("/api/auth/logout", "POST", undefined, cookies.admin);
  await req("/api/auth/me", "GET", undefined, cookies.admin, 401);
  console.log(
    `PASS ${checks} HTTP checks: authentication, RBAC, CSRF, rehire/history, stale updates, bonus draft/approval/lock, bank validation, blocked payment, Excel preview/import/export, policy and audit. Isolated test database only.`,
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
