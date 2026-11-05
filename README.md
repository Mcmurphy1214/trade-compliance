# 贸易合规团队工作台 · Cloudflare 独立部署版

本仓库包含完整的独立团队工作台源码，默认支持 Cloudflare Workers 的 GitHub 自动构建部署，也保留 Pages / ZIP 拖拽部署。

使用 GitHub 部署请先阅读 [GitHub 到 Cloudflare 部署说明](deployment-tools/GitHub到Cloudflare部署.md)。你当前的 Workers 项目名为 `trade-compliance`，构建命令为 `npm run build`，部署命令为 `npx wrangler deploy`。D1 未指定 ID 时由 Wrangler 自动创建或复用，首次访问自动补齐缺失表和索引；管理员仍由站点所有者自行初始化。

如果明确选择 Pages 或 ZIP 拖拽，请使用部署说明中的对应章节，不要混用 Workers 与 Pages 的构建设置。

## 已包含

- 全球资讯、法律法规监测、团队选题池、独立账号与角色、操作记录。
- 发布日期自选起止区间、多主题筛选、多人合并关注与规则入池。
- Excel/Word 默认依次导出：原文标题、内容简述、建议、领域、信息发布日期、原文链接；其他字段可选。
- PDF 使用已确认的完整简报模板、目录跳转、目录旁重要日期提示、官方链接、单列分析与正文双栏排版。
- 当前工作台 56 条公开资讯快照；迁移截止记录为 2026-11-05 14:11 北京时间。这是已有数据迁移，不代表本轮重新核查官方信源。

本包不包含旧站账号、密码、选题、备注、会话、内部日志及邮箱连接。公开资讯可以匿名阅读；团队功能需要独立账号。原公开网站与原工作台不受此导出影响，新站使用独立数据库和网址。

## 不会自动迁移的服务

每日采集、09:30 简报生成、10:00 邮件发送并未在本部署包中启用。它们需要新站另行配置定时执行器、信源访问方式及邮件服务凭据。配置监测令牌也不等于任务已运行或邮件已送达。

## 后续修改源码（可选）

Node.js 24 或更高版本：

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run build:upload
npm run test:workers
npm run test:pages
```

`pages-upload/` 目录内所有文件应直接放到正式上传 ZIP 根目录。Workers 构建只需 npm run build；Pages 额外执行 build:upload。手动拖拽时，将 pages-upload 目录内容压缩为 ZIP 上传。仓库不提交编译产物。

`wrangler.jsonc` 不含占位 UUID：省略 database_id 即启用自动创建/复用。自动部署时数据库 ID 保存在 Cloudflare，不会自动写回 GitHub；同名数据库及现有 DB 绑定可以复用。若明确指定某个已有数据库，可运行 cf:configure 填写其真实 UUID。Pages 拖拽仍在控制台绑定 DB。不要将管理员生成的初始化 SQL、密码、令牌或数据库导出放入仓库或上传包。

首次请求的数据库初始化只执行 CREATE TABLE/INDEX IF NOT EXISTS，不删除数据、不重置口令、不创建通用账号；本功能补齐当前表结构，不替代未来破坏性数据库迁移的人工审查。

字体授权与第三方声明见 public/fonts、vendor 和 THIRD_PARTY_NOTICES.md。
