import {cache} from "react";
import type {Metadata} from "next";
import {notFound} from "next/navigation";
import {feed} from "../../../lib/store";
import {articlePath,listHref,safeListReturn} from "../../../lib/article-links";
import Workbench from "../../../components/workbench";
export const dynamic="force-dynamic";
const readFeed=cache(feed);
type Props={params:Promise<{id:string}>;searchParams:Promise<{from?:string|string[]}>};
export async function generateMetadata({params}:Props):Promise<Metadata>{const {id}=await params;const data=await readFeed();const article=data.articles.find(a=>a.id===id);return article?{title:article.title+" | 合规前沿",description:article.summary,alternates:{canonical:articlePath(article.id)},openGraph:{title:article.title,description:article.summary,type:"article"}}:{title:"资讯未找到 | 合规前沿"};}
export default async function Page({params,searchParams}:Props){const {id}=await params;const query=await searchParams;const data=await readFeed();const article=data.articles.find(a=>a.id===id);if(!article)notFound();const returnTo=typeof query.from==="string"?safeListReturn(query.from):"/";return <Workbench initialArticle={article} returnTo={returnTo}/>;}
