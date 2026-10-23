const fs=require('fs');
const prefix=fs.readFileSync('tests/smart-merge.cjs','utf8').split('(async () => {')[0];
new Function('require',prefix+`
(async()=>{
 const row={'Họ tên':'QA','Số CCCD':'001099000091','Nhà máy PV':'PV ngoài danh mục','Nhà máy làm việc':'Ghi tự do','Ngày PV':'01/10/2026','Tình trạng':'Đang chờ phỏng vấn'};
 let r=await route.POST(makeRequest([row,row,{...row,'Số CCCD':'invalid'}],false));
 assert.equal(r.body.summary.totalRows,3);assert.equal(r.body.summary.readyCount,1);assert.equal(r.body.summary.duplicateCount,1);assert.equal(r.body.summary.errorCount,1);
 r=await route.POST(makeRequest([row],true));assert.equal(r.body.success,true);assert.equal(dbAssignments[0].interviewFactory,'PV ngoài danh mục');assert.equal(dbAssignments[0].interviewFactoryId,null);assert.equal(dbAssignments[0].workingFactory,'Ghi tự do');assert.equal(dbAssignments[0].workingFactoryId,null);
 const countBefore=dbAssignments.length;mockPrisma.$queryRawUnsafe=async()=>[];r=await route.POST(makeRequest([row],true));assert.equal(r.options.status,409);assert.equal(dbAssignments.length,countBefore);
 console.log('PASS import row partition, unknown interview-factory text and optional working factory');
})().catch(e=>{console.error(e);process.exitCode=1});
`)(require);
