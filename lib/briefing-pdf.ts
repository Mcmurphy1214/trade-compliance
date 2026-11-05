import {PDFDocument,PDFName,PDFString,rgb} from 'pdf-lib';
import type {PDFPage} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {Article} from './types';
import type {BriefingSnapshot,BriefingBadge} from './briefing-model';
import {articleSections,legalStatus,nodeBadges,periodLabel,sourceUrl,isBriefingRegulation} from './briefing-model';

const W=595.28,H=841.89,M=40,PW=W-2*M,MAIN=337,SIDE=150,SX=M+MAIN+28;
const colors={navy:'#19324B',red:'#B11E3B',ink:'#27384B',muted:'#7B899B',line:'#DDE4ED',panel:'#F5F7FA',link:'#2D5E8C'};
const toneColors={green:['#E7F3E2','#2F6B36'],amber:['#FFF0D9','#965608'],blue:['#E8EFFA','#315579'],gray:['#EEF0F2','#5E6772']};
const color=(hex:string)=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
type Unit={lines:string[];size:number;leading:number;bold?:boolean;heading?:boolean;after:number;color?:string;panel?:boolean;url?:string};
type ArticlePlan={article:Article;pages:{height:number;body:Unit[];side:Unit[];title:string[];bodyTop:number}[]};
type FontBytes={regular:Uint8Array;bold:Uint8Array;latinRegular:Uint8Array;latinBold:Uint8Array};
let fontRequest:Promise<FontBytes>|undefined;
async function browserFonts(){
 if(!fontRequest)fontRequest=Promise.all(['/fonts/NotoSansSC-Regular.ttf','/fonts/NotoSansSC-Bold.ttf','/fonts/NotoSans-Regular.ttf','/fonts/NotoSans-Bold.ttf'].map(async url=>{
  const r=await fetch(url);if(!r.ok)throw Error('中文字体加载失败，请重试。');return new Uint8Array(await r.arrayBuffer());
 })).then(([regular,bold,latinRegular,latinBold])=>({regular,bold,latinRegular,latinBold})).catch(e=>{fontRequest=undefined;throw e;});
 return fontRequest;
}
// Bytes are generated locally from the permission-checked immutable snapshot. No print dialog or external rendering service.
export async function generateBriefingPdf(snapshot:BriefingSnapshot,fonts?:FontBytes,progress?:(stage:string)=>void){
 if(snapshot.templateVersion!==1||!snapshot.articles.length)throw Error('简报快照无效，请重新生成。');
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const bytes=fonts||await browserFonts();
 progress?.('fonts loaded');
 const regular=await doc.embedFont(bytes.regular,{subset:true}),bold=await doc.embedFont(bytes.bold,{subset:true});
 const latinRegular=await doc.embedFont(bytes.latinRegular,{subset:true}),latinBold=await doc.embedFont(bytes.latinBold,{subset:true});
 progress?.('fonts embedded');
 const glyphs=new Set(regular.getCharacterSet()),latinGlyphs=new Set(latinRegular.getCharacterSet()),widths=new Map<string,number>();
 const clean=(s:string)=>String(s||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b\ufeff]/g,'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
 function fontFor(ch:string,strong=false){
  const code=ch.codePointAt(0)!;
  if(glyphs.has(code))return strong?bold:regular;
  if(latinGlyphs.has(code))return strong?latinBold:latinRegular;
  throw Error(`资讯含当前字体不支持的字符“${ch}”，请先核对原文后重试。`);
 }
 function wrap(value:string,width:number,size:number,strong=false){
  const lines:string[]=[];
  for(const paragraph of clean(value).split('\n')){
   let line='',length=0;
   for(const ch of paragraph){
    const key=(strong?'b':'r')+ch;let w=widths.get(key);if(w===undefined){w=fontFor(ch,strong).widthOfTextAtSize(ch,1);widths.set(key,w);}w*=size;
    if(length+w>width&&line){lines.push(line);line='';length=0;}
    line+=ch;length+=w;
   }
   lines.push(line);
  }
  return lines;
 }
 function unit(text:string,opts:Partial<Unit>&{width?:number}={}):Unit{
  const size=opts.size??10,leading=opts.leading??17.5;
  return {...opts,lines:wrap(text,opts.width??MAIN,size,opts.bold),size,leading,after:opts.after??10};
 }
 const height=(u:Unit)=>u.lines.length*u.leading+u.after+(u.panel?22:0);
 function body(a:Article){
  const units:Unit[]=[];
  if(a.summary)units.push(unit(a.summary,{panel:true,width:MAIN-22,size:9.5,leading:16.2,after:20}));
  for(const s of articleSections(a.content)){
   if(s.heading)units.push(unit(s.heading,{heading:true,bold:true,size:11.4,leading:19,after:8}));
   if(s.text)units.push(unit(s.text));
  }
  const advice=a.regulation?.businessAdvice||a.implications;
  units.push(unit('对正泰业务的建议 · 分析',{heading:true,bold:true,size:11.4,leading:19,after:8,color:colors.red}));
  if(advice){
   for(const s of articleSections(advice)){
    if(s.heading)units.push(unit(s.heading,{heading:true,bold:true,size:10,leading:17.5,after:6}));
    if(s.text)units.push(unit(s.text));
   }
  }else units.push(unit('本条尚无专项业务分析，请结合实际产品、交易主体与交易路径另行评估。'));
  return units;
 }
 function side(a:Article){
  const units:Unit[]=[];
  const label=(s:string)=>units.push(unit(s,{width:SIDE,size:7.8,leading:12,bold:true,color:colors.muted,after:7}));
  const value=(s:string,opts:Partial<Unit>={})=>units.push(unit(s,{width:SIDE,size:8.3,leading:13.5,after:13,...opts}));
  label('STATUS / 状态');value(legalStatus(a),{bold:true,color:colors.red});
  label('KEY DATE / 关键日期');
  if(a.effectiveDate)value(`${/替代/.test(legalStatus(a))?'文件替代':'生效'}：${a.effectiveDate}`);
  else value(/拟议|草案|征求意见|谈判/.test(legalStatus(a))?'拟议安排，正式生效日尚未确定。':'生效日期：原文未明确。');
  if(a.expiryDate)value(`到期：${a.expiryDate}`);
  for(const d of a.deadlines||[])value(`${d.date}\n${d.label}\n${d.timezone||'时区以官方原文为准'}${(d as typeof d&{condition?:string}).condition?'\n条件：'+(d as typeof d&{condition?:string}).condition:''}`);
  label('RULE MAP / 文号');value(a.reference||'原文未另列文号');
  for(const p of a.regulation?.provisions||[])value(p);
  label('AUTHORITY / 发布机构');value(a.authority||'发布机构待核实');
  label('OFFICIAL SOURCES / 原文');
  const sources=a.sources.filter(s=>!/^业务分析参考/.test(s.title));
  for(const source of sources){
   const url=sourceUrl(source.url);value(source.title||source.url,{url:url||undefined,color:colors.link});
   value(source.url,{url:url||undefined,size:6.6,leading:10,color:colors.muted});
  }
  if(!sources.length)value('尚无可访问的官方原文链接。');
  return units;
 }
 // Split by measured lines, keeping headings with the following paragraph and never truncating long content or URLs.
 function take(pending:Unit[],space:number){
  const result:Unit[]=[];
  while(pending.length){
   const u=pending[0],need=height(u),next=pending[1];
   if(u.heading&&next&&need+Math.min(height(next),next.leading*2)>space+.01&&result.length)break;
   if(need<=space+.01){result.push(pending.shift()!);space-=need;continue;}
   const n=Math.floor((space-(u.panel?22:0)-u.after)/u.leading);
   if(n>=2&&!u.heading){result.push({...u,lines:u.lines.slice(0,n)});pending[0]={...u,lines:u.lines.slice(n)};break;}
   if(!result.length)throw Error('此条资讯版式异常，请分批导出或联系管理员。');
   break;
  }
  return result;
 }
 const plans:ArticlePlan[]=snapshot.articles.map(article=>{
  const pending=body(article),aside=side(article),pages:ArticlePlan['pages']=[];
  while(pending.length||aside.length){
   const title=wrap(article.title+(pages.length?'（续）':''),PW,19.7,true),bodyTop=175+title.length*28;
   const needed=Math.max(pending.reduce((sum,u)=>sum+height(u),0),aside.reduce((sum,u)=>sum+height(u),0));
   const h=Math.min(2000,Math.max(H,bodyTop+needed+62));
   const space=h-bodyTop-62;
   pages.push({height:h,body:pending.length?take(pending,space):[],side:aside.length?take(aside,space):[],title,bodyTop});
  }
  return {article,pages};
 });
 progress?.('article layout');
 type TocRow={index:number;group:string;title:string[];summary:string[];badges:BriefingBadge[];height:number};
 const tocPlans:TocRow[][]=[[]];let available=482,lastGroup='';
 snapshot.articles.forEach((a,index)=>{
  const group=isBriefingRegulation(a)?'01 法律法规监测':'02 其他更新资讯',title=wrap(a.title,285,9.7,true);
  const summary=wrap(a.summary.length>56?a.summary.slice(0,56)+'…':a.summary,PW-27,8.1);
  const badges=nodeBadges(a),shown=badges.slice(0,2);
  let h=Math.max(title.length*14.3,shown.reduce((s,b)=>s+wrap(b.text,135,7.2,true).length*10+7,0)+(badges.length>2?10:0))+summary.length*11.6+11;
  const groupSpace=group!==lastGroup?27:0;
  if(h+groupSpace>available&&tocPlans.at(-1)!.length){tocPlans.push([]);available=573;lastGroup='';}
  const needsGroup=group!==lastGroup;lastGroup=group;h+=needsGroup?27:0;
  tocPlans.at(-1)!.push({index,group:needsGroup?group:'',title,summary,badges,height:h});available-=h;
 });
 const tocPages=tocPlans.map(()=>doc.addPage([W,H]));
 progress?.('contents layout');
 const articlePages=plans.map(p=>p.pages.map(p=>doc.addPage([W,p.height])));
 const firstPages=articlePages.map(p=>doc.getPages().indexOf(p[0])+1);
 function text(page:PDFPage,value:string,x:number,top:number,size=10,strong=false,hex=colors.ink){
  let run='',font=strong?bold:regular,offset=x;
  const flush=()=>{if(run){page.drawText(run,{x:offset,y:page.getHeight()-top-size,font,size,color:color(hex)});offset+=font.widthOfTextAtSize(run,size);run='';}};
  for(const ch of clean(value)){const next=fontFor(ch,strong);if(next!==font){flush();font=next;}run+=ch;}flush();
 }
 function rule(page:PDFPage,top:number,hex=colors.line,thickness=.6,x1=M,x2=W-M){page.drawLine({start:{x:x1,y:page.getHeight()-top},end:{x:x2,y:page.getHeight()-top},thickness,color:color(hex)});}
 function rect(page:PDFPage,x:number,top:number,width:number,h:number,hex:string){page.drawRectangle({x,y:page.getHeight()-top-h,width,height:h,color:color(hex)});}
 function annotation(page:PDFPage,box:number[],action:Record<string,any>){page.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:box,Border:[0,0,0],A:action})));}
 function internal(page:PDFPage,target:PDFPage,x:number,top:number,w:number,h:number){annotation(page,[x,page.getHeight()-top-h,x+w,page.getHeight()-top],{S:'GoTo',D:[target.ref,PDFName.of('Fit')]});}
 function drawUnits(page:PDFPage,units:Unit[],x:number,top:number,width:number){
  let y=top;
  for(const u of units){
   const start=y;
   if(u.panel){rect(page,x,y,width,u.lines.length*u.leading+22,colors.panel);y+=11;}
   for(const line of u.lines){text(page,line,x+(u.panel?11:0),y,u.size,u.bold,u.color||colors.ink);y+=u.leading;}
   if(u.panel)y+=11;
   if(u.url)annotation(page,[x,page.getHeight()-y,x+width,page.getHeight()-start],{S:'URI',URI:PDFString.of(u.url)});
   y+=u.after;
  }
 }
 const period=periodLabel(snapshot),regulations=snapshot.articles.filter(isBriefingRegulation).length;
 tocPages.forEach((page,i)=>{
  text(page,i?'资讯目录（续）':'贸易合规资讯简报',M,74,26,true,colors.navy);
  text(page,period,M,119,10.3,false,colors.muted);
  let y:number;
  if(!i){
   rule(page,157);[[''+snapshot.articles.length,'重点资讯选编'],[''+regulations,'法规与规范性措施'],[''+(snapshot.articles.length-regulations),'其他更新资讯']].forEach(([n,label],k)=>{const x=M+k*PW/3+8;text(page,n.padStart(2,'0'),x,172,22,true,colors.navy);text(page,label,x,207,8,false,colors.muted);});
   rule(page,235);text(page,'资讯目录与摘要',M,248,11,true,colors.navy);y=278;
  }else{rule(page,157,colors.red,1.6);text(page,'资讯目录与摘要',M,172,11,true,colors.navy);y=199;}
  for(const row of tocPlans[i]){
   if(row.group){text(page,row.group,M,y,8.8,true,colors.red);y+=27;}
   const top=y,titleTop=y;
   text(page,String(row.index+1).padStart(2,'0'),M,y,9.6,true,colors.red);
   for(const line of row.title){text(page,line,M+27,y,9.7,true,colors.navy);y+=14.3;}
   let by=top;
   for(const b of row.badges.slice(0,2)){
    const lines=wrap(b.text,135,7.2,true),h=lines.length*10+5,[bg,fg]=toneColors[b.tone];rect(page,W-M-160,by,144,h,bg);
    for(const [k,line]of lines.entries())text(page,line,W-M-155,by+2+k*10,7.2,true,fg);by+=h+2;
   }
   if(row.badges.length>2){text(page,`另有${row.badges.length-2}项节点，详见正文`,W-M-160,by,6.2,false,colors.muted);by+=10;}
   text(page,String(firstPages[row.index]).padStart(2,'0'),W-M-10,top,8,false,colors.muted);
   const summaryTop=Math.max(y,by)+3;y=summaryTop;
   for(const line of row.summary){text(page,line,M+27,y,8.1,false,colors.muted);y+=11.6;}
   y+=8;rule(page,y-3,colors.line,.4);
   internal(page,articlePages[row.index][0],M,titleTop,PW,y-titleTop-4);
  }
  if(i+1<tocPages.length){text(page,'目录续页 →',M,H-64,8.3,false,colors.link);internal(page,tocPages[i+1],M,H-68,100,20);}
 });
 plans.forEach((plan,i)=>plan.pages.forEach((p,j)=>{
  const a=plan.article,page=articlePages[i][j];
  text(page,`${String(i+1).padStart(2,'0')} / ${a.jurisdiction} / ${a.category}`,M,69,9,true,colors.red);
  let y=94;for(const line of p.title){text(page,line,M,y,19.7,true,colors.navy);y+=28;}
  rule(page,y+5,colors.red,1.7);rect(page,M,y+18,PW,41,'#F0F2F5');
  text(page,'发布日期',M+12,y+23,7.5,false,colors.muted);text(page,a.publishedDate||'原文未明确',M+12,y+38,9.5,true,colors.navy);
  text(page,'状态',M+165,y+23,7.5,false,colors.muted);
  const statusLines=wrap(legalStatus(a),PW-185,9.2,true);for(const [n,line]of statusLines.entries())text(page,line,M+165,y+38+n*13,9.2,true,colors.red);
  const bodyTop=y+81;
  drawUnits(page,p.body,M,bodyTop,MAIN);drawUnits(page,p.side,SX,bodyTop,SIDE);
  page.drawLine({start:{x:SX-14,y:page.getHeight()-bodyTop},end:{x:SX-14,y:54},color:color(colors.line),thickness:.6});
 }));
 for(const [i,page]of doc.getPages().entries()){
  text(page,'合规前沿 / 全球贸易合规情报',M,29,7.7,false,colors.muted);
  const dateText=period,textWidth=regular.widthOfTextAtSize(dateText,7.3);text(page,dateText,W-M-textWidth,29,7.3,false,colors.muted);rule(page,51,colors.navy,.8);
  rule(page,page.getHeight()-36);
  text(page,`快照 ${snapshot.createdAt.slice(0,10)} · ${snapshot.articles.length}条选编`,M,page.getHeight()-28,6.8,false,colors.muted);
  text(page,`${String(i+1).padStart(2,'0')} / ${String(doc.getPageCount()).padStart(2,'0')}`,W-M-33,page.getHeight()-27,7.2,false,colors.muted);
  if(i){text(page,'返回目录',W-M-94,page.getHeight()-28,7.1,false,colors.link);internal(page,tocPages[0],W-M-98,page.getHeight()-32,56,20);}
 }
 doc.setTitle('贸易合规资讯简报');doc.setAuthor('合规前沿');doc.setSubject(period);doc.setCreator('合规前沿 · 团队工作台');
 progress?.('serializing PDF');
 return {bytes:await doc.save(),pageCount:doc.getPageCount(),articlePages:firstPages};
}

export async function downloadBriefingPdf(snapshot:BriefingSnapshot){
 const result=await generateBriefingPdf(snapshot);
 const blob=new Blob([result.bytes as BlobPart],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`贸易合规资讯简报_${snapshot.periodStart||'未明确'}_${snapshot.periodEnd||'未明确'}.pdf`;
 document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 return result.pageCount;
}
