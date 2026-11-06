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
for(const phase of ['request','client','consent','login','grant'])assert(!JSON.stringify(monitorOAuthFailure({name:'Error',description:marker},phase)).includes(marker));
const root=path.resolve('dist/server'),config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.json'),'utf8'));
assert(config.kv_namespaces.some(k=>k.binding==='OAUTH_KV'&&!k.id));
const entry=path.resolve(root,config.main),files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f);else if(/\.(js|mjs)$/.test(f))files.push(f);}}walk(root);
const origin='https://tradecompliance-t.online',resource=origin+'/mcp';
const clientMetadata=JSON.parse(fs.readFileSync('scripts/fixtures/chatgpt-oauth-client.json','utf8'));
const signing=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const publicJwk={...await crypto.subtle.exportKey('jwk',signing.publicKey),kid:'test-only-cimd-key',use:'sig',alg:'RS256'};
const fetchMock=createFetchMock();fetchMock.disableNetConnect();
fetchMock.get('https://chatgpt.com').intercept({path:'/oauth/client.json'}).reply(200,JSON.stringify(clientMetadata),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=3600'}}).persist();
fetchMock.get('https://chatgpt.com').intercept({path:'/oauth/jwks.json'}).reply(200,JSON.stringify({keys:[publicJwk]}),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=3600'}}).persist();
const mf=new Miniflare({fetchMock,modules:[entry,...files.filter(f=>f!==entry)].map(f=>({type:'ESModule',path:f})),modulesRoot:root,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:['DB'],kvNamespaces:['OAUTH_KV'],assets:{directory:path.resolve(root,config.assets.directory),binding:'ASSETS',routerConfig:{invoke_user_worker_ahead_of_assets:false,has_user_worker:true}}});
const request=(p,options={})=>mf.dispatchFetch(new URL(p,origin),{redirect:'manual',...options});
const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
async function token(body){return request('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});}
async function rpc(access,name,args={}){return request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});}
try{
 const metadata=await(await request('/.well-known/oauth-authorization-server')).json();assert.equal(metadata.issuer,origin);assert.equal(metadata.client_id_metadata_document_supported,true);
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
 async function begin(q=query){const res=await request('/authorize?'+q);assert.equal(res.status,200);const html=await res.text();assert(!html.includes('<script>bad()'));assert(html.includes('&#60;script&#62;'));const handle=html.match(/name="handle" value="([^"]+)"/)[1];return {handle,cookie:cookies(res)};}
 async function approve(transaction,scopes=['monitor:read','monitor:write','offline_access'],pwd=password,extra={}){return request('/authorize',{method:'POST',headers:{Origin:origin,Cookie:transaction.cookie,'Content-Type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams([['handle',transaction.handle],['decision','approve'],['username','oauth-admin'],['password',pwd],...scopes.map(s=>['scope',s])]).toString()});}
 let transaction=await begin();assert.notEqual((await approve(transaction,undefined,password,{Cookie:''})).status,302,'Missing consent cookie must fail closed');
 transaction=await begin();assert.notEqual((await approve(transaction,undefined,password,{Origin:'https://attacker.test'})).status,302);
 transaction=await begin();assert.equal((await approve(transaction)).status,403,'First-password gate must apply to OAuth');
 const login=await request('/api/workspace',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'login',username:'oauth-admin',password})});assert.equal(login.status,200);
 const newPassword='Test-Only-Replacement-Password!';const changed=await request('/api/workspace',{method:'POST',headers:{Origin:origin,Cookie:cookies(login),'Content-Type':'application/json'},body:JSON.stringify({action:'change_password',currentPassword:password,newPassword})});assert.equal(changed.status,200);
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
 // Exercise the real ChatGPT CIMD shape (both methods, legacy JWT preference,
 // official callback) instead of testing only the unrelated DCR path.
 const cimdQuery=new URLSearchParams(query);cimdQuery.set('client_id',clientMetadata.client_id);cimdQuery.set('redirect_uri',clientMetadata.redirect_uris[0]);
 const wrongAudience=new URLSearchParams(cimdQuery);wrongAudience.set('resource',origin);
 const wrongAudienceResponse=await request('/authorize?'+wrongAudience);assert.equal(wrongAudienceResponse.status,400);assert((await wrongAudienceResponse.text()).includes('resource_mismatch'));
 const wrongCallback=new URLSearchParams(cimdQuery);wrongCallback.set('redirect_uri','https://attacker.test/secret-state-value');
 const wrongCallbackResponse=await request('/authorize?'+wrongCallback);assert.equal(wrongCallbackResponse.status,400);const wrongCallbackText=await wrongCallbackResponse.text();assert(wrongCallbackText.includes('redirect_mismatch'));assert(!wrongCallbackText.includes('secret-state-value'));
 async function cimdGrant(){
  const begun=await request('/authorize?'+cimdQuery);assert.equal(begun.status,200);const html=await begun.text();assert(html.includes('chatgpt.com'));assert(html.includes('管理员账号'));
  const consent={cookie:cookies(begun),handle:html.match(/name="handle" value="([^"]+)"/)[1]};
  const granted=await approve(consent,undefined,newPassword);assert.equal(granted.status,302);
  const location=new URL(granted.headers.get('location'));assert.equal(location.origin,'https://chatgpt.com');assert.equal(location.pathname,'/connector_platform_oauth_redirect');
  return location.searchParams.get('code');
 }
 const cimdCode=await cimdGrant(),now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const assertionBody=encode({alg:'RS256',kid:publicJwk.kid,typ:'JWT'})+'.'+encode({iss:clientMetadata.client_id,sub:clientMetadata.client_id,aud:origin+'/oauth/token',iat:now,exp:now+60,jti:crypto.randomUUID()});
 const assertionSignature=Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signing.privateKey,new TextEncoder().encode(assertionBody))).toString('base64url');
 const cimdExchanged=await token({grant_type:'authorization_code',client_id:clientMetadata.client_id,code:cimdCode,code_verifier:verifier,redirect_uri:clientMetadata.redirect_uris[0],resource,client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',client_assertion:assertionBody+'.'+assertionSignature});
 assert.equal(cimdExchanged.status,200);const cimdTokens=await cimdExchanged.json();assert(cimdTokens.access_token&&cimdTokens.refresh_token);assert.equal((await rpc(cimdTokens.access_token,'verify_monitor_connection')).status,200);
 const cimdPublicCode=await cimdGrant();const cimdPublic=await token({grant_type:'authorization_code',client_id:clientMetadata.client_id,code:cimdPublicCode,code_verifier:verifier,redirect_uri:clientMetadata.redirect_uris[0],resource});assert.equal(cimdPublic.status,200,'Plural CIMD methods must also permit public PKCE exchange');
 const activity=JSON.stringify((await db.prepare('SELECT detail FROM workspace_activity').all()).results);assert(!activity.includes(newPassword));assert(!activity.includes(tokens.access_token));
 console.log('PASS monitor OAuth: discovery, DCR and official ChatGPT CIMD with RS256/private_key_jwt and public PKCE; safe resource/redirect diagnostics; no anonymous write; admin bootstrap gate; CSRF and escaped consent; first-password gate; redirect validation; single-use consent and code; PKCE exchange; persistent non-article write proof; token refresh and audience isolation; no member/export access; account revocation; read-only scope enforcement; no passwords/tokens in audit.');
}finally{await mf.dispose();}
