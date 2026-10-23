const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const X = require('xlsx');
const source = fs.readFileSync('src/app/api/excel-engine/import/route.ts','utf8') + '\nexport { extractSheetData, readHeaderRows };';
const m = {exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,require:n=>n==='xlsx'?X:{},Buffer});
const matrix = [['Họ tên','Số CCCD','Công ty']];
for(let i=0;i<100001;i++) matrix.push(['TEST '+i,String(i).padStart(12,'0'),'QA']);
const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(matrix),'DS_TONG');
const bytes=X.write(wb,{type:'buffer',bookType:'xlsx'});
console.log('xlsx bytes',bytes.length);
const book=X.read(bytes,{type:'buffer'});
for(const count of [60000,100000,100001]) {
 book.Sheets.DS_TONG['!ref']='A1:C'+(count+1);
 const started=Date.now();
 if(count<=100000) { const data=m.exports.extractSheetData(book,'DS_TONG','DS_TONG'); assert.equal(data.entries.length,count); assert.equal(data.entries[count-1].row,count+1); }
 else assert.throws(()=>m.exports.extractSheetData(book,'DS_TONG','DS_TONG'),/100.000/);
 console.log('PASS',count,'rows',Date.now()-started,'ms');
}
const sparse=X.utils.aoa_to_sheet([[],['Title'],[],['Họ tên','Số CCCD'],['TEST','000000000001']]);
const old=X.utils.sheet_to_json(sparse,{header:1,defval:'',blankrows:false}).slice(0,6);
assert.equal(JSON.stringify(m.exports.readHeaderRows(sparse)),JSON.stringify(old));
console.log('PASS header blank-row compatibility');
