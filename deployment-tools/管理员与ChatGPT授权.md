# 管理员初始化与 ChatGPT 自动更新授权

目标实例：https://tradecompliance-t.online/

用户最新要求：站点所有者希望使用其 GPT 账号作为管理员，同事使用独立账密。下述 OAuth 是“ChatGPT访问网站”的授权，不等于“网站使用GPT账号登录”。后者需 OpenAI 为本域名签发的 Sign in with ChatGPT 客户端及注册回调，目前尚未配置。不得把同邮箱独立账号或首个访问者冒充已验证 GPT 管理员；在用户明确选择前，不替代创建普通管理员。

## 当前验收边界

代码支持 OAuth 授权、令牌刷新、权限分离和非资讯写入验收；这不代表管理员已创建、ChatGPT 已连接或每日任务已运行。必须按以下顺序完成。

## 1. 等待 Cloudflare 部署最新 main

保持 Workers 构建 npm run build、部署 npx wrangler deploy。新增的 OAUTH_KV 由 Wrangler 自动创建/复用，D1 仍使用 DB。若构建身份没有 KV 权限，需要站点所有者在 Cloudflare 授权或绑定 OAUTH_KV；不要把密钥写入 GitHub。

检查 /api/deployment-health 的 database=ready 与 oauthConfigured=true。oauthConfigured 仅说明后端授权存储可用，不证明某个 ChatGPT 账号已经授权。

## 2. 初始化首位管理员（需要数据库所有者操作）

打开 https://tradecompliance-t.online/setup-admin.html 。此工具只在浏览器本地计算密码哈希与生成 SQL，不会把密码或 SQL 发给网站后台。自行填写管理员账号、名称和至少12位初始密码。

在 Cloudflare 控制台打开这个 Worker 的 DB 绑定所对应 D1 数据库的 Console，执行页面生成的 INSERT，再单独执行检查 SELECT。只有成员表为空时才会创建首位管理员，重复执行不会覆盖已有账号。

生成的 SQL 含密码哈希，不能发到聊天、提交仓库或放入公共网站。这里的代码只是通用生成工具，仓库不保存生成结果和实际账号。

在工作台用新账号登录并完成首次改密。再进入“成员与账号”为同事创建管理员、编辑或只读账号；编辑可加入选题池，无需 GPT 账户。

## 3. 将新站连接到 ChatGPT

ChatGPT 网页 → Plugins → 加号 → Add custom MCP server（添加自定义MCP服务器）。界面权限以当前账号实际提供为准。

- 名称：合规前沿 Cloudflare工作台
- Server URL：https://tradecompliance-t.online/mcp
- Authentication：OAuth
- 客户端注册：动态客户端注册（DCR）；不用自行填写服务令牌或客户端秘密。本站已停用 CIMD 发现，避开生产连接中 `client_metadata_unavailable` 的客户端资料解析失败。

已创建的插件若仍使用 CIMD，请进入现有插件的配置，将客户端注册方式改为 DCR，刷新配置后重新连接。旧的 `client_id=https://chatgpt.com/oauth/client.json` 授权链接不能继续使用，会显示 `client_registration_required`。若当前界面不支持编辑注册方式，使用同一服务器地址重新创建 OAuth 插件即可，本站发现信息只提供 DCR。

创建并安装后发起连接。浏览器将打开本站 /authorize 页面；使用完成改密的管理员账号登录，核对应用发布域名与授权回调域名，明确同意公开资讯读取、资讯更新及保持连接这三项权限。

密码只在本站 HTTPS 授权页面输入，不发给 ChatGPT。访问与刷新令牌由授权库和客户端管理；数据库不保存明文密码。即使有自动更新令牌，也不能用它创建成员、读取团队选题或下载团队导出。

如果当前账号没有添加自定义 MCP 的入口，需要先解决平台权限；不能改成 No authentication 公开写接口。

