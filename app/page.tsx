import {redirect} from "next/navigation";
import Home from "../components/workbench";
import {articleHref,safeListReturn} from "../lib/article-links";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;if(typeof query.article==="string"&&query.article){const p=new URLSearchParams();for(const [key,value] of Object.entries(query))if(key!=="article"&&typeof value==="string")p.set(key,value);redirect(articleHref(query.article,safeListReturn('/'+(p.size?'?'+p.toString():''))));}return <Home/>;}
