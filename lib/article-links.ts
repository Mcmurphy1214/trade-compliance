export function articlePath(id:string){return '/articles/'+encodeURIComponent(id)}
export function safeListReturn(value:string|undefined){
 if(!value||!value.startsWith('/')||value.startsWith('//'))return '/';
 try{const u=new URL(value,'https://site.local');if(u.origin!=='https://site.local'||u.pathname!=='/')return '/';u.searchParams.delete('article');return '/'+u.search}catch{return '/'}
}
export function articleHref(id:string,returnTo='/'){
 const back=safeListReturn(returnTo);return articlePath(id)+(back==='/'?'':'?from='+encodeURIComponent(back));
}
export function listHref(category:string,q=''){
 const p=new URLSearchParams();if(category!=='全部')p.set('category',category);if(q)p.set('q',q);return '/'+(p.size?'?'+p.toString():'');
}