授权页使用 `Referrer-Policy: strict-origin`：不把授权 URL 的查询参数放入 Referer，同时保留浏览器表单 POST 的真实 Origin。不要改为 `no-referrer`，否则普通 HTML 表单会提交 `Origin: null` 并被来源校验拒绝。修复部署后应从插件重新发起授权，旧页面仍可能沿用旧策略；无需再次创建插件。来源不匹配会显示 `origin_mismatch`，不得通过允许 null Origin 或取消来源校验解决。

授权表单 CSP 的 `form-action` 必须同时允许本站和本次已验证、已注册回调的 origin。Chromium 会检查表单提交后的跨站重定向；仅写 `'self'` 会在后台已经签发授权码后阻止跳回 ChatGPT，用户再次提交才看到凭据已使用。允许的回调必须来自 `parseAuthRequest` 的验证结果，不得直接使用未验证的查询参数、通配符或删除 CSP。浏览器验收必须使用真实 ChatGPT 回调；只测试本站回调不能覆盖这类故障。诊断用拒绝流程可验证跨站跳转，不创建真实管理员授权。

短期同意凭据存入 D1 的 `oauth_consents`，不再依赖 KV 的即时读写。数据库只保留随机句柄的哈希、会话/浏览器绑定的哈希及 AES-GCM 加密的已验证请求，10分钟失效。已登录的管理员直接绑定当前工作台会话，不要求额外同意 Cookie；未登录时仍要求独立的 Secure/HttpOnly/SameSite Cookie。提交用一条 `DELETE ... RETURNING` 原子消费，重复或并发提交只有一次成功；之后由官方 OAuth 库重新验证客户端、精确回调、资源和 PKCE，再签发授权码。客户端注册、授权码与令牌仍由该库使用 OAUTH_KV 管理。

`consent_cookie_missing` 表示未登录浏览器丢失安全 Cookie；`consent_session_changed` 表示会话变更；`consent_expired_or_used` 表示超过10分钟或已提交；`consent_storage_invalid` 表示加密数据无法校验。不要索取 Cookie、句柄、密码或完整授权 URL。发布后须关闭旧页面，从现有插件重新发起连接。仅有表单测试或本地令牌测试不能证明用户的实际连接已完成。

## 4. 真实写入验收

在启用了新插件的会话调用 verify_monitor_connection。必须同时返回：

- writeVerified: true
- readbackVerified: true
- site: https://tradecompliance-t.online
- articlesChanged: 0

该工具只在 monitor_source_state 写入专用连接检查元数据并读回，不新增虚构资讯、不修改已有监测窗口。失败时停止，不得改用原 Sites 的同名写入工具。

## 5. 启用每天09:00任务

写入验收通过后，启用已配置的新站任务，时区 Asia/Shanghai，截止点09:00。原工作台任务可改目标，避免同时运行两个相同任务；其他已暂停任务不自动恢复。

每日只调用新站数据接口，按配置核查官方原文、去重写入、逐条读回、记录真实窗口及缺口；不需要每天提交 GitHub 或重新部署。仅在新增/修订及记录保存、读回全部有证据时才报告成功。任务保存与启用都不代表本轮资讯已更新。

目前不启用邮件。任何采集缺口、公众号工具不可用或身份失败都必须如实记录，不把旧数据当作当日新增。

## 撤销与有效期

授权只对应具体管理员账号。停用账号、重置或修改密码会使其旧 OAuth 授权失效，需要重新连接。访问令牌1小时，刷新授权30天闲置有效期，持续成功刷新可延长；平台也可能要求重新授权。

授权使用官方 Cloudflare OAuth Provider 1.2.4 处理请求校验、授权码和令牌；本站使用 D1 原子消费的会话/浏览器绑定同意页。保留 PKCE、受众和范围检查；未开放匿名写入或管理员自注册。

## 官方参考

https://developers.openai.com/api/docs/guides/custom-mcp-server
https://developers.openai.com/plugins/build/auth
https://github.com/cloudflare/workers-oauth-provider
