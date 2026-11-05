import { mkdir, writeFile } from 'node:fs/promises';
import { CATALOGS, readOfficialCatalog } from '../lib/official-catalog.ts';
const results=[];
for(const id of Object.keys(CATALOGS)){
  try{const result=await readOfficialCatalog(id);results.push(result);console.log(JSON.stringify({id,total:result.total,entries:result.entries.length,pages:result.pagesRead,complete:result.complete,note:result.note}));}
  catch(error){results.push({id,complete:false,error:error.message});console.log(JSON.stringify({id,error:error.message}));}
}
await mkdir('outputs',{recursive:true});
await writeFile('outputs/cn-catalog-evidence.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
if(results.some(r=>!r.complete))process.exitCode=1;
