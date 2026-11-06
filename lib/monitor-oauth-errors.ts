// Only fixed, reviewed messages leave the server. Never render the request URL,
// state, code, challenge, submitted credentials or arbitrary exception text.
export function monitorOAuthFailure(error:{name?:string;code?:string;description?:string},phase:string){
 if(phase==='origin')return {code:'origin_mismatch',message:'浏览器提交的来源与本站不匹配。请关闭旧授权页面，从 ChatGPT 插件重新发起连接。'};
 if(error.name==='CimdFetchError')return {code:'client_metadata_unavailable',message:'暂时无法读取或校验 ChatGPT 客户端资料。请从 ChatGPT 插件重新发起连接；若持续失败，可在插件配置中改用动态客户端注册（DCR）。'};
 if(error.code==='invalid_target')return {code:'resource_mismatch',message:'授权请求的资源地址与本站不匹配。请核对插件的服务器地址为 https://tradecompliance-t.online/mcp，再重新连接。'};
 if(error.code==='invalid_scope')return {code:'scope_mismatch',message:'请求的权限与本站支持的权限不匹配。请刷新插件工具后重新连接。'};
 if(error.code==='invalid_request'){
  if(/redirect URI/i.test(error.description??''))return {code:'redirect_mismatch',message:'授权回调地址与 ChatGPT 客户端登记信息不匹配。请在 ChatGPT 插件中重新发起连接，不要手动修改授权地址。'};
  if(/PKCE|code_challenge/i.test(error.description??''))return {code:'pkce_invalid',message:'授权请求缺少有效的 PKCE 校验参数。请从 ChatGPT 插件重新发起连接。'};
  if(phase==='request')return {code:'request_invalid',message:'授权请求缺少有效参数或客户端信息。请从 ChatGPT 插件重新发起连接。'};
  return {code:'consent_invalid',message:'本次授权凭据已失效、已使用或未能与当前浏览器匹配。请从 ChatGPT 插件重新发起连接。'};
 }
 if(phase==='login')return {code:'admin_login_failed',message:'管理员登录未完成。请核对账号和密码后，从 ChatGPT 插件重新发起连接。'};
 return {code:'authorization_unavailable',message:'授权服务暂时无法完成本次请求。请稍后从 ChatGPT 插件重新发起连接。'};
}
