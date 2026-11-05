"use client";
import {useEffect,useState} from "react";
import {ArrowLeft,ArrowUpRight,Bookmark,CheckCircle2,ChevronRight,FileText,Link2,PenLine,ShieldCheck,Activity,ExternalLink} from "lucide-react";
import {CATEGORIES} from "../lib/config";
import {articleHref,articlePath,listHref} from "../lib/article-links";
import type {Article} from "../lib/types";
import {ArticleEditor} from "./article-editor";
const fmt=(s:string)=>new Date(s).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false});
const shortCat=(s:string)=>s==="市场准入与产业政策"?"市场准入":s;
const badge=(s:string)=>s.includes("生效")||s==="已公布实施"?"green":s==="征求意见"||s==="拟议"?"amber":s==="执法案件"?"rose":"blue";
function ArticleBody({text}:{text:string}){return <div className="article-body">{text.split(/\n+/).filter(p=>p.trim()).map((p,i)=>{const m=p.match(/^【([^】]+)】([\s\S]*)$/);return <div className="prose-block" key={i}>{m&&<h3>{m[1]}</h3>}<p>{m?m[2]:p}</p></div>})}</div>}
export function ArticleReader({article,related,returnTo}:{article:Article;related:Article[];returnTo:string}){
 const [saved,setSaved]=useState(false),[canEdit,setCanEdit]=useState(false),[editing,setEditing]=useState(false),[toast,setToast]=useState("");
 useEffect(()=>{try{setSaved(JSON.parse(localStorage.getItem("compliance-saved")??"[]").includes(article.id))}catch{}fetch("/api/session",{cache:"no-store"}).then(r=>r.ok?r.json() as Promise<{canEdit:boolean}>:null).then(s=>{if(s)setCanEdit(s.canEdit)}).catch(()=>{});},[article.id]);
 function notify(s:string){setToast(s);setTimeout(()=>setToast(""),2600)}
 function toggleSave(){try{const all:string[]=JSON.parse(localStorage.getItem("compliance-saved")??"[]");const next=saved?all.filter(id=>id!==article.id):[...new Set([...all,article.id])];localStorage.setItem("compliance-saved",JSON.stringify(next));setSaved(!saved);notify(saved?"已取消收藏":"已收藏资讯")}catch{notify("暂时无法保存收藏")}}
 function copyLink(){navigator.clipboard.writeText(new URL(articlePath(article.id),location.origin).href).then(()=>notify("资讯链接已复制")).catch(()=>notify("请复制浏览器地址栏中的链接"))}
 const toc=[{id:"overview",label:"资讯信息"},{id:"content",label:"主体内容"},{id:"implications",label:"企业启示"},...(article.deadlines.length?[{id:"deadlines",label:"相关期限"}]:[]),{id:"sources",label:"官方原文与附件"},...(article.history.length?[{id:"history",label:"修订记录"}]:[])];
 return <div className="reader-shell">
  <div className="utility"><div className="wrap utility-inner"><span><span className="live-dot"/> GLOBAL TRADE INTELLIGENCE</span><span>官方信源 · 可追溯</span></div></div>
  <header className="header"><div className="wrap header-inner"><a className="brand" href="/" aria-label="合规前沿首页"><span className="brand-mark"><ShieldCheck size={25}/></span><span><strong>合规前沿<span className="brand-dot">.</span></strong><small>COMPLIANCE FRONTIER</small></span></a><nav aria-label="主要板块"><a className="nav-link" href="/">今日速览</a>{CATEGORIES.map(c=><a key={c} className={"nav-link "+(c===article.category?"selected":"")} href={listHref(c)}>{shortCat(c)}</a>)}</nav><a className="reader-header-back" href={returnTo}><ArrowLeft size={15}/>返回列表</a></div></header>
  <main className="reader-wrap">
   <nav className="reader-breadcrumb" aria-label="当前位置"><a href="/">首页</a><ChevronRight size={12}/><a href={listHref(article.category)}>{article.category}</a><ChevronRight size={12}/><span>资讯详情</span></nav>
   <div className="reader-grid">
    <article className="reader-main" aria-labelledby="article-title">
     <div className="reader-kicker"><span className="category-label">{article.category}</span><span>{article.jurisdiction}</span><span>{article.eventType}</span></div>
     <h1 id="article-title">{article.title}</h1>
     <div className="reader-byline"><time dateTime={article.publishedDate??undefined}>{article.publishedDate??"发布日期待核实"}</time><span>{article.authority}</span><span className="reader-verified"><ShieldCheck size={13}/>{article.verification}</span></div>
     <div className="reader-toolbar"><div className="reader-status"><span className={"badge "+badge(article.status)}>{article.status}</span><span>{article.changeType}</span></div><div className="reader-actions"><button onClick={toggleSave} className={saved?"saved":""}><Bookmark size={15} fill={saved?"currentColor":"none"}/>{saved?"已收藏":"收藏"}</button><button onClick={copyLink}><Link2 size={15}/>复制链接</button>{canEdit&&<button onClick={()=>setEditing(true)}><PenLine size={15}/>编辑</button>}</div></div>
     <p className="reader-summary">{article.summary}</p>
     <section id="overview" className="reader-section"><h2>资讯信息</h2><table className="detail-table reader-metadata"><tbody>
      <tr><th scope="row">发布主体</th><td colSpan={3}>{article.authority}</td></tr>
      <tr><th scope="row">原始发布日期</th><td>{article.publishedDate??"待核实"}</td><th scope="row">生效时间</th><td>{article.effectiveDate??"原文未另列"}</td></tr>
      <tr><th scope="row">到期时间</th><td>{article.expiryDate??"原文未另列"}</td><th scope="row">公告／规则编号</th><td>{article.reference||"未另列"}</td></tr>
      <tr><th scope="row">受影响地区</th><td colSpan={3}>{article.affectedRegions.join("、")||"待核实"}</td></tr>
      <tr><th scope="row">关注主题</th><td colSpan={3}>{article.topics.join(" · ")||"未另列"}</td></tr>
      <tr><th scope="row">最近核验</th><td colSpan={3}>{fmt(article.verifiedAt)}（北京时间）</td></tr>
      <tr><th scope="row">收录时间</th><td colSpan={3}>{fmt(article.collectedAt)}（北京时间）</td></tr>
      {article.editorialUpdatedAt&&<tr><th scope="row">正文整理更新</th><td colSpan={3}>{fmt(article.editorialUpdatedAt)}（北京时间）</td></tr>}
     </tbody></table></section>
     <section id="content" className="reader-section"><h2><FileText size={19}/>资讯主体内容 <small>{article.contentStyle??"资讯正文"}</small></h2>{article.contentStyle&&<p className="editorial-note">{article.contentStyle==="中文原文整理"?"依官方中文原文整理，保留主要规定、适用条件与时间安排。":"依据官方原文翻译并适度提炼，保留主要规定、适用条件与时间安排。"}</p>}<ArticleBody text={article.content}/></section>
     <section id="implications" className="implications reader-section"><h2><Activity size={19}/>企业启示 <small>分析意见</small></h2>{article.implications.split(/\n+/).map((p,i)=><p key={i}>{p}</p>)}</section>
     {article.deadlines.length>0&&<section id="deadlines" className="reader-section"><h2>相关期限</h2>{article.deadlines.map((d,i)=><div className="reader-deadline" key={i}><strong>{d.date}</strong><p>{d.label}<small>{d.timezone}</small></p></div>)}</section>}
     <section id="sources" className="reader-section"><h2><ExternalLink size={18}/>官方原文与附件</h2>{article.sources.map((s,i)=><a className="source-link" key={i} href={s.url} target="_blank" rel="noopener noreferrer"><span><strong>{s.title}</strong><small>{new URL(s.url).hostname}</small></span><ArrowUpRight size={18}/></a>)}</section>
     {article.history.length>0&&<section id="history" className="reader-section reader-history"><h2>修订记录</h2>{article.history.map((h,i)=><p key={i}><time>{fmt(h.date)}</time>{h.note}</p>)}</section>}
     <div className="reader-bottom"><a className="outline" href={returnTo}><ArrowLeft size={15}/>返回资讯列表</a><a className="primary" href={article.sources[0].url} target="_blank" rel="noopener noreferrer">查看官方原文<ArrowUpRight size={16}/></a></div>
    </article>
    <aside className="reader-aside"><div className="reader-aside-sticky"><section className="reader-toc"><span className="reader-aside-label">ON THIS PAGE</span><h2>本文导览</h2><nav aria-label="本文导览">{toc.map((t,i)=><a key={t.id} href={"#"+t.id}><span>0{i+1}</span>{t.label}</a>)}</nav></section>
     {related.length>0&&<section className="reader-related"><span className="reader-aside-label">MORE INSIGHTS</span><h2>同板块资讯</h2>{related.map(a=><a key={a.id} href={articleHref(a.id,returnTo)}><span>{a.publishedDate} · {a.jurisdiction}</span><h3>{a.title}</h3><ArrowUpRight size={14}/></a>)}</section>}
     <div className="reader-source-note"><ShieldCheck size={21}/><strong>每条资讯，追溯原文</strong><p>官方事实与企业分析分别呈现，关键条件及日期请结合原文阅读。</p></div></div></aside>
   </div>
  </main>
  <footer className="footer"><div className="reader-wrap footer-inner"><div><strong>合规前沿.</strong><span>全球贸易合规资讯库</span></div><p>官方事实与企业分析分别标注 · 日期以原始文件为准</p><a href={returnTo}>返回资讯列表</a></div></footer>
  {editing&&<ArticleEditor value={article} isNew={false} onClose={()=>setEditing(false)} onSaved={()=>location.reload()}/>}
  {toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
 </div>
}
