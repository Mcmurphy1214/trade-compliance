import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto,randomBytes} from 'node:crypto';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';

if(process.argv.includes('--help')){console.log('npm run admin:bootstrap -- --local | --remote\n仅空数据库可初始化。密码在终端隐蔽输入，不进入命令参数、仓库或日志。');process.exit(0);}
const local=process.argv.includes('--local'),remote=process.argv.includes('--remote');
if(local===remote)throw Error('必须明确选择 --local 或 --remote。');
if(!process.stdin.isTTY)throw Error('请在交互终端运行，以安全输入管理员密码。');
const root=fileURLToPath(new URL('../',import.meta.url)),wrangler=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const config=JSON.parse(readFileSync(join(root,'wrangler.jsonc'),'utf8'));
if(remote&&/^00000000-/.test(config.d1_databases[0].database_id))throw Error('请先填写真实 D1 database_id。');
function execute(options){
 const result=spawnSync(process.execPath,[wrangler,'d1','execute','DB',local?'--local':'--remote','--json','--yes',...options],{cwd:root,encoding:'utf8',stdio:['inherit','pipe','pipe']});
 if(result.status!==0)throw Error('数据库命令失败。请检查 Cloudflare 登录、D1 配置和迁移状态；不会保存密码。');
 const start=result.stdout.indexOf('[');if(start<0)throw Error('数据库响应格式无效。');const response=JSON.parse(result.stdout.slice(start));if(response.some(r=>r.success===false))throw Error('数据库未接受操作。');return response;
}
if(Number(execute(['--command','SELECT COUNT(*) AS n FROM workspace_users'])[0].results[0].n)!==0)throw Error('数据库已有成员，禁止用初始化工具覆盖或新增管理员。请由现有管理员在工作台管理账号。');
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const username=(await rl.question('管理员账号（3至40位英文、数字、_.-）：')).trim().toLowerCase();
const displayName=(await rl.question('显示名称：')).trim();rl.close();
if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)||!displayName||displayName.length>80)throw Error('账号或显示名称格式无效。');
async function secret(prompt){
 process.stdout.write(prompt);const hidden=new Writable({write(chunk,enc,next){next();}});
 const input=readline.createInterface({input:process.stdin,output:hidden,terminal:true});
 try{return await input.question('');}finally{input.close();process.stdout.write('\n');}
}
const password=await secret('初始密码（12至128位，输入不显示）：'),confirm=await secret('再次输入初始密码：');
if(password.length<12||password.length>128||password!==confirm)throw Error('密码长度不符或两次输入不同。');
const salt=randomBytes(32).toString('hex'),key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
const hash=Buffer.from(await webcrypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256)).toString('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'",id=webcrypto.randomUUID(),now=new Date().toISOString();
const values=[id,username,displayName,'admin',hash,salt,now,now].map(quote);
const sql='INSERT INTO workspace_users(id,username,display_name,role,password_hash,salt,disabled,must_change_password,version,last_mutation,created_at,updated_at) SELECT '+values.slice(0,6).join(',')+",0,1,1,'',"+values.slice(6).join(',')+' WHERE NOT EXISTS(SELECT 1 FROM workspace_users);';
const dir=mkdtempSync(join(tmpdir(),'compliance-bootstrap-'));
try{const file=join(dir,'bootstrap.sql');writeFileSync(file,sql,{mode:0o600});const result=execute(['--file',file]);if(result.reduce((n,r)=>n+Number(r.meta?.changes||0),0)!==1)throw Error('数据库已有成员或发生并发初始化，未创建账号。');console.log('管理员已创建。请在工作台登录并完成首次改密，再创建同事账号。');}
finally{rmSync(dir,{recursive:true,force:true});}
