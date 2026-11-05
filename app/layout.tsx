import type {Metadata} from "next";import "./globals.css";import "./reader.css";
import {PageViewTracker} from "../components/page-view-tracker";
import "./workbench.css";
import "./workbench-filters.css";
import "./regulatory.css";
export const metadata:Metadata={title:"合规前沿 | 团队工作台",description:"独立的贸易合规团队工作台：全球资讯、共同选题、规则入池、研判记录与Excel/Word导出。",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}<PageViewTracker/></body></html>}
