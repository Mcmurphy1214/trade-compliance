import {zipSync,strToU8} from 'fflate';
import type {BriefingSnapshot} from './briefing-model';
import {briefingSections,legalStatus,nodeBadges,periodLabel,isBriefingRegulation,sourceUrl} from './briefing-model';

// Editable OOXML: the PDF and Word share content sections, legal status, date
// badges, ordering and source targets. Word owns its native page reflow.
const xml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const head='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const C={navy:'19324B',red:'B11E3B',ink:'27384B',muted:'7B899B',line:'DDE4ED',link:'2D5E8C'};
type Options={size?:number;bold?:boolean;color?:string;before?:number;after?:number;leading?:number;keep?:boolean;style?:string;shade?:string;rule?:boolean};
function runs(text:string,o:Options={}){
 return `<w:r><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans" w:eastAsia="Noto Sans SC"/>${o.bold?'<w:b/>':''}<w:color w:val="${o.color??C.ink}"/><w:sz w:val="${Math.round((o.size??10)*2)}"/><w:szCs w:val="${Math.round((o.size??10)*2)}"/></w:rPr>${text.split('\n').map((s,i)=>`${i?'<w:br/>':''}<w:t xml:space="preserve">${xml(s)}</w:t>`).join('')}</w:r>`;
}
function para(text:string,o:Options={},inner?:string){return `<w:p><w:pPr>${o.style?`<w:pStyle w:val="${o.style}"/>`:''}${o.keep?'<w:keepNext/>':''}${o.rule?`<w:pBdr><w:bottom w:val="single" w:sz="12" w:color="${C.red}" w:space="8"/></w:pBdr>`:''}<w:widowControl/><w:spacing w:before="${(o.before??0)*20}" w:after="${(o.after??10)*20}" w:line="${(o.leading??17.5)*20}" w:lineRule="exact"/><w:wordWrap/>${o.shade?`<w:shd w:fill="${o.shade}"/>`:''}</w:pPr>${inner??runs(text,o)}</w:p>`;}
const link=(text:string,target:string,internal=false,o:Options={})=>`<w:hyperlink ${internal?`w:anchor="${xml(target)}"`:`r:id="${target}"`} w:history="1">${runs(text,{color:C.link,...o})}</w:hyperlink>`;
const cell=(content:string,width:number,right=false)=>`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="top"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="${right?180:0}" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar>${right?`<w:tcBorders><w:left w:val="single" w:sz="4" w:color="${C.line}"/></w:tcBorders>`:''}</w:tcPr>${content||para('',{after:0})}</w:tc>`;
function table(cells:string[],widths:number[],header=''){return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a,b)=>a+b,0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(k=>`<w:${k} w:val="nil"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${header?`<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${widths.reduce((a,b)=>a+b,0)}" w:type="dxa"/><w:gridSpan w:val="${widths.length}"/></w:tcPr>${header}</w:tc></w:tr>`:''}<w:tr>${cells.map((c,i)=>cell(c,widths[i],!!header&&i===2)).join('')}</w:tr></w:tbl>`;}
export function briefingWordFile(snapshot:BriefingSnapshot){
 const relationships:{id:string;url:string}[]=[];
 const sourceLink=(text:string,url:string,o:Options={})=>{const target=sourceUrl(url);if(!target)return runs(text,o);const id='source'+(relationships.length+1);relationships.push({id,url:target});return link(text,id,false,o);};
 const period=periodLabel(snapshot),regulations=snapshot.articles.filter(isBriefingRegulation).length;
 let content=para('贸易合规资讯简报',{size:26,bold:true,color:C.navy,style:'Title',leading:34,after:13})+para(period,{size:10.3,color:C.muted,after:26});
 content+=table([[''+snapshot.articles.length,'重点资讯选编'],[''+regulations,'法规与规范性措施'],[''+(snapshot.articles.length-regulations),'其他更新资讯']].map(([n,label])=>para(n.padStart(2,'0'),{size:22,bold:true,color:C.navy,leading:30,after:8})+para(label,{size:8,color:C.muted,after:18})),[3435,3435,3435]);
 content+=para('资讯目录与摘要',{size:11.4,bold:true,color:C.navy,before:13,after:17,keep:true});
 let lastGroup='';
 snapshot.articles.forEach((a,i)=>{
  const group=isBriefingRegulation(a)?'01 法律法规监测':'02 其他更新资讯';
  if(group!==lastGroup){content+=para(group,{size:9,bold:true,color:C.red,after:12,keep:true});lastGroup=group;}
  const title=para('',{size:10,bold:true,keep:true,after:8},link(`${String(i+1).padStart(2,'0')}  ${a.title}`,'article_'+i,true,{bold:true,color:C.navy}));
  const badges=nodeBadges(a).map(b=>para(b.text,{size:7.5,bold:true,color:b.tone==='amber'?'965608':C.link,leading:12,after:5,shade:b.tone==='amber'?'FFF0D9':'E8EFFA'})).join('');
  content+=table([title,badges],[6925,3380]);
  content+=para(a.summary,{size:8.5,color:C.muted,leading:14.5,after:17});
 });
 snapshot.articles.forEach((a,i)=>{
  content+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  let intro=`<w:p><w:bookmarkStart w:id="${i+1}" w:name="article_${i}"/><w:bookmarkEnd w:id="${i+1}"/>${runs(`${String(i+1).padStart(2,'0')} / ${a.jurisdiction} / ${a.category}`,{size:9,bold:true,color:C.red})}</w:p>`;
  intro+=para(a.title,{size:19.7,bold:true,color:C.navy,leading:28,before:11,after:16,keep:true,style:'Heading1',rule:true});
  intro+=table([para('发布日期',{size:7.5,color:C.muted,after:3,shade:'F0F2F5'})+para(a.publishedDate||'原文未明确',{size:9.5,bold:true,color:C.navy,after:12,shade:'F0F2F5'}),para('状态',{size:7.5,color:C.muted,after:3,shade:'F0F2F5'})+para(legalStatus(a),{size:9.2,bold:true,color:C.red,after:12,shade:'F0F2F5'})],[3300,7005]);
  intro+=para('',{size:2,leading:10,after:4});
  let body=para(a.summary,{size:9.5,leading:16.2,shade:'F5F7FA',after:20});
  for(const s of briefingSections(a)){
   if(s.heading)body+=para(s.heading,{size:11.4,bold:true,color:s.analysis?C.red:C.ink,leading:19,after:8,keep:true,style:'Heading2'});
   if(s.text)body+=para(s.text);
  }
  const label=(s:string)=>para(s,{size:7.8,bold:true,color:C.muted,leading:12,after:7,keep:true});
  const value=(s:string,o:Options={})=>para(s,{size:8.3,leading:13.5,after:13,...o});
  let side=label('STATUS / 状态')+value(legalStatus(a),{bold:true,color:C.red})+label('KEY DATE / 关键日期');
  side+=value(a.effectiveDate?`${/替代/.test(legalStatus(a))?'文件替代':'生效'}：${a.effectiveDate}`:/拟议|草案|征求意见|谈判/.test(legalStatus(a))?'拟议安排，正式生效日尚未确定。':'生效日期：原文未明确。');
  if(a.expiryDate)side+=value('到期：'+a.expiryDate);
  for(const d of a.deadlines||[])side+=value(`${d.date}\n${d.label}\n${d.timezone||'时区以官方原文为准'}${(d as typeof d&{condition?:string}).condition?'\n条件：'+(d as typeof d&{condition?:string}).condition:''}`);
  side+=label('RULE MAP / 文号')+value(a.reference||'原文未另列文号');
  for(const p of a.regulation?.provisions||[])side+=value(p);
  side+=label('AUTHORITY / 发布机构')+value(a.authority||'发布机构待核实')+label('OFFICIAL SOURCES / 原文');
  for(const s of a.sources.filter(s=>!/^业务分析参考/.test(s.title))){side+=para('',{size:8.3,leading:13.5,after:7},sourceLink(s.title||s.url,s.url,{size:8.3}));side+=para('',{size:6.6,leading:10,after:13},sourceLink(s.url,s.url,{size:6.6,color:C.muted}));}
  content+=table([body,'',side],[6740,560,3005],intro);
  content+=para('',{size:8,after:0},link('返回目录','briefing_toc',true,{size:8}));
 });
 const pageField='<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>';
 const styles=head+`<w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans" w:eastAsia="Noto Sans SC"/><w:color w:val="${C.ink}"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${['Title','Heading1','Heading2'].map(n=>`<w:style w:type="paragraph" w:styleId="${n}"><w:name w:val="${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${n==='Heading2'?1:0}"/></w:pPr><w:rPr><w:b/><w:color w:val="${C.navy}"/></w:rPr></w:style>`).join('')}</w:styles>`;
 const files:Record<string,string>={
  '[Content_Types].xml':head+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+['document','styles','settings','fontTable','header1','footer1'].map(n=>`<Override PartName="/word/${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${n==='header1'?'header':n==='footer1'?'footer':n==='fontTable'?'fontTable':n}.xml"/>`).join('')+'</Types>',
  '_rels/.rels':head+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':head+`<w:document ${ns}><w:body><w:bookmarkStart w:id="0" w:name="briefing_toc"/><w:bookmarkEnd w:id="0"/>${content}<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1260" w:right="800" w:bottom="900" w:left="800" w:header="480" w:footer="400"/></w:sectPr></w:body></w:document>`,
  'word/styles.xml':styles,
  'word/settings.xml':head+`<w:settings ${ns}><w:updateFields w:val="true"/><w:defaultTabStop w:val="420"/></w:settings>`,
  'word/fontTable.xml':head+`<w:fonts ${ns}><w:font w:name="Noto Sans SC"><w:altName w:val="Microsoft YaHei"/><w:family w:val="swiss"/></w:font><w:font w:name="Noto Sans"><w:altName w:val="Arial"/><w:family w:val="swiss"/></w:font></w:fonts>`,
  'word/header1.xml':head+`<w:hdr ${ns}>${para('合规前沿 / 全球贸易合规情报    '+period,{size:7.5,color:C.muted,after:10})}</w:hdr>`,
  'word/footer1.xml':head+`<w:ftr ${ns}>${para('',{size:7,color:C.muted,leading:12,after:0},runs(`快照 ${snapshot.createdAt.slice(0,10)} · ${snapshot.articles.length}条选编    `,{size:7,color:C.muted})+link('返回目录','briefing_toc',true,{size:7})+runs('    ',{size:7})+pageField)}</w:ftr>`,
  'word/_rels/document.xml.rels':head+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+['styles','settings','fontTable'].map(n=>`<Relationship Id="${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${n}" Target="${n}.xml"/>`).join('')+'<Relationship Id="header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'+relationships.map(r=>`<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(r.url)}" TargetMode="External"/>`).join('')+'</Relationships>'
 };
 // Main-document content type has the required .main suffix.
 files['[Content_Types].xml']=files['[Content_Types].xml'].replace('wordprocessingml.document.xml','wordprocessingml.document.main+xml').replace(/wordprocessingml\.(styles|settings|fontTable|header|footer)\.xml/g,'wordprocessingml.$1+xml');
 return zipSync(Object.fromEntries(Object.entries(files).map(([name,text])=>[name,strToU8(text)])),{level:6});
}
