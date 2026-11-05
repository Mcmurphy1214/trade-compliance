import type {Metadata} from "next";
import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {workspaceActor} from "../../../lib/workspace-auth";
import {AnalyticsDashboard} from "../../../components/analytics-dashboard";
import "./analytics.css";
export const dynamic="force-dynamic";
export const revalidate=0;
export const metadata:Metadata={title:"访问统计 | 合规前沿",robots:{index:false,follow:false}};
export default async function Page(){
 const actor=await workspaceActor(new Request("https://workbench.internal/admin/analytics",{headers:await headers()}));
 if(!actor)redirect("/?view=login");
 if(actor.role!=="admin"||actor.mustChangePassword)return <main className="analytics-denied"><h1>此页面仅已完成首次改密的管理员可见</h1><a href="/">返回工作台</a></main>;
 return <AnalyticsDashboard/>;
}
