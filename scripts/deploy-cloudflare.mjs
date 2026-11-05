import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const configured=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
// An omitted database_id enables Wrangler's supported automatic provisioning.
// A fake ID, however, disables provisioning and causes Cloudflare error 10181.
if(configured.d1_databases.some(d=>d.database_id&&(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.database_id)||/^00000000-/.test(d.database_id))))throw Error('D1 database_id 无效。首次自动创建请省略此字段；使用已有数据库时填写真实 UUID。');
const file=new URL('../dist/server/wrangler.json',import.meta.url);
if(!existsSync(file))throw Error('缺少构建产物，请先运行 npm run build。');
const built=JSON.parse(readFileSync(file,'utf8'));
if(built.name!==configured.name||JSON.stringify(built.d1_databases)!==JSON.stringify(configured.d1_databases))throw Error('构建产物与数据库或 Worker 名称配置不一致，请重新运行 npm run build。');
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'deploy','--config',fileURLToPath(file)],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;process.exit(result.status??1);
