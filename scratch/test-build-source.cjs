const { buildImportSource } = require("../src/lib/import-source-store");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");

async function atomicWrite(file, value) {
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  const handle = await fs.promises.open(temp, "wx");
  try { await handle.writeFile(JSON.stringify(value), "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await fs.promises.rename(temp, file);
}

async function main() {
  const N = 61433;
  const rows = [];
  for (let i = 0; i < N; i++) {
    rows.push({
      row: i + 1,
      raw: {
        "Họ và tên": "Nguyen Van A",
        "Số CCCD": `001099${String(i).padStart(6, "0")}`,
        "Ngày sinh": "01/01/2000",
        "Giới tính": "Nam",
        "SĐT": "0912345678",
        "Địa chỉ": "Ha Noi",
        "Nhà máy PV": "Luxshare",
        "Ngày PV": "01/10/2026",
        "Trạng thái": "Đang chờ phỏng vấn"
      }
    });
  }

  console.log("Benchmarking buildImportSource for 61,433 rows...");
  const t0 = Date.now();
  const payload = buildImportSource("DS_TONG", "test.xlsx", "DS_TONG", rows, [], []);
  const t1 = Date.now();
  console.log(`buildImportSource took ${t1 - t0}ms`);

  const tmpFile = path.join(os.tmpdir(), `test-source-${Date.now()}.json`);
  console.log("Benchmarking atomicWrite to disk...");
  const t2 = Date.now();
  await atomicWrite(tmpFile, payload);
  const t3 = Date.now();
  console.log(`atomicWrite took ${t3 - t2}ms, file size: ${(fs.statSync(tmpFile).size / 1024 / 1024).toFixed(2)} MB`);

  fs.unlinkSync(tmpFile);
}

main().catch(console.error);
