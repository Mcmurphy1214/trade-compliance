# Cloudflare 拖拽部署说明

## 你会得到什么

这是完整的动态工作台：独立账号、多人选题、规则、日志以及 Excel/Word/PDF 导出均由后端和 D1 数据库支持。不是只能观看的静态截图。不需要 GitHub，也不需要本地编译。

请保留两个文件：正式工作台上传.zip、部署准备包.zip。先解压部署准备包，按以下顺序操作。原公开网站与原工作台无需修改。

## 1. 创建 Pages 项目

登录 Cloudflare 控制台，进入 Workers & Pages → 创建应用 → Pages → 直接上传（Direct Upload / Drag and drop）。注意选择 Pages 的直接上传入口，而不是仅接受一个 Worker 脚本的编辑器。

上传准备包内的 `01-创建Pages项目.zip`，填写新项目名并部署。此时只显示部署说明页，不是正式工作台。保存新项目的 https://项目名.pages.dev 地址。

## 2. 设置运行兼容性

打开刚创建的 Pages 项目 → 设置（Settings）→ Functions / Runtime（运行时），将生产环境的 compatibility date 设为 **2026-05-15**，添加兼容标志 **nodejs_compat**。若还需要预览环境，也在预览环境进行同样设置。

控制台菜单名称可能略有变化，请查找 Compatibility date / Compatibility flags。

## 3. 创建数据库并初始化表

进入 Cloudflare 的 Storage & databases → D1 SQL Database → 创建数据库，可命名 trade-compliance-workbench。

打开该数据库的 Console（控制台），复制 `数据库初始化.sql` 的内容并执行。若控制台要求每次执行一条，请依次打开 `SQL逐条/` 中按数字排序的文件，逐条复制执行。建表与索引使用 IF NOT EXISTS，可安全重跑；不要粘贴 Markdown 代码围栏。

本步骤只建表，不复制旧站数据库，也不创建默认管理员。

## 4. 离线创建管理员

在自己的电脑上用最新版 Edge 或 Chrome 双击打开 `管理员初始化工具.html`。它在本地使用 Web Crypto 生成口令哈希，不发送网络请求。

填写账号、显示名和至少 12 位的初始密码。生成 SQL 后，将管理员 INSERT 语句复制到刚才 D1 的 Console 执行，再单独执行末尾的 SELECT 检查语句。它只允许在没有任何成员的数据库中创建首位管理员；再次执行不会重复创建账号。

首次登录正式工作台后必须更改初始密码。后续成员在工作台“成员与账号”创建。不需要 GPT 账号。妥善保管管理员口令；初始化 SQL 不要放进正式上传包或发给同事。

## 5. 绑定数据库

回到 Pages 项目 → Settings → Bindings → Add → D1 database。变量名必须填写 **DB**（大写），选中步骤 3 的数据库，并保存。请为生产环境设置；预览环境如需使用，也必须单独绑定。

绑定和兼容配置需要新部署才会生效。

## 6. 上传正式工作台

在这个 Pages 项目创建新的生产部署，直接拖入 `正式工作台上传.zip`。

ZIP 根目录必须直接包含 `_worker.js`、`_routes.json`、`_next/`、`fonts/` 等文件；不要先套一层文件夹。本包已按此结构整理。不要把“部署准备包.zip”当作正式站点上传。

完整解压目录也可拖拽上传；建议直接用提供的 ZIP。上传完成后打开刚才的 pages.dev 地址。

## 7. 验收并分享

先访问 https://你的项目名.pages.dev/api/deployment-health 。应返回 ready: true、database: ready、adminInitialized: true。若缺少 DB 或表结构，接口会明确报错；不要把只有静态说明页当成部署成功。

用步骤 4 的独立账号登录，更改密码，创建同事账号。建议用两个不同账号验证共同选题、各自取消关注和导出，再分享正式网址。

部署包保留当前 56 条公开资讯快照，迁移截止记录是 2026-11-05 14:11（北京时间）。本次没有重新抓取核查信源。旧站账号、口令、内部选题及备注未打包。

## 后续更新与定时任务

本次仅整理文件，尚未替你在 Cloudflare 账号执行部署。新站独立运行，不会自动跟随原站的代码或数据更新。

每日采集、09:30 简报生成与 10:00 邮件发送需要另行配置；旧站的邮箱授权、GPT 连接、定时任务不会迁移。可选 MONITOR_API_TOKEN 只能保护 MCP 监测接口，设置它不代表已有定时执行器。请不要将任何凭据放到公开上传包中。

准备包的 `源码/` 保留以后修改和重新编译需要的代码及锁文件；无需上传源码目录到 Pages。Node.js 24 环境可按照源码 README 运行构建和测试。

## 已做的验证与边界

已在本地 Cloudflare 兼容运行时验证实际打包的单文件 Worker、D1 建表、离线管理员生成与登录、首次改密、角色隔离、多人合并、Excel 六列导出、PDF 快照读取，以及页面、脚本和字体资源可访问。没有登录你的 Cloudflare 控制台，未验证真实域名、账号额度或线上邮件送达。

## 官方说明

直接上传（包含 _worker.js 的高级模式 ZIP 可拖拽）：
https://developers.cloudflare.com/pages/get-started/direct-upload/

Pages 高级模式：
https://developers.cloudflare.com/pages/functions/advanced-mode/

Pages D1 绑定（修改后需要重新部署）：
https://developers.cloudflare.com/pages/functions/bindings/#d1-databases

Node.js 兼容配置：
https://developers.cloudflare.com/workers/runtime-apis/nodejs/
