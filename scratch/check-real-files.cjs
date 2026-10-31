const XLSX = require("xlsx");
const path = require("node:path");

function check(p1, p2) {
  console.log("Checking:", p1);
  const wb1 = XLSX.readFile(p1, { cellFormula: false, cellHTML: false, cellText: false });
  const sheet1 = wb1.Sheets[wb1.SheetNames[0]];
  const r1 = XLSX.utils.decode_range(sheet1["!ref"]).e.r;
  console.log("SheetNames:", wb1.SheetNames, "rows:", r1);

  console.log("Checking:", p2);
  const wb2 = XLSX.readFile(p2, { cellFormula: false, cellHTML: false, cellText: false });
  const sheet2 = wb2.Sheets[wb2.SheetNames[0]];
  const r2 = XLSX.utils.decode_range(sheet2["!ref"]).e.r;
  console.log("SheetNames:", wb2.SheetNames, "rows:", r2);
}

try {
  console.log("=== Checking D:\\Download ===");
  check("D:\\Download\\DS_TONG.xlsx", "D:\\Download\\DS Thưởng Hoàng - Tú test.xlsx");
} catch (e) {
  console.error("Download err:", e.message);
}

try {
  console.log("=== Checking D:\\TTV\\TTV project ===");
  check("D:\\TTV\\TTV project\\DS_TONG.xlsx", "D:\\TTV\\TTV project\\DS Thưởng Hoàng - Tú test.xlsx");
} catch (e) {
  console.error("TTV err:", e.message);
}
