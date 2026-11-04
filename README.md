# Weava

一个以内容为中心的通用建站框架。Astro 提供访客页面，React 提供管理后台，TypeScript 核心负责内容、修订、发布、搜索与维护。

支持博客、官网、作品集、文档和资源目录。文章可以可视化编辑或使用 Markdown；关于本站和友情链接直接在网站设置中填写。日常内容和设置通过数据库发布，无需重新构建程序。普通前台页面不加载 React 管理后台或 Lexical 编辑器。

## 功能

- 可视化与 Markdown 编辑、媒体和表格编辑、草稿自动保存、历史对比、冲突恢复、预览和定时发布。
- 关于本站、友情链接、内容类型与字段、主题和扩展、中文搜索、SEO、RSS 与站点地图。后台不提供自定义页面搭建器，旧站页面和公开网址继续保留。
- 公开与私密文章、媒体访问控制、图片派生尺寸、浏览统计与目录备份恢复。
- Newsletter 主题、可折叠文章目录、点赞、带图片验证码和频率限制的评论、回复关系、站主回复和后台审核。
- 单站主账户资料、改密、会话撤销、可选两步验证与一次性恢复码，以及停站后的本机恢复命令。
- 完整访问统计、来源与设备分析、访客轨迹、实时在线、免费本地地区库及世界地图、同期对比与 CSV 导出。
- 标准 WordPress WXR 预检与导入、页面和类型转换、附件与评论迁移，以及原有来源目录和历史浏览量迁移。

仓库仅包含框架源码、文档和测试。站点数据库、文章、图片、密码、统计及迁移档案保存在独立实例目录中，不属于此仓库。

## 新建站点

运行环境为 Node 24 和 pnpm 12。当前验收平台为 Windows。克隆仓库后，可运行 `scripts/setup.ps1` 安装锁定依赖，下载和缓存默认使用 D 盘；Node 路径可通过 `WEAVA_NODE` 指定。`better-sqlite3` 13 自带原生模块，本项目禁止其安装时重复编译；启动和测试会实际验证数据库可用。

```powershell
git clone https://github.com/CheshireMew/Weava.git
cd Weava
powershell -NoProfile -File scripts/setup.ps1
powershell -NoProfile -File scripts/run.ps1 --site E:\WeavaSites\my-site init --demo --port 4322
powershell -NoProfile -File scripts/run.ps1 build
powershell -NoProfile -File scripts/run.ps1 --site E:\WeavaSites\my-site start
```

首次启动后，终端会显示一个 10 分钟内有效的一次性设置链接。打开链接，自己填写账户名和密码，完成后用新账户正常登录。程序没有通用初始密码，也不会生成一份需要寻找的密码文件。链接过期时可在本机运行 `owner setup-link` 重新生成；已有账户忘记密码时运行 `owner reset-link`，完整命令见[运行与恢复](docs/operations.md)。初始化不会自动发布到互联网。

自动化初始化仍可加上 `--password-file D:\Tools\weava\my-password.txt`，文件由站主准备，密码至少 15 个字符。程序只保存密码派生值，不要把密码直接放进命令参数。

打开 [本地后台](http://127.0.0.1:4322/admin/)，编辑并发布内容后可从 [网站首页](http://127.0.0.1:4322/) 查看。同一个站点只运行一份服务，端口占用时不会替换已有服务。

Windows 下可双击仓库根目录的 `start.bat`，启动已初始化的默认站点 `../WeavaSites/demo`，使用最近成功构建的程序。运行时保持窗口打开，按 Ctrl+C 停止。也可执行 `start.bat --site "E:\WeavaSites\my-site"` 指定其他站点，或加上 `--port 4323` 指定端口；启动失败时窗口会保留错误信息。

## 开发与验证

工作区使用 pnpm 12。`build` 生成程序运行需要的前后台文件，不制作安装包。构建写入 D:/Tools/cache/weava/programs 下的独立版本目录，验证成功后更新默认版本；不再生成 `dist.retained-*` 目录或旧入口文件副本。内容发布只切换公开版本，不执行这个构建。

```powershell
pnpm check
pnpm test
pnpm build
pnpm weava --site E:\Code\WeavaSites\demo dev
```

真实浏览器检查要求本机 Chrome 和两个示例服务已运行：`pnpm test:browser`。`scripts/api-check.ts` 检查修订冲突、任务幂等、运行时新增网址、设置发布和真实备份。隔离测试和截图存放于 `D:\Tools\cache\weava`。

完整隔离验收可运行 `node --import tsx scripts/foundation-check.ts --production --authoring --extensions --organization --maintenance --five-sites --upgrade`，自行构建并启动临时站点，结束后停止服务。它覆盖五类独立网站、编辑与发布、标准迁移、扩展、归档和程序升级恢复。`storage-growth-check.ts` 检查发布对象与搜索复用；`schedule-interruption-check.ts` 检查真实进程中断。最终证据见完善计划。

## 文档

- [使用与编辑](docs/authoring.md)
- [架构与数据](docs/architecture.md)
- [API 与 CLI](docs/interfaces.md)
- [访问统计与免费地区库](docs/analytics.md)
- [WP Statistics 迁移工具](docs/wordpress-statistics.md)
- [主题与扩展](docs/extensions.md)
- [运行、备份和恢复](docs/operations.md)
- [账户与网站防护](docs/security.md)
- [旧站迁移](docs/migration.md)
- [实施与验收记录](docs/implementation.md)
- [完善计划与当前验证](docs/completion-plan.md)

框架采用 AGPL-3.0-only，完整许可见 [LICENSE](LICENSE)。第三方组件保留各自许可，见 [依赖声明](docs/dependencies.json)。站点文章、来源媒体、统计和私有配置由各站点自行管理，不纳入框架许可或公开示例。
