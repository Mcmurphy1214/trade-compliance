import {AsyncLocalStorage} from "node:async_hooks";

export type MonitorIdentity={userId:string;scope:string[]};
const context=new AsyncLocalStorage<MonitorIdentity>();
// This context is populated only after the OAuth provider validates a token.
// No identity or scope is accepted from browser-supplied request headers.
export const monitorIdentity=()=>context.getStore();
export const withMonitorIdentity=<T>(identity:MonitorIdentity,callback:()=>T)=>context.run(identity,callback);
