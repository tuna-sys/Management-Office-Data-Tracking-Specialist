const XLSX = require("xlsx");
const crypto = require("node:crypto");
const fs = require("node:fs");

function oldFingerprint(book) {
  const hash = crypto.createHash("sha256");
  hash.update("workbook-cells-v1");
  for (const name of book.SheetNames) {
    hash.update(JSON.stringify(["sheet", name]));
    const sheet = book.Sheets[name];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    for (let row = range.s.r; row <= range.e.r; row++) {
      const values = [];
      for (let column = range.s.c; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
          values.push([column, cell.v]);
        }
      }
      if (values.length) hash.update(JSON.stringify([row, values]));
    }
  }
  return "cells-v1:" + hash.digest("hex");
}

function newFingerprint(book) {
  const hash = crypto.createHash("sha256");
  hash.update("workbook-cells-v1");
  for (const name of book.SheetNames) {
    hash.update(JSON.stringify(["sheet", name]));
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const keys = Object.keys(sheet).filter((k) => !k.startsWith("!")).sort();
    for (const key of keys) {
      const cell = sheet[key];
      if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
        hash.update(key + ":" + String(cell.v));
      }
    }
  }
  return "cells-v1:" + hash.digest("hex");
}

const wb = XLSX.readFile("D:\\Download\\DS Thưởng Hoàng - Tú test.xlsx", { cellFormula: false, cellHTML: false, cellText: false });

console.log("Benchmarking newFingerprint...");
const tNew0 = Date.now();
const hNew = newFingerprint(wb);
const tNew = Date.now() - tNew0;
console.log(`newFingerprint: ${tNew}ms, hash: ${hNew}`);

console.log("Benchmarking oldFingerprint...");
const tOld0 = Date.now();
const hOld = oldFingerprint(wb);
const tOld = Date.now() - tOld0;
console.log(`oldFingerprint: ${tOld}ms, hash: ${hOld}`);
