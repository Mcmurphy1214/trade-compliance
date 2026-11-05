# 从 GitHub 部署到 Cloudflare

## 先确认你使用的是 Workers 还是 Pages

2026-11-05 的失败日志执行了 `npm run build` 与 `npx wrangler deploy`，因此这是 **Workers Builds**，不是 Pages。日志里的 Vite 编译已成功，报错来自部署阶段：D1 的 database_id 仍是占位 UUID，导致 Cloudflare 返回 10181；Worker 名称也与控制台项目不一致。

仓库已经按当前 Workers 项目修复。不要继续把 Pages 的输出目录设置套用到 Workers。

## A. 当前项目：Workers + GitHub（推荐继续使用）

| 设置 | 内容 |
| --- | --- |
| GitHub 仓库 | Mcmurphy1214/trade-compliance |
| 生产分支 | main |
| Worker 名称 | trade-compliance |
| 根目录 | 仓库根目录 |
| 构建命令 | npm run build |
| 部署命令 | npx wrangler deploy |
| Node 版本 | 24（.nvmrc 已提供） |
| D1 绑定名 | DB |
| 默认 D1 名称 | trade-compliance-workbench |

获取最新 main 提交后，重新运行一次生产构建即可。Wrangler 会使用 Vite 生成的 dist/server/wrangler.json，上传后端和 dist/client 静态资源。不要将输出目录手动改成 Pages 的 pages-upload。

### 数据库怎样创建与复用

wrangler.jsonc 中省略 database_id，使用固定的 database_name。Wrangler 4.92 支持自动配置：优先使用已有同名数据库或当前 Worker 的匹配 DB 绑定；没有时创建数据库并绑定。后续重新部署不会因为 GitHub 未记录 UUID 而每次新建数据库。

CI 自动创建的资源 ID 保存在 Cloudflare 控制台，不会自动写回 GitHub。不要再填 00000000-0000-4000-8000-000000000000；任何虚构 ID 都会关闭自动创建路径并再次触发 10181。

部署身份仍必须有访问/创建 D1 的实际权限。若下一次日志明确报 403 或 D1 权限不足，需要在 Cloudflare 项目的构建部署令牌中配置 D1 权限，或请账号管理员预先创建并授权数据库；仓库代码不能绕过账号授权。若要使用其他名称/ID 的数据库，先备份并确认目标，再通过 npm run cf:configure -- --database-id 真实UUID --database-name 实际名称 配置、重新构建。

### 首次打开与管理员

1. 部署成功后访问 Worker 提供的正式网址。首次请求会自动创建当前版本所需的缺失表与索引；只使用 IF NOT EXISTS，不删表、不覆盖资讯或内部记录。
2. 访问 `/api/deployment-health`。数据库可用时 ready 为 true、database 为 ready；首次还没有管理员时 adminInitialized 为 false，这是待完成账号初始化，不代表资讯不能浏览。
3. 在 Cloudflare 的 D1 列表找到刚绑定的数据库（以 Worker 的 DB 绑定为准）。下载 deployment-tools/管理员初始化工具.html 到自己的电脑，用 Edge/Chrome 本地打开，自行设置管理员账号和初始密码。
4. 将生成的 INSERT 与检查 SELECT 分别复制到该数据库的 Console 执行。它只允许在没有成员的数据库创建首位管理员，没有通用默认密码。
5. 回到工作台登录并更改初始密码，在“成员与账号”创建同事的独立账号，给予编辑角色即可参与选题。无需 GPT 账号。

若 /api/deployment-health 返回 missing，检查 DB 绑定；返回 unavailable，检查 D1 权限、可用性与运行日志。不要把部署命令通过等同于已经完成管理员初始化或邮件发送。

## B. 备选：Cloudflare Pages + GitHub

仅在你明确创建的是 Pages 项目时使用：框架预设 None，生产分支 main，构建命令 `npm run build && npm run build:upload`，输出目录 `pages-upload`，环境变量 `NODE_VERSION=24`。

在 Pages 控制台设置 compatibility date 为 2026-05-15、flag 为 nodejs_compat；创建/选中独立 D1，并手动绑定变量名 DB。Pages 的发布流程不通过上述 Workers 部署命令自动创建 D1。绑定后新部署才会生效；表结构由新版本首次请求初始化，管理员步骤同上。源码保留数据库初始化.sql，可用于离线检查与手动补建。

已有 Pages 直接上传项目与 Git 集成项目是不同创建路径；请按 Cloudflare 当前支持方式处理，勿覆盖原公开资讯网站。ZIP 拖拽流程另见先读我_Cloudflare拖拽部署.md。

## 权限、数据与后续更新

所有访客可浏览资讯和法律法规监测；团队选题、成员、备注、规则、日志及导出需要独立账号和角色权限。未登录不能加入选题池，也不能下载团队快照。

仓库只含已有 56 条公开资讯快照，不含旧站口令、内部选题或邮箱连接。原站与新站数据库、地址、更新机制独立。每日采集、09:30 简报和 10:00 邮件没有随源码启用；MONITOR_API_TOKEN 只控制监测接口，不代表已有定时执行器。

向 main 推送代码会触发 Git 集成构建；日常资讯写入仍走新站数据库，不需要每次改代码或重新部署。

不要上传真实密码、管理员生成 SQL、.env、.dev.vars、数据库导出、Cookie、令牌或私钥。

## 本地验证

Node.js 24+ 安装依赖后：npm run typecheck、npm test、npm run build、npm run test:workers、npx wrangler deploy --dry-run。

Pages 另执行 npm run build:upload 和 npm run test:pages。

本地测试涵盖生成的真实多模块 Workers 入口、静态资源、空 D1 首次访问、公开资讯、团队接口保护、数据库失败提示、幂等建表和既有数据保留；Pages 另验证独立账号登录、改密、多人协作和导出。dry-run 不会验证真实 Cloudflare 账号额度或权限，实际部署仍需查看你的构建结果。

## 官方依据

自动配置（Automatic provisioning）：
https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning

Workers Builds 配置：
https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

D1：
https://developers.cloudflare.com/d1/get-started/

Pages Git 集成：
https://developers.cloudflare.com/pages/get-started/git-integration/
