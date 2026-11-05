# 贸易合规团队工作台 · Cloudflare 独立部署版

本仓库包含完整的独立团队工作台源码，可通过 Cloudflare Pages 的 GitHub 集成自动构建部署，也可手动生成 ZIP 后拖拽上传。

使用 GitHub 部署请先阅读 `deployment-tools/GitHub到Cloudflare部署.md`；使用拖拽部署请阅读 `deployment-tools/先读我_Cloudflare拖拽部署.md`。两种方式均需配置独立 D1 数据库和管理员账号。

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
node scripts/test-pages-upload.mjs
```

`pages-upload/` 目录内所有文件应直接放到正式上传 ZIP 根目录。GitHub 集成由 Cloudflare 执行构建；手动拖拽时，将 pages-upload 目录内容压缩为 ZIP 上传。源码包本身不包含已编译文件。

`wrangler.jsonc` 的数据库 UUID 是占位符，仅供以后使用 CLI 部署时填写，拖拽方式在 Cloudflare 控制台直接绑定 D1 即可。不要将管理员初始化 SQL、密码、令牌或数据库导出放入正式上传包。

字体授权与第三方声明见 public/fonts、vendor 和 THIRD_PARTY_NOTICES.md。
