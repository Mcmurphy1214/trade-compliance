import {briefingWordFile} from "./briefing-word";
import {anonymizeContent} from "./content-privacy";
import {zipSync,strToU8} from "fflate";
import type {Article} from "./types";
import type {PoolEntry,WorkspaceActor} from "./workspace-types";
import {EXPORT_FIELDS} from "./workspace-export-fields";
import type {ExportField} from "./workspace-export-fields";
export {EXPORT_FIELDS} from "./workspace-export-fields";
export type ExportRow=Record<typeof EXPORT_FIELDS[number],string>;
const clean=(v:unknown)=>anonymizeContent(String(v??"")).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
export function exportRow(a:Article,p:PoolEntry):ExportRow{return Object.fromEntries(Object.entries({"资讯ID":a.id,"资讯标题":a.title,"摘要":a.summary,"资讯内容":a.content,"发布机构":a.authority,"生效状态":a.status,"发布日期":a.publishedDate??"原文未另列","生效日期":a.effectiveDate??"原文未另列","到期日期":a.expiryDate??"原文未另列","板块":a.category,"发布法域":a.jurisdiction,"受影响地区":a.affectedRegions.join("、"),"主题":a.topics.join("、"),"企业启示":a.implications,"原文链接":a.sources.map(s=>`${s.title}\n${s.url}`).join("\n\n"),"公告编号":a.reference,"相关期限":a.deadlines.map(d=>`${d.date} ${d.timezone}：${d.label}`).join("\n"),"核验时间":a.verifiedAt,"团队备注":p.note,"选题状态":p.status}).map(([k,v])=>[k,clean(v)])) as ExportRow;}
export type ExportSnapshot={id:string;createdAt:string;createdBy:string;fields:ExportField[];rows:ExportRow[];fieldLabels?:Partial<Record<ExportField,string>>;poolVersions:{id:string;version:number}[];formats?:string[];briefing?:import('./briefing-model').BriefingSnapshot};
const xml=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const header='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const archive=(files:Record<string,string>)=>zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])),{level:6});
function column(n:number){let s="";while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
const fieldWidth=(field:string)=>['资讯内容','摘要','企业启示','原文链接'].includes(field)?65:field==='资讯标题'?44:23;
// Excel caps row heights and cell lengths. Continue long text in additional rows
// instead of hiding it below a fixed-height row or discarding characters.
export function excelTextChunks(value:string,width:number){
 const chunks:string[]=[];let chunk='',line=1,used=0;
 for(const ch of value){
  const units=(ch.codePointAt(0)??0)>255?2:1;
  const nextLine=ch==='\n'||used+units>width-2;
  if((nextLine&&line>=28)||chunk.length+ch.length>30000){chunks.push(chunk);chunk='';line=1;used=0;}
  else if(nextLine){line++;used=0;}
  chunk+=ch;if(ch!=='\n')used+=units;
 }
 if(chunk||!chunks.length)chunks.push(chunk);return chunks;
}
export function excelFile(snapshot:ExportSnapshot){
 const data=[snapshot.fields.map(k=>snapshot.fieldLabels?.[k]??k)];
 for(const source of snapshot.rows){
  const parts=snapshot.fields.map(k=>excelTextChunks(source[k]??'',fieldWidth(k))),count=Math.max(...parts.map(p=>p.length));
  for(let n=0;n<count;n++)data.push(parts.map(p=>p.length===1?p[0]:p[n]??''));
 }
 const rowHeight=(row:string[])=>Math.min(409,Math.max(35,...row.map((v,j)=>{let lines=1,used=0;for(const ch of v){const units=(ch.codePointAt(0)??0)>255?2:1;if(ch==='\n'||used+units>fieldWidth(snapshot.fields[j])-2){lines++;used=0;}if(ch!=='\n')used+=units;}return lines*14+12;})));
 const rows=data.map((row,i)=>`<row r="${i+1}" ht="${i?rowHeight(row):28}" customHeight="1">${row.map((v,j)=>`<c r="${column(j+1)}${i+1}" t="inlineStr" s="${i?1:2}"><is><t xml:space="preserve">${xml(v??'')}</t></is></c>`).join('')}</row>`).join('');
return archive({
"[Content_Types].xml":header+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
"_rels/.rels":header+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
"xl/workbook.xml":header+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="团队合规简报" sheetId="1" r:id="rId1"/></sheets></workbook>',
"xl/_rels/workbook.xml.rels":header+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
"xl/styles.xml":header+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173E66"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
"xl/worksheets/sheet1.xml":header+`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols>${snapshot.fields.map((k,i)=>`<col min="${i+1}" max="${i+1}" width="${fieldWidth(k)}" customWidth="1"/>`).join('')}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${column(snapshot.fields.length)}${data.length}"/></worksheet>`
});}
const wordParagraph=(text:string,bold=false,size=21)=>`<w:p><w:pPr><w:spacing w:after="110" w:line="320" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Microsoft YaHei"/>${bold?'<w:b/>':''}<w:sz w:val="${size}"/></w:rPr>${text.split("\n").map((s,i)=>`${i?'<w:br/>':''}<w:t xml:space="preserve">${xml(s)}</w:t>`).join('')}</w:r></w:p>`;
export function wordFile(snapshot:ExportSnapshot){if(snapshot.briefing)return briefingWordFile(snapshot.briefing);return archive({
"[Content_Types].xml":header+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
"_rels/.rels":header+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
"word/document.xml":header+`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${wordParagraph('合规前沿 · 团队合规简报',true,32)}${wordParagraph(`导出快照：${snapshot.id}\n生成时间：${snapshot.createdAt}\n生成者：${snapshot.createdBy}\n资讯数量：${snapshot.rows.length}`)}${snapshot.rows.map((row,i)=>wordParagraph(snapshot.fields.includes("资讯标题")?`${i+1}. ${row['资讯标题']}`:`第${i+1}条资讯`,true,26)+snapshot.fields.map(k=>wordParagraph(snapshot.fieldLabels?.[k]??k,true)+wordParagraph(row[k])).join('')).join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`
});}
