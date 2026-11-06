import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare,createFetchMock} from 'miniflare';
import {monitorOAuthFailure} from '../lib/monitor-oauth-errors.ts';

const marker='sensitive-value-must-not-be-rendered';
assert.equal(monitorOAuthFailure({name:'CimdFetchError',description:marker},'request').code,'client_metadata_unavailable');
assert.equal(monitorOAuthFailure({code:'invalid_target',description:marker},'request').code,'resource_mismatch');
assert.equal(monitorOAuthFailure({code:'invalid_request',description:'Invalid redirect URI '+marker},'request').code,'redirect_mismatch');
assert.equal(monitorOAuthFailure({code:'invalid_request',description:'PKCE '+marker},'request').code,'pkce_invalid');
assert.equal(monitorOAuthFailure({},'origin').code,'origin_mismatch');
for(const phase of ['request','origin','client','consent','login','grant'])assert(!JSON.stringify(monitorOAuthFailure({name:'Error',description:marker},phase)).includes(marker));
const root=path.resolve('dist/server'),config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.json'),'utf8'));
assert(config.kv_namespaces.some(k=>k.binding==='OAUTH_KV'&&!k.id));
const entry=path.resolve(root,config.main),files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(js|mjs)$/.test(f))files.push(f);}}walk(root);
const origin='https://tradecompliance-t.online',resource=origin+'/mcp';
const clientMetadata=JSON.parse(fs.readFileSync('scripts/fixtures/chatgpt-oauth-client.json','utf8'));
// No external network is permitted: DCR must survive unavailable client metadata.
const fetchMock=createFetchMock();fetchMock.disableNetConnect();
const mf=new Miniflare({fetchMock,modules:[entry,...files.filter(f=>f!==entry)].map(f=>({type:'ESModule',path:f})),modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:['DB'],kvNamespaces:['OAUTH_KV'],assets:{directory:path.resolve(root,config.assets.directory),binding:'ASSETS',routerConfig:{invoke_user_worker_ahead_of_assets:false,has_user_worker:true}}});
const request=(p,options={})=>mf.dispatchFetch(new URL(p,origin),{redirect:'manual',...options});
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function token(body){return request('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});}
async function rpc(access,name,args={}){return request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});}
try{
 const metadata=await(await request('/.well-known/oauth-authorization-server')).json();assert.equal(metadata.issuer,origin);assert.notEqual(metadata.client_id_metadata_document_supported,true);assert.equal(metadata.registration_endpoint,origin+'/oauth/register');assert(!metadata.token_endpoint_auth_methods_supported.includes('private_key_jwt'));
 const protectedMetadata=await(await request('/.well-known/oauth-protected-resource/mcp')).json();assert.equal(protectedMetadata.resource,resource);
 const noAuth=await request('/mcp');assert.equal(noAuth.status,401);assert(noAuth.headers.get('www-authenticate').includes('resource_metadata'));
 const registered=await request('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'ChatGPT <script>bad()</script>',redirect_uris:['https://chatgpt.com/oauth/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(registered.status,201);
 const client=await registered.json();assert(client.client_id);
 const verifier='Test-only-PKCE-verifier-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)),challenge=Buffer.from(digest).toString('base64url');
 const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://chatgpt.com/oauth/callback',response_type:'code',resource,scope:'monitor:read monitor:write offline_access',state:'test-only-state',code_challenge:challenge,code_challenge_method:'S256'});
 const empty=await request('/authorize?'+query);assert.equal(empty.status,409);
 const db=await mf.getD1Database('DB'),password='Test-Only-Original-Password!',salt='test-only-oauth-salt',key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const hash=Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)).toString('hex');
 await db.prepare("INSERT INTO workspace_users(id,username,display_name,role,password_hash,salt,must_change_password,created_at,updated_at) VALUES('oauth-admin','oauth-admin','Test Admin','admin',?,?,1,'now','now')").bind(hash,salt).run();
 async function begin(q=query,existingCookie=''){const res=await request('/authorize?'+q,{headers:{Cookie:existingCookie}});assert.equal(res.status,200);const html=await res.text();assert(!html.includes('<script>bad()'));assert(html.includes('&#60;script&#62;'));const handle=html.match(/name="handle" value="([^"]+)"/)[1];return {handle,cookie:[existingCookie,cookies(res)].filter(Boolean).join('; '),referrerPolicy:res.headers.get('referrer-policy'),setCookies:res.headers.getSetCookie(),html};}
 async function approve(transaction,scopes=['monitor:read','monitor:write','offline_access'],pwd=password,extra={}){return request('/authorize',{method:'POST',headers:{Origin:origin,Cookie:transaction.cookie,'Content-Type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams([['handle',transaction.handle],['decision','approve'],['username','oauth-admin'],['password',pwd],...scopes.map(s=>['scope',s])]).toString()});}
 let transaction=await begin();const noCookie=await approve(transaction,undefined,password,{Cookie:''});assert.equal(noCookie.status,400);assert((await noCookie.text()).includes('consent_cookie_missing'),'Missing consent cookie must fail closed with a precise diagnosis');
 transaction=await begin();assert.notEqual((await approve(transaction,undefined,password,{Origin:'https://attacker.test'})).status,302);
 // Fetch §3.2: non-CORS form POSTs under no-referrer serialize Origin as
 // null. Keep refusing it; fix the page policy rather than bypassing CSRF.
 transaction=await begin();const nullOrigin=await approve(transaction,undefined,password,{Origin:'null'});assert.equal(nullOrigin.status,400);assert((await nullOrigin.text()).includes('origin_mismatch'));
 transaction=await begin();assert.equal(transaction.referrerPolicy,'strict-origin','Only the origin, never the authorization query, may be sent as Referer');
 const formOrigin=transaction.referrerPolicy==='no-referrer'?'null':origin;
 const denied=await request('/authorize',{method:'POST',headers:{Origin:formOrigin,Cookie:transaction.cookie,'Content-Type':'application/x-www-form-urlencoded','Sec-Fetch-Site':'same-origin'},body:new URLSearchParams({handle:transaction.handle,decision:'deny'}).toString()});
 assert.equal(denied.status,302,'Real browser form denial must reach consent validation');assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'access_denied');
 transaction=await begin();assert.equal((await approve(transaction,undefined,password,{'Sec-Fetch-Site':'cross-site'})).status,400,'Cross-site submissions remain forbidden even with a forged Origin');
 transaction=await begin();assert.equal((await approve(transaction)).status,403,'First-password gate must apply to OAuth');
 const login=await request('/api/workspace',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username:'oauth-admin',password})});assert.equal(login.status,200);
 const newPassword='Test-Only-Replacement-Password!';const changed=await request('/api/workspace',{method:'POST',headers:{Origin:origin,Cookie:cookies(login),'Content-Type':'application/json'},body:JSON.stringify({action:'change_password',currentPassword:password,newPassword})});assert.equal(changed.status,200);
 const signedInLogin=await request('/api/workspace',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username:'oauth-admin',password:newPassword})});assert.equal(signedInLogin.status,200);
 const adminCookie=cookies(signedInLogin);assert(adminCookie.includes('__Host-compliance_session='));
 // Reproduce the owner's already-signed-in screen. It must need only the
 // existing workspace session, not an additional consent cookie.
 transaction=await begin(query,adminCookie);assert(transaction.html.includes('使用当前工作台管理员身份授权'));assert(!transaction.html.includes('name="password"'));assert.equal(transaction.setCookies.length,0);
 const signedInGrant=await approve(transaction,undefined,'');assert.equal(signedInGrant.status,302);
 // State is encrypted in D1 and independent of KV transaction propagation.
 const storedConsent=await begin(query,adminCookie),idOf=async h=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(h))).toString('hex');
 const stored=await db.prepare('SELECT * FROM oauth_consents WHERE id=?').bind(await idOf(storedConsent.handle)).first();assert.equal(stored.binding_mode,'session');assert(!stored.payload.includes('test-only-state'));assert(!JSON.stringify(stored).includes(storedConsent.handle));assert(!JSON.stringify(stored).includes(adminCookie.split('=')[1]));
 const kv=await mf.getKVNamespace('OAUTH_KV');assert.equal((await kv.list({prefix:'transaction:'})).keys.length,0);
 const wrongBrowser=await approve(storedConsent,undefined,'',{Cookie:'__Host-compliance_session='+'0'.repeat(64)});assert.equal(wrongBrowser.status,400);assert((await wrongBrowser.text()).includes('consent_session_changed'));
 assert.equal((await approve(storedConsent,undefined,'')).status,302,'A mismatched browser must not consume the real browser transaction');
 const expired=await begin(query,adminCookie);await db.prepare('UPDATE oauth_consents SET expires_at=0 WHERE id=?').bind(await idOf(expired.handle)).run();const expiredResult=await approve(expired,undefined,'');assert.equal(expiredResult.status,400);assert((await expiredResult.text()).includes('consent_expired_or_used'));
 const corrupt=await begin(query,adminCookie);await db.prepare("UPDATE oauth_consents SET payload='invalid.test' WHERE id=?").bind(await idOf(corrupt.handle)).run();const corruptResult=await approve(corrupt,undefined,'');assert.equal(corruptResult.status,400);assert((await corruptResult.text()).includes('consent_storage_invalid'));
 const parallel=await begin(query,adminCookie),parallelResults=await Promise.all([approve(parallel,undefined,''),approve(parallel,undefined,'')]);assert.deepEqual(parallelResults.map(r=>r.status).sort(),[302,400],'Atomic consume must permit exactly one parallel submission');
 const badRedirect=new URLSearchParams(query);badRedirect.set('redirect_uri','https://attacker.test/callback');const invalid=await request('/authorize?'+badRedirect);assert.equal(invalid.status,400);assert.equal(invalid.headers.get('location'),null);
 transaction=await begin();const approved=await approve(transaction,undefined,newPassword);assert.equal(approved.status,302);const callback=new URL(approved.headers.get('location'));assert.equal(callback.origin,'https://chatgpt.com');assert.equal(callback.searchParams.get('state'),'test-only-state');assert.equal(callback.searchParams.get('iss'),origin);const code=callback.searchParams.get('code');assert(code);
 assert.notEqual((await approve(transaction,undefined,newPassword)).status,302,'Consent handle must be single use');
 const wrongVerifier=await token({grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:'Invalid-test-only-PKCE-verifier-000000000000000000',redirect_uri:'https://chatgpt.com/oauth/callback',resource});assert.equal(wrongVerifier.status,400);
 const exchanged=await token({grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:'https://chatgpt.com/oauth/callback',resource});assert.equal(exchanged.status,200);let tokens=await exchanged.json();assert(tokens.access_token&&tokens.refresh_token);
 const init=await request('/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-06-18'}})});assert.equal(init.status,200);assert.equal((await init.json()).result.protocolVersion,'2025-06-18');
 let verified=await rpc(tokens.access_token,'verify_monitor_connection');assert.equal(verified.status,200);const proof=JSON.parse((await verified.json()).result.content[0].text);assert.equal(proof.writeVerified,true);assert.equal(proof.readbackVerified,true);assert.equal(proof.articlesChanged,0);assert.equal(proof.site,origin);
 assert(await db.prepare("SELECT payload FROM monitor_source_state WHERE id='runtime:monitor-connection-check'").first());assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM articles').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM monitor_runs').first()).n,0);
 const team=await request('/api/workspace',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'create_member',username:'forbidden',displayName:'x',role:'admin'})});assert.equal(team.status,401);
 const internal=await(await request('/api/workspace',{headers:{Authorization:'Bearer '+tokens.access_token}})).json();assert.equal(internal.user,null);assert.deepEqual(internal.members,[]);
 const snapshot=await request('/api/workspace?snapshot=x&format=xlsx',{headers:{Authorization:'Bearer '+tokens.access_token}});assert.equal(snapshot.status,401);
 const wrongResource=await token({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:'https://attacker.test/mcp'});assert.equal(wrongResource.status,400);
 const refreshed=await token({grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource});assert.equal(refreshed.status,200);tokens=await refreshed.json();assert.equal((await rpc(tokens.access_token,'verify_monitor_connection')).status,200);
 await db.prepare("UPDATE workspace_users SET disabled=1,version=version+1 WHERE id='oauth-admin'").run();assert.equal((await rpc(tokens.access_token,'verify_monitor_connection')).status,401,'Account disable/version change must invalidate OAuth immediately');
 const replay=await token({grant_type:'authorization_code',client_id:client.client_id,code,code_verifier:verifier,redirect_uri:'https://chatgpt.com/oauth/callback',resource});assert.equal(replay.status,400);
 await db.prepare("UPDATE workspace_users SET disabled=0,version=version+1 WHERE id='oauth-admin'").run();transaction=await begin();const readGrant=await approve(transaction,['monitor:read'],newPassword);assert.equal(readGrant.status,302);const readCode=new URL(readGrant.headers.get('location')).searchParams.get('code');
 const readTokenResponse=await token({grant_type:'authorization_code',client_id:client.client_id,code:readCode,code_verifier:verifier,redirect_uri:'https://chatgpt.com/oauth/callback',resource});assert.equal(readTokenResponse.status,200);const readToken=await readTokenResponse.json();assert(!readToken.refresh_token,'No offline consent must mean no refresh token');assert.equal((await rpc(readToken.access_token,'verify_monitor_connection')).status,403,'Read-only OAuth cannot write');
 // Cached CIMD requests get a precise migration instruction, with no fetch to
 // ChatGPT and no weakening of authentication or callback checks.
 const staleCimd=new URLSearchParams(query);staleCimd.set('client_id',clientMetadata.client_id);staleCimd.set('redirect_uri',clientMetadata.redirect_uris[0]);
 const staleResponse=await request('/authorize?'+staleCimd);assert.equal(staleResponse.status,400);const staleText=await staleResponse.text();assert(staleText.includes('client_registration_required'));assert(staleText.includes('DCR'));
 const wrongAudience=new URLSearchParams(query);wrongAudience.set('resource',origin);
 const wrongAudienceResponse=await request('/authorize?'+wrongAudience);assert.equal(wrongAudienceResponse.status,400);assert((await wrongAudienceResponse.text()).includes('resource_mismatch'));
 // Also cover the confidential DCR exchange ChatGPT may select, with its actual
 // callback and a client secret kept only in test memory.
 const confidentialRegistered=await request('/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'ChatGPT DCR',redirect_uris:clientMetadata.redirect_uris,token_endpoint_auth_method:'client_secret_post',grant_types:['authorization_code','refresh_token'],response_types:['code']})});assert.equal(confidentialRegistered.status,201);
 const confidential=await confidentialRegistered.json();assert(confidential.client_id&&confidential.client_secret);
 const confidentialQuery=new URLSearchParams(query);confidentialQuery.set('client_id',confidential.client_id);confidentialQuery.set('redirect_uri',clientMetadata.redirect_uris[0]);
 const begun=await request('/authorize?'+confidentialQuery);assert.equal(begun.status,200);const html=await begun.text();assert(html.includes('chatgpt.com'));
 const confidentialConsent={cookie:cookies(begun),handle:html.match(/name="handle" value="([^"]+)"/)[1]};
 const confidentialGrant=await approve(confidentialConsent,undefined,newPassword);assert.equal(confidentialGrant.status,302);const confidentialCode=new URL(confidentialGrant.headers.get('location')).searchParams.get('code');
 const tokenArgs={grant_type:'authorization_code',client_id:confidential.client_id,code:confidentialCode,code_verifier:verifier,redirect_uri:clientMetadata.redirect_uris[0],resource};
 assert.equal((await token({...tokenArgs,client_secret:'incorrect-test-only-secret'})).status,401);
 const confidentialExchanged=await token({...tokenArgs,client_secret:confidential.client_secret});assert.equal(confidentialExchanged.status,200);const confidentialTokens=await confidentialExchanged.json();assert(confidentialTokens.access_token&&confidentialTokens.refresh_token);
 assert.equal((await rpc(confidentialTokens.access_token,'verify_monitor_connection')).status,200);
 const confidentialRefresh=await token({grant_type:'refresh_token',client_id:confidential.client_id,client_secret:confidential.client_secret,refresh_token:confidentialTokens.refresh_token,resource});assert.equal(confidentialRefresh.status,200);
 const activity=JSON.stringify((await db.prepare('SELECT detail FROM workspace_activity').all()).results);assert(!activity.includes(newPassword));assert(!activity.includes(tokens.access_token));
 console.log('PASS monitor OAuth: encrypted D1 consent without KV transaction dependency; existing-session and anonymous cookie bindings; missing cookie/session mismatch/expiry/corruption diagnostics; atomic parallel replay prevention; DCR-only discovery; public PKCE and confidential DCR plus refresh; stale CIMD instructions; strict form origins; admin and first-password gates; escaped consent; redirect/audience validation; persistent non-article write proof; no member/export access; account revocation; read-only scope; no passwords/tokens in audit.');
}finally{await mf.dispose();}
