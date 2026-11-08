<!-- readme-header:start -->

<p align="center">
  <img src="./assets/readme/logo.svg" width="64" alt="Weava">
</p>

<h1 align="center">Weava</h1>

<p align="center">
  <strong>以内容为中心的自托管建站框架，集中完成写作、发布与网站管理。</strong>
</p>

<p align="center">
  <strong>中文</strong> · <a href="./README.en.md">English</a> · <a href="./README.ja.md">日本語</a> | <a href="./docs/authoring.md">文档</a> | <a href="./CONTRIBUTING.md">贡献</a> | <a href="https://github.com/CheshireMew/Weava/issues">反馈</a>
</p>

<p align="center">
  <a href="https://x.com/0xCheshire" title="X"><img src="https://img.shields.io/badge/X-%400xCheshire-000000?logo=x&amp;logoColor=white" alt="X：@0xCheshire"></a>
  <a href="https://t.me/CheshireBTC" title="Telegram"><img src="https://img.shields.io/badge/Telegram-CheshireBTC-26A5E4?logo=telegram&amp;logoColor=white" alt="Telegram：CheshireBTC"></a>
  <a href="https://blog.blacknico.com/" title="Blog"><img src="https://img.shields.io/badge/Blog-blog.blacknico.com-2E7D32?logo=rss&amp;logoColor=white" alt="博客：blog.blacknico.com"></a>
  <a href="https://blacknico.com/" title="Homepage"><img src="https://img.shields.io/badge/Home-blacknico.com-1F6FEB?logo=googlechrome&amp;logoColor=white" alt="个人主页：blacknico.com"></a>
</p>

<p align="center">
  <a href="https://github.com/CheshireMew/Weava/stargazers"><img src="https://img.shields.io/github/stars/CheshireMew/Weava?style=flat" alt="GitHub Stars"></a>
  <a href="https://github.com/CheshireMew/Weava/forks"><img src="https://img.shields.io/github/forks/CheshireMew/Weava?style=flat" alt="GitHub Forks"></a>
  <a href="https://github.com/CheshireMew/Weava/blob/main/LICENSE"><img src="https://img.shields.io/github/license/CheshireMew/Weava?style=flat" alt="Repository License"></a>
</p>

<!-- readme-header:end -->

Weava 用来构建和管理博客、官网、作品集、文档站与资源目录。你可以在浏览器后台写作、上传媒体、预览并发布内容，也可以通过 CLI／API 定制内容结构和自动化操作。文章和网站设置保存在独立的站点目录中，日常更新无需重新构建程序。

同一版本的程序、后台和依赖只需安装一份，多个网站可以共用；各站独立保存数据库、账户、媒体和设置，并分别选择程序版本。下面从安装共用程序开始，完成建站和第一次发布。

## 可以做什么

| 你要做的事 | Weava 提供的能力 |
| --- | --- |
| 写文章和短笔记 | 可视化与 Markdown 源码编辑、表格、任务列表和代码块；笔记单独管理，在随笔时间线阅读 |
| 保存与发布 | 自动保存、浏览器本地草稿恢复、多窗口冲突对比、修订预览、定时发布与公开版本回退 |
| 管理媒体和网站 | 拖图上传、断点续传、媒体分组与图片裁切；关于本站、友情链接、分类标签、导航、外观和广告 |
| 与读者互动 | Newsletter 主题、文章目录、点赞、评论与回复、留言板、站主回复和后台审核 |
| 帮助内容被找到 | 中文搜索、搜索与分享信息、RSS、站点地图和旧网址跳转 |
| 了解访问情况 | 趋势、来源、设备、地区、访客轨迹、实时在线、同期对比与 CSV 导出 |
| 建站与定制 | 博客、官网、作品集、文档站、资源目录和空白模板；CLI／API 定制内容结构，Astro／React 开发专用页面 |
| 迁移与维护 | WordPress 内容、媒体、评论与统计迁移；完整备份、历史归档、多站点管理和带页面与 SEO 差异检查的程序升级 |

