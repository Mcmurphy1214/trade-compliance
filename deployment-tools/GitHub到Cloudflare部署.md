# 从 GitHub 部署到 Cloudflare Pages

## 仓库内容与权限边界

本目录就是仓库根目录：package.json、package-lock.json、app、components、lib、db、drizzle、worker、public、scripts 和 deployment-tools 同级。请上传展开后的源码文件，不要只上传一个源码 ZIP。

独立部署后，所有访客可浏览资讯列表、正文和法律法规监测；加入团队选题池、内部备注、规则、日志与导出需要管理员发放的独立账号和相应角色。账号不需要 GPT 账户。

源码仅含 56 条已有公开资讯快照，不包含旧站账号、口令、内部选题、会话、邮箱授权或数据库副本。定时采集和邮件服务没有启用，不会因为连接 GitHub 自动迁移。

## Cloudflare Pages 配置

1. 在 Cloudflare 的 Workers & Pages 创建 Pages 项目，选择 Connect to Git（连接 Git），授权并选中发布本源码的 GitHub 仓库。
2. 生产分支选择上传源码使用的分支（新仓库通常为 main）。框架预设选择 None；根目录留空（仓库根目录）。
3. 构建命令：`npm run build && npm run build:upload`。Cloudflare 默认安装依赖；锁文件必须一并上传。
4. 构建输出目录：`pages-upload`。不要填 dist、dist/client 或源码根目录。构建会将后端打包为单文件 _worker.js，与页面脚本、样式及字体一起生成。
5. 设置构建环境变量 `NODE_VERSION=24`，与仓库 .nvmrc 一致。首次构建如出现依赖安装限制，先检查 Node 版本和 npm 日志，不要只部署静态文件冒充协作工作台。
6. 设置生产运行时 compatibility date 为 `2026-05-15`，compatibility flag 加 `nodejs_compat`。如使用预览环境，单独配置预览环境。
7. 创建独立 D1 数据库，在数据库 Console 执行 deployment-tools/数据库初始化.sql。控制台需要逐条时，按 deployment-tools/SQL逐条 的数字顺序执行。
8. 在 Pages → Settings → Bindings 添加 D1 数据库，变量名必须为 `DB`，选中刚创建的数据库。预览环境需要单独绑定，建议使用测试数据库。
9. 在本地浏览器打开 deployment-tools/管理员初始化工具.html，自行设置首位管理员。将生成的 INSERT 和检查 SELECT 分别执行到 D1 Console。该工具只在空成员表创建首位管理员，不会产生通用默认账号。
10. 保存配置后重新部署。先访问 `https://你的项目名.pages.dev/api/deployment-health`：应显示 ready:true、database:ready、adminInitialized:true。
11. 打开首页确认可匿名阅读，再登录管理员、修改初始密码、创建编辑角色成员，用两个账号验证多人关注合并和各自取消关注。

第一次构建若早于 DB 绑定，看到“绑定数据库”说明页属于未完成配置；需完成绑定、建表并重新部署。仓库 wrangler.jsonc 的 D1 UUID 是 CLI 本地配置占位符；Pages 此路径使用控制台 DB 绑定，不要将旧站数据库 ID 或凭据写进源码。

Git 集成与直接上传是不同项目创建路径。若已经有拖拽创建的 Pages 项目，请先核对 Cloudflare 当前支持的切换方式；不要覆盖原公开资讯网站。可新建 Git 集成项目并使用其新地址。

## 修改与数据更新

连接成功后，向生产分支推送代码会触发 Cloudflare 构建部署。资讯写入仍走新站独立后台和数据库；不需要每次资讯更新都改代码或重新部署。

旧站的每天09:30任务、邮箱连接及发送流程不随源码移动。新站如需定时更新和邮件，需要另行授权并配置。MONITOR_API_TOKEN 仅用于后端监测接口认证，不会自动建立定时任务。

不要上传生产密码、管理员生成 SQL、.dev.vars、真实 .env、数据库导出、Cookie、访问令牌或私钥。

## 本地复现

Node.js 24+：先 npm ci，再 npm run typecheck、npm test、npm run build、npm run build:upload。最后可运行 node scripts/test-pages-upload.mjs，验证完整 Worker、D1 与权限。

部署前请查看 Cloudflare 实际构建日志；本说明不代表已经在你的 Cloudflare 账号部署成功。

## 官方参考

https://developers.cloudflare.com/pages/get-started/git-integration/
https://developers.cloudflare.com/pages/functions/advanced-mode/
https://developers.cloudflare.com/pages/functions/bindings/#d1-databases
https://developers.cloudflare.com/pages/configuration/build-image/
