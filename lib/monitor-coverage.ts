export type RequiredSource = {id:string;label:string;url:string};

function canonicalUrl(value:string){
  try{const url=new URL(value);return url.origin+url.pathname.replace(/\/+$/,"");}
  catch{return null;}
}

export function reconcileMonitorCoverage(status:string,checkedSources:string[],gaps:string[],requiredSources:RequiredSource[]){
  const existingGaps=[...gaps];
  if(!/^(已完成|全部完成|核查完成|成功|completed|succeeded)$/i.test(status.trim()))return {status,gaps:existingGaps};
  const checked=new Set<string>();
  for(const entry of checkedSources){
    if(/访问受限|未完成|未核查|无法访问|无法读取|403|空列表|仅作线索|仅完成入口/.test(entry))continue;
    for(const value of entry.match(/https?:\/\/[^\s<>"'，。；、（）：]+/g)??[]){
      const url=canonicalUrl(value.replace(/[),.;]+$/,""));
      if(url)checked.add(url);
    }
  }
  const missing=requiredSources.filter(source=>!checked.has(canonicalUrl(source.url)??""));
  if(missing.length)existingGaps.push("核心栏目尚未逐项完成核查："+missing.map(s=>s.label+" "+s.url).join("；"));
  return {status:existingGaps.length?"部分完成":status,gaps:[...new Set(existingGaps)]};
}
