import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
if(args.includes('--help')){console.log('node scripts/configure-cloudflare.mjs --database-id UUID [--worker-name name] [--database-name name]');process.exit(0);}
const id=args.includes('--database-id')?get('--database-id'):'';
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||/^00000000-/.test(id))throw Error('请提供 Cloudflare 创建 D1 数据库后返回的真实 database_id。');
const file=fileURLToPath(new URL('../wrangler.jsonc',import.meta.url)),config=JSON.parse(fs.readFileSync(file,'utf8'));
config.d1_databases[0].database_id=id;
if(args.includes('--worker-name')){const name=get('--worker-name');if(!/^[a-z][a-z0-9-]{0,62}$/.test(name))throw Error('Worker 名称格式无效。');config.name=name;}
if(args.includes('--database-name')){const name=get('--database-name');if(!/^[A-Za-z0-9_-]{1,64}$/.test(name))throw Error('数据库名称格式无效。');config.d1_databases[0].database_name=name;}
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');console.log('Cloudflare 配置已保存。接下来应用 D1 迁移并初始化管理员。');
