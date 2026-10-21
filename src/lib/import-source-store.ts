import {splitImportReview} from '@/lib/import-review';
import {mkdir,writeFile,rename,readdir,readFile,unlink,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
const directory=path.resolve('.local/source-imports');
const memoryCache=new Map<string,{mtimeMs:number;data:any}>();

export async function saveImportSource(type:string,file:string,sheet:string,rows:any[],warnings:string[],errors:string[]){
 await mkdir(directory,{recursive:true});const id=randomUUID(),target=path.join(directory,id+'.json');
 const issuesByRow=new Map<number,string[]>();
 for(const msg of[...warnings,...errors]){
  const m=/^Dòng (\d+):/.exec(msg);
  if(m){
   const rowNum=Number(m[1]);
   let list=issuesByRow.get(rowNum);
   if(!list){list=[];issuesByRow.set(rowNum,list);}
   list.push(msg);
  }
 }
 const payload={
  id,type,file,sheet,createdAt:new Date().toISOString(),
  rows:rows.map(e=>{
   const rowIssues=issuesByRow.get(e.row)||[];
   const review=splitImportReview(rowIssues);
   return {row:e.row,values:e.raw,warnings:review.warnings.map(i=>i.message),duplicates:review.duplicates.map(i=>i.message)};
  })
 };
 await writeFile(target+'.tmp',JSON.stringify(payload),'utf8');
 await rename(target+'.tmp',target);
 memoryCache.clear();
 return id;
}

export async function readImportSources(){
 let files:string[];try{files=await readdir(directory);}catch(e:any){if(e.code==='ENOENT')return [];throw e;}
 const jsonFiles=files.filter(f=>/^[a-f0-9-]+\.json$/.test(f));
 const results=await Promise.all(jsonFiles.map(async f=>{
  const filePath=path.join(directory,f);
  try{
   const fileStat=await stat(filePath);
   const cached=memoryCache.get(f);
   if(cached&&cached.mtimeMs===fileStat.mtimeMs){return cached.data;}
   const data=JSON.parse(await readFile(filePath,'utf8'));
   memoryCache.set(f,{mtimeMs:fileStat.mtimeMs,data});
   return data;
  }catch{return null;}
 }));
 return results.filter(Boolean);
}

export async function deleteImportSource(id?:string){
 let files:string[];try{files=await readdir(directory);}catch(e:any){if(e.code==='ENOENT')return;throw e;}
 for(const f of files.filter(f=>/^[a-f0-9-]+\.json$/.test(f))){
  if(!id||f===`${id}.json`){
   memoryCache.delete(f);
   await unlink(path.join(directory,f)).catch(()=>{});
  }
 }
}

export async function resolveImportSourceRow(sourceId:string,rowNum:number,mode:'APPROVE'|'DELETE'){
 const fileName=`${sourceId}.json`;
 const filePath=path.join(directory,fileName);
 const raw=await readFile(filePath,'utf8');
 const data=JSON.parse(raw);
 const targetRow=(data.rows||[]).find((r:any)=>Number(r.row)===Number(rowNum));
 if(!targetRow) return null;
 if(mode==='DELETE'){
  data.rows=(data.rows||[]).filter((r:any)=>Number(r.row)!==Number(rowNum));
 }else{
  targetRow.warnings=[];
  targetRow.duplicates=[];
  targetRow.isApproved=true;
 }
 await writeFile(filePath+'.tmp',JSON.stringify(data),'utf8');
 await rename(filePath+'.tmp',filePath);
 memoryCache.delete(fileName);
 return {source:data,row:targetRow};
}


export async function correctImportSourceDate(sourceId:string,rowNum:number,interviewDate:string){
 if(!/^[a-f0-9-]+$/.test(sourceId))throw new Error('Mã nguồn không hợp lệ');
 const file=path.join(directory,sourceId+'.json');
 const data=JSON.parse(await readFile(file,'utf8'));
 const row=(data.rows||[]).find((r:any)=>Number(r.row)===rowNum);
 if(!row)throw new Error('Không tìm thấy dòng nguồn');
 row.values={...row.values,'Ngày PV':interviewDate};
 await writeFile(file+'.tmp',JSON.stringify(data),'utf8');await rename(file+'.tmp',file);memoryCache.delete(sourceId+'.json');
}