上表列出项目的可用能力，具体按站点配置启用。博客与演示模板默认启用内容、媒体、访问统计和读者互动；官网、作品集、文档站与资源目录默认启用前三项；空白模板仅保留账户、设置与维护。后台“笔记”入口还要求配置笔记类型。调整方法见[功能选择与专用开发](docs/shared-runtime.md#功能选择与专用开发)。

网站由单个站主账户管理。后台聚焦日常写作与网站管理，内容结构和模板定制通过 [CLI／API](docs/interfaces.md) 完成。私密内容、媒体访问控制和可选两步验证也已提供；具体用法见[使用与编辑](docs/authoring.md)。

## 新建站点

当前验收平台为 **Windows**，需要 Git、**Node.js 24.12–24.x** 和 **pnpm 12.4.2**。目前从源码准备程序；`setup.ps1` 会安装锁定依赖，并在缺少专用 pnpm 时安装指定版本。

先在 PowerShell 中构建并登记一份共用程序：

```powershell
git clone https://github.com/CheshireMew/Weava.git
cd Weava
powershell -NoProfile -File .\scripts\setup.ps1
powershell -NoProfile -File .\scripts\run.ps1 build --output E:\WeavaRuntime\programs\weava-0.2.0
powershell -NoProfile -File .\scripts\install.ps1 -Program E:\WeavaRuntime\programs\weava-0.2.0 -Root E:\WeavaRuntime -SitesRoot E:\WeavaSites -BackupRoot E:\WeavaBackups
```

脚本默认使用 `D:\Tools\NodeJS\node.exe`，工具、下载缓存与依赖存储使用 D 盘。Node 在其他位置时，先设置 `$env:WEAVA_NODE='你的 node.exe 完整路径'`，并为安装命令加上 `-Node $env:WEAVA_NODE`。示例中的程序、网站和备份目录可以替换；构建输出需使用新目录，不能覆盖已有程序版本。

安装后，通过同一个入口创建博客、启动后台服务并生成账户设置链接：

```powershell
E:\WeavaRuntime\weava.cmd site create my-site --template blog --theme newsletter --port 4322
E:\WeavaRuntime\weava.cmd --human site start my-site
E:\WeavaRuntime\weava.cmd --site my-site owner setup-link
```

`my-site` 是网站编号，资料保存在 `E:\WeavaSites\my-site`。模板提供可替换的示例内容；其他模板与自定义路径见[共用程序与多个网站](docs/shared-runtime.md)。服务在后台运行，关闭终端后仍可访问。

接下来完成第一次发布：

1. 打开最后一条命令返回的一次性设置链接，在网页中填写站主账户名和密码。链接有效期为 10 分钟，过期后重新运行该命令。
2. 使用新账户登录[本地后台](http://127.0.0.1:4322/admin/)，新建一篇文章，填写标题和正文。
3. 点击“预览”检查效果，再点击“发布”，查看变更并确认。
4. 打开[网站首页](http://127.0.0.1:4322/)，查看已发布的文章。

文章自动保存为草稿，确认发布后才更新访客看到的内容；网站设置自动保存后直接生效。博客还提供独立的“笔记”入口，写好正文后直接发布，在 `/notes/` 随笔时间线阅读。可视化编辑与 Markdown 源码编辑使用同一份 Markdown 正文，支持拖入多张图片；格式与旧正文转换范围见[使用与编辑](docs/authoring.md)。

服务默认只监听本机。公网访问需要配置域名与反向代理；忘记密码、两步验证恢复和自动化初始化见[运行、备份与恢复](docs/operations.md)。

## 迁移已有网站

WordPress 迁移支持标准 WXR XML，先预检，再根据转换报告导入内容、附件与评论。后台“备份与维护”可在网站运行时预检和导入。

CLI 使用离线迁移入口，即使加 `--dry-run` 也需要先停止目标站点。以下示例先停站，只预检 WXR 文件，再重新启动网站：

```powershell
E:\WeavaRuntime\weava.cmd site stop my-site
E:\WeavaRuntime\weava.cmd --site my-site migrate wxr --input E:\Exports\wordpress.xml --dry-run
E:\WeavaRuntime\weava.cmd --human site start my-site
```

预检只报告，不保存。未知插件区块、动态区块和短代码需要在编辑页核查后再发布。旧网址、离线媒体、历史浏览量及 WP Statistics 数据各有迁移入口，见[旧站迁移](docs/migration.md)和 [WP Statistics 迁移](docs/wordpress-statistics.md)。

## 运行与数据

源码仓库、共用程序和站点数据分开保存。每个网站使用独立进程和端口，站点目录保存数据库、文章、媒体、账户配置、统计及专用代码。备份应使用完整实例备份，操作方法见[运行文档](docs/operations.md)。

日常通过安装入口查看、停止和再次启动网站：

```powershell
E:\WeavaRuntime\weava.cmd site list
E:\WeavaRuntime\weava.cmd site inspect my-site
E:\WeavaRuntime\weava.cmd site stop my-site
E:\WeavaRuntime\weava.cmd --human site start my-site
```

也可以双击**站点目录中**生成的 `start.bat`；提示窗口关闭后网站继续运行。需要在终端监看并用 Ctrl+C 停站时，改用 `site start my-site --foreground`。CLI 默认返回 JSON，供脚本或外部工具调用；`--human` 用于启动提示。

新建第二个网站时，换一个编号和端口即可共用已安装程序。各站固定所选版本，添加新程序不会自动升级已有网站。升级前可用 `site update my-site --to 程序编号 --check` 演练迁移，比较匿名页面、网址和 SEO 信息；意外差异会阻止切换。程序登记、正式升级、恢复、开机运行和反向代理配置见[共用程序与多个网站](docs/shared-runtime.md)。

## 开发

Astro 提供访客页面，React 提供管理后台，TypeScript 核心负责内容、修订、发布、搜索与维护，SQLite 保存站点数据。普通访客页面不加载 React 管理后台或 Lexical 编辑器。

完成依赖安装后，在仓库根目录初始化一个独立的开发站点并启动开发服务：

```powershell
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\dev-site init --demo --port 4323
powershell -NoProfile -File .\scripts\run.ps1 --site E:\WeavaSites\dev-site dev
```

开发服务保持终端打开，按 Ctrl+C 停止。源码根目录的 `start.bat` 也是前台入口，使用 `--site` 指定已初始化的站点，不传参数时选择 `demo`；它与站点目录的后台启动脚本用途不同。

框架代码变化需要重新构建程序；网站专用 Astro／React 页面放在站点的 `custom` 目录，通过 `site build 网站编号 --apply` 构建并启用。日常编辑和内容发布沿用现有程序。开发检查、目标测试与构建命令见[贡献指南](CONTRIBUTING.md)，专用页面与 SDK 用法见[共用程序文档](docs/shared-runtime.md)。

## 文档

| 要了解的内容 | 入口 |
| --- | --- |
| 写作、媒体与发布 | [使用与编辑](docs/authoring.md) |
| 安装、多站点与专用页面 | [共用程序与多个网站](docs/shared-runtime.md) |
| 运行、备份、恢复与升级 | [运行文档](docs/operations.md) · [账户与网站防护](docs/security.md) |
| 迁移旧站与统计 | [旧站迁移](docs/migration.md) · [WP Statistics](docs/wordpress-statistics.md) |
| 访问统计与地区库 | [访问统计](docs/analytics.md) |
| 定制与自动化 | [API 与 CLI](docs/interfaces.md) · [API 参考](docs/api-reference.md) · [主题与扩展](docs/extensions.md) |
| 架构与维护记录 | [架构与数据](docs/architecture.md) · [实施记录](docs/implementation.md) · [完善计划与验证记录](docs/completion-plan.md) |

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history.svg">
  <img alt="GitHub Star History" src="https://raw.githubusercontent.com/CheshireMew/Weava/star-history/star-history.svg">
</picture>

## 许可证与第三方资源

框架采用 **AGPL-3.0-only**，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。站点文章、来源媒体、统计和私有配置不属于本仓库的软件分发范围。

第三方依赖保留各自许可，见[依赖声明](docs/dependencies.json)。统计世界地图基于 [Natural Earth 公共领域国界数据](https://www.naturalearthdata.com/about/terms-of-use/)，用于后台地图；可选地区查询使用单独下载的 [DB-IP Lite](https://db-ip.com/db/lite.php) 数据，按 CC BY 4.0 保留署名。完整来源说明见 NOTICE。
