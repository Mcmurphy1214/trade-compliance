import type {AuthRequest} from '@cloudflare/workers-oauth-provider';
import {constantEqual,digest,randomToken,sessionToken} from './workspace-auth';

const TTL=600;
type ConsentRow={id:string;binding_mode:string;binding_hash:string;payload:string;expires_at:number};
export class MonitorConsentError extends Error {
 constructor(readonly code:'consent_handle_invalid'|'consent_cookie_missing'|'consent_session_changed'|'consent_expired_or_used'|'consent_storage_invalid'){super(code);this.name='MonitorConsentError';}
}
const cookieName=(id:string)=>`__Host-compliance-consent-${id.slice(0,16)}`;
const cookie=(id:string,value:string,maxAge=TTL)=>`${cookieName(id)}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
function readCookie(request:Request,name:string){return (request.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const decode=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(handle:string){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('workbench-consent:v1:'+handle)),'AES-GCM',false,['encrypt','decrypt']);}

// Keep only an encrypted, previously validated request and hashes in D1.
// Its primary executes these queries; no eventually-consistent KV lookup is
// involved. Existing signed-in admins bind to their already working session.
export async function beginMonitorConsent(db:D1Database,request:Request,auth:AuthRequest,signedIn:boolean){
 const handle=randomToken(),id=await digest(handle),session=signedIn?sessionToken(request):null;
 const mode=session?'session':'cookie',secret=session??randomToken();
 const bindingHash=await digest(mode+':'+secret),iv=crypto.getRandomValues(new Uint8Array(12));
 const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(handle),new TextEncoder().encode(JSON.stringify(auth)));
 const payload=encode(iv)+'.'+encode(new Uint8Array(sealed)),now=Math.floor(Date.now()/1000);
 await db.batch([
  db.prepare('DELETE FROM oauth_consents WHERE expires_at<=?').bind(now),
  db.prepare('INSERT INTO oauth_consents(id,binding_mode,binding_hash,payload,expires_at) VALUES(?,?,?,?,?)').bind(id,mode,bindingHash,payload,now+TTL)
 ]);
 const headers=new Headers({'Cache-Control':'no-store'});
 if(mode==='cookie')headers.append('Set-Cookie',cookie(id,secret));
 return {handle,headers};
}

export async function consumeMonitorConsent(db:D1Database,request:Request,handle:string){
 if(!/^[a-f0-9]{64}$/.test(handle))throw new MonitorConsentError('consent_handle_invalid');
 const id=await digest(handle),now=Math.floor(Date.now()/1000);
 const row=await db.prepare('SELECT * FROM oauth_consents WHERE id=? AND expires_at>?').bind(id,now).first<ConsentRow>();
 if(!row)throw new MonitorConsentError('consent_expired_or_used');
 const secret=row.binding_mode==='session'?sessionToken(request):readCookie(request,cookieName(id));
 if(!secret)throw new MonitorConsentError(row.binding_mode==='session'?'consent_session_changed':'consent_cookie_missing');
 if(!constantEqual(await digest(row.binding_mode+':'+secret),row.binding_hash))throw new MonitorConsentError('consent_session_changed');
 // A single SQL statement takes the record. Parallel submits cannot both win;
 // never implement this as separate SELECT then DELETE operations.
 const taken=await db.prepare('DELETE FROM oauth_consents WHERE id=? AND binding_hash=? AND expires_at>? RETURNING payload').bind(id,row.binding_hash,now).first<{payload:string}>();
 if(!taken)throw new MonitorConsentError('consent_expired_or_used');
 let auth:AuthRequest;
 try{
  const [iv,sealed]=taken.payload.split('.');
  auth=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await key(handle),decode(sealed))));
 }catch{throw new MonitorConsentError('consent_storage_invalid');}
 const headers=new Headers({'Cache-Control':'no-store'});
 if(row.binding_mode==='cookie')headers.append('Set-Cookie',cookie(id,'',0));
 return {request:auth,headers};
}
