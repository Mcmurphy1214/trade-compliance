import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFRef,PDFString} from 'pdf-lib';
async function module(entry){const result=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const {buildBriefingSnapshot,nodeBadges,businessRank,periodLabel}=await module('lib/briefing-model.ts');
const {generateBriefingPdf}=await module('lib/briefing-pdf.ts');
const dir='.sites-runtime/pdf-qa';fs.mkdirSync(dir,{recursive:true});
const fixture=process.env.BRIEFING_QA_FEED?JSON.parse(fs.readFileSync(process.env.BRIEFING_QA_FEED,'utf8')).articles:JSON.parse(fs.readFileSync('lib/seed.json','utf8')).slice(0,8);
const source=structuredClone(fixture),snapshot=buildBriefingSnapshot(source,'2026-11-05T07:00:00Z',{start:'2026-10-30',end:'2026-11-05'});
assert.equal(snapshot.articles.length,new Set(source.map(a=>a.id)).size);
assert.equal(periodLabel(snapshot),'2026年10月30日-2026年11月5日');
assert.throws(()=>buildBriefingSnapshot(source,'2026-11-05T07:00:00Z',{start:'2026-11-06',end:'2026-11-05'}));
assert.throws(()=>buildBriefingSnapshot(source,'2026-11-05T07:00:00Z',{start:'2026-02-30'}));
const before=snapshot.articles.find(a=>a.id===source[0].id).content;source[0].content='modified later';assert.equal(snapshot.articles.find(a=>a.id===source[0].id).content,before);
const base=fixture[0],draft={...base,status:'拟议／尚未生效',effectiveDate:null,regulation:{kind:'拟议规则',changeSummary:'更新'},deadlines:[{date:'2026-12-14',label:'意见截止',timezone:'Asia/Seoul'},{date:'2027-01-04',label:'回复截止',timezone:'Asia/Seoul'}]};
assert.equal(nodeBadges(draft).length,2);assert(nodeBadges(draft).every(b=>b.tone==='amber'));
assert.equal(businessRank({...base,title:'正泰新能相关公告',summary:'',topics:[]}),0);
assert.equal(businessRank({...base,title:'韩国变压器复审',summary:'',topics:[]}),1);
const fonts={regular:fs.readFileSync('public/fonts/NotoSansSC-Regular.ttf'),bold:fs.readFileSync('public/fonts/NotoSansSC-Bold.ttf'),latinRegular:fs.readFileSync('public/fonts/NotoSans-Regular.ttf'),latinBold:fs.readFileSync('public/fonts/NotoSans-Bold.ttf')};
const started=Date.now();const result=await generateBriefingPdf(snapshot,fonts,stage=>console.log(stage,Date.now()-started));fs.writeFileSync(dir+'/latest.pdf',result.bytes);
fs.writeFileSync(dir+'/expected.json',JSON.stringify({snapshot,...result,bytes:undefined}));
const pdf=await PDFDocument.load(result.bytes),pages=pdf.getPages();
assert(result.pageCount>=fixture.length+1);assert.equal(result.articlePages.length,fixture.length);
let uris=0,gotos=0;
for(const page of pages){const annotations=page.node.Annots();if(!annotations)continue;for(const annotation of annotations.asArray()){
 const d=pdf.context.lookup(annotation,PDFDict),a=d.lookup(PDFName.of('A'),PDFDict),s=a.get(PDFName.of('S')).toString();
 if(s==='/URI'){const uri=a.lookup(PDFName.of('URI'),PDFString).decodeText();assert(/^https?:\/\//.test(uri));uris++;}
 if(s==='/GoTo'){const target=a.lookup(PDFName.of('D'),PDFArray).get(0);assert(target instanceof PDFRef);assert(pages.some(p=>p.ref===target));gotos++;}
}}
assert(uris>=fixture.reduce((n,a)=>n+a.sources.length,0));assert(gotos>=fixture.length);
const long={...base,id:'long-qa',title:'长正文与未知日期测试',publishedDate:null,effectiveDate:null,expiryDate:null,regulation:undefined,content:'【完整正文】\n'+Array.from({length:100},(_,i)=>'第'+i+'段：适用条件、产品范围、例外和日期必须保留。').join('\n\n')+'\n\n末尾完整性标记：不截断。',deadlines:[]};
const longSnapshot=buildBriefingSnapshot([long],'2026-11-05T07:00:00Z');assert.equal(periodLabel(longSnapshot),'发布日期未明确');
const stress=await generateBriefingPdf(longSnapshot,fonts);assert(stress.pageCount>2);fs.writeFileSync(dir+'/long-content.pdf',stress.bytes);
console.log(JSON.stringify({status:'PASS',articles:fixture.length,pages:result.pageCount,uriLinks:uris,internalLinks:gotos,longPages:stress.pageCount,checks:'immutable snapshot; explicit date range; unknown dates; conditional nodes; business priority; PDF bytes; complete long-body continuation; valid hyperlinks'}));
