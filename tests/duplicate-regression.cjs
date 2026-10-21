const fs = require('node:fs');
let harness = fs.readFileSync('tests/smart-merge.cjs', 'utf8').split('(async () => {')[0];
harness = harness.replace('const route = load(', "deps['@/lib/bonus-import']=load('src/lib/bonus-import.ts'); deps['node:crypto']={default:require('node:crypto')}; const route = load(");
new Function('require', harness + `
(async () => {
 const row = (day, factory='ALPHA') => ({'Họ và tên':'NGUYỄN VĂN TEST','số CCCD':'001099000001','Nhà máy PV':factory,'Ngày PV':day,'Tình trạng':'Đang chờ phỏng vấn','Mã nhân viên':'EMP1'});
 dbWorkers.push({id:'w',idCard:'001099000001',fullName:'NGUYỄN VĂN TEST',archivedAt:null});
 dbAssignments.push({id:'a',workerId:'w',interviewFactory:'ALPHA',interviewDate:'01/10/2026',employeeCode:'EMP1',status:'Đã nghỉ việc',leaveDate:'02/10/2026'});
 let r=await route.POST(makeRequest([row('01/10/2026','BETA')],false));
 assert.equal(r.body.summary.duplicateCount,1,'same CCCD/day at another factory must conflict');
 r=await route.POST(makeRequest([row('15/10/2026')],false));
 assert.equal(r.body.summary.readyCount,1,'same employee code on different day must be a new interview');
 dbAssignments.length=0;dbWorkers.length=0;
 r=await route.POST(makeRequest([row('01/10/2026'),row('01/10/2026','BETA')],false));
 assert.equal(r.body.summary.readyCount,1);assert.equal(r.body.summary.duplicateCount,1);

 dbWorkers.push({id:'w',idCard:'001099000001',fullName:'NGUYỄN VĂN TEST',assignments:[]});
 dbAssignments.push({id:'a1',workerId:'w',interviewFactory:'ALPHA',interviewDate:'01/10/2026',employeeCode:'EMP1',status:'NH'});
 dbAssignments.push({id:'a2',workerId:'w',interviewFactory:'ALPHA',interviewDate:'15/10/2026',employeeCode:'EMP1',status:'NH'});

 dbWorkers[0].phone='0900000001';
 let phoneRow={...row('20/10/2026'),'số CCCD':'001099000002','Họ và tên':'TRẦN VĂN B','SĐT':'+84 900.000.001'};
 r=await route.POST(makeRequest([phoneRow],false));assert.equal(r.body.summary.readyCount,1,'same phone as resigned worker is permitted');
 dbAssignments[0].status='Đang làm việc';
 r=await route.POST(makeRequest([phoneRow],false));assert.equal(r.body.summary.readyCount,0);assert.equal(r.body.review.duplicateRows,1,'same phone as active worker requires review');
 dbAssignments[0].status='NH';
 const bonusRow=day=>({'Họ tên':'NGUYỄN VĂN TEST','Số CCCD':'001099000001','Công ty':'ALPHA','Tháng':'T10.2026','Ngày PV':day,'Mã nhân viên':'EMP1','Thưởng lần 1':500000});
 const bonusRequest=rows=>{const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.json_to_sheet(rows),'Thưởng');const bytes=X.write(wb,{type:'buffer',bookType:'xlsx'});return{formData:async()=>({get:k=>({file:{name:'bonus.xlsx',size:bytes.length,arrayBuffer:async()=>bytes},confirm:'false',importType:'DS_THUONG'})[k]})}};
 r=await route.POST(bonusRequest([bonusRow('01/10/2026'),bonusRow('15/10/2026')]));
 assert.equal(r.body.summary.readyCount,2,'two interview days in the same month remain separate rewards');assert.equal(r.body.summary.duplicateCount,0);
 r=await route.POST(bonusRequest([bonusRow('01/10/2026'),bonusRow('2026-10-01')]));assert.equal(r.body.summary.duplicateCount,1);
 r=await route.POST(bonusRequest([{...bonusRow('01/10/2026'),'Họ tên':'NGUYỄN VĂN KHÁC'}]));assert.equal(r.body.summary.readyCount,0);assert.equal(r.body.review.duplicateRows,1);
 r=await route.POST(bonusRequest([{...bonusRow('01/10/2026'),'Công ty':'BETA'}]));assert.equal(r.body.summary.readyCount,0);assert.equal(r.body.review.duplicateRows,1);
 dbAssignments.length=0;
 r=await route.POST(bonusRequest([bonusRow('01/10/2026'),{...bonusRow('01/10/2026'),'Công ty':'BETA'}]));assert.equal(r.body.summary.readyCount,1);assert.equal(r.body.review.duplicateRows,1,'same person/day cannot be assigned rewards for conflicting companies even before profiles arrive');
 console.log('PASS daily uniqueness, employee-code reuse, multiple days/month, repeated bonus date, identity and company conflicts');
})().catch(e=>{console.error(e);process.exitCode=1});
`)(require);
