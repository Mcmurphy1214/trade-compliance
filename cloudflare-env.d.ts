declare namespace Cloudflare {
 interface Env {
  DB:D1Database;
  MONITOR_API_TOKEN?:string;
  OAUTH_KV?:KVNamespace;
 }
}
