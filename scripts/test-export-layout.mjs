import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {PDFDocument} from 'pdf-lib';
import {unzipSync,strFromU8} from 'fflate';
async function load(entry){const b=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {buildBriefingSnapshot}=await load('lib/briefing-model.ts');
const {generateBriefingPdf}=await load('lib/briefing-pdf.ts');
const {wordFile,excelFile,exportRow,excelTextChunks}=await load('lib/workspace-export.ts');
const {DEFAULT_EXPORT_FIELDS,EXPORT_LABELS}=await load('lib/workspace-export-fields.ts');
const all=JSON.parse(fs.readFileSync('lib/seed.json','utf8'));
const articles=['kr-ks-certification-drafts-20261104','eu-drug-precursors-council-mandate-20261104'].map(id=>all.find(a=>a.id===id));
const snapshot=buildBriefingSnapshot(articles,'2026-11-05T12:30:00Z',{start:'2026-11-02',end:'2026-11-04'});
const fonts=Object.fromEntries([['regular','NotoSansSC-Regular'],['bold','NotoSansSC-Bold'],['latinRegular','NotoSans-Regular'],['latinBold','NotoSans-Bold']].map(([k,f])=>[k,fs.readFileSync('public/fonts/'+f+'.ttf')]));
const pdf=await generateBriefingPdf(snapshot,fonts),parsed=await PDFDocument.load(pdf.bytes);
assert(parsed.getPageCount()>3,'The reported long pages must continue on A4 pages');
for(const p of parsed.getPages()){assert(Math.abs(p.getWidth()-595.28)<.1);assert(Math.abs(p.getHeight()-841.89)<.1);}
const exported={id:'export-layout-qa',createdAt:snapshot.createdAt,createdBy:'合规团队',fields:DEFAULT_EXPORT_FIELDS,fieldLabels:EXPORT_LABELS,rows:snapshot.articles.map(a=>exportRow(a,{note:'',status:'待研判'})),poolVersions:[],briefing:snapshot};
const word=wordFile(exported),excel=excelFile(exported),parts=unzipSync(word),document=strFromU8(parts['word/document.xml']);
for(const a of articles){for(const text of [a.title,a.content,a.implications,a.regulation.businessAdvice])for(const line of text.split(/\n/).filter(Boolean)){const normalized=line.replace(/^【([^】]+)】\s*/,'$1');assert(document.replace(/<[^>]*>/g,'').includes(normalized),'Word must preserve full content: '+line.slice(0,25));}}
assert(document.includes('w:anchor="article_0"'));assert(document.includes('<w:tblLayout w:type="fixed"'));assert(document.includes('w:w="11906" w:h="16838"'));assert(!document.includes('w:cantSplit'));assert(!document.includes('w:hRule="exact"'));
const rels=strFromU8(parts['word/_rels/document.xml.rels']);for(const a of articles)for(const s of a.sources)assert(rels.includes(s.url.replace(/&/g,'&amp;')));
const long='完整正文与例外条件\n'.repeat(5000)+'末尾不能丢失。',chunks=excelTextChunks(long,65);assert(chunks.length>1);assert.equal(chunks.join(''),long);assert(chunks.every(s=>s.length<=32767));
const sheet=strFromU8(unzipSync(excel)['xl/worksheets/sheet1.xml']);assert(sheet.includes('资讯完整内容'));assert([...sheet.matchAll(/ht="([0-9.]+)"/g)].some(m=>Number(m[1])>110));
const out=path.resolve(process.env.EXPORT_LAYOUT_QA_DIR||'.sites-runtime/export-layout-qa');fs.mkdirSync(out,{recursive:true});
const stem='贸易合规资讯简报_2026-11-02_2026-11-04_修正版';
for(const [suffix,bytes] of [['pdf',pdf.bytes],['docx',word],['xlsx',excel]])fs.writeFileSync(path.join(out,stem+'.'+suffix),bytes);
fs.writeFileSync(path.join(out,'expected.json'),JSON.stringify({snapshot,pages:pdf.pageCount,articlePages:pdf.articlePages}));
console.log(JSON.stringify({status:'PASS',articles:articles.length,pages:pdf.pageCount,output:out,checks:'A4 page continuation; full body and both advice fields; editable two-column DOCX; TOC bookmarks; official hyperlinks; lossless Excel continuation'}));
