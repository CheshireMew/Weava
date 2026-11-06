# 共用程序与多个网站

Weava 0.2 将程序安装和网站资料分开。同一版本的前台、后台、任务程序、构建工具和依赖只需安装一份，多个网站分别绑定这个版本。网站仍使用独立进程、数据库、账户、媒体和设置。

## 安装与创建

在源码仓库完成依赖安装后，将一次构建写入新的正式目录；构建不会修改已有网站的版本选择，也不会编译或覆盖它们的扩展。

```powershell
$env:WEAVA_BUILD_OUTPUT='E:\WeavaRuntime\programs\release-0.2'
& D:\Tools\NodeJS\node.exe --import tsx scripts/build.ts
.\scripts\install.ps1 -Program E:\WeavaRuntime\programs\release-0.2 -Root E:\WeavaRuntime -SitesRoot E:\Code\WeavaSites -BackupRoot D:\Tools\weava\backups
E:\WeavaRuntime\weava.cmd site create company --template company --port 4330
E:\WeavaRuntime\weava.cmd site start company --autostart
```

可选模板为 `blog`、`company`、`portfolio`、`documentation`、`resource` 和 `blank`；兼容综合演示使用 `demo`。博客可加 `--theme newsletter`。模板只初始化空网站，更新不会重新填入模板内容。空白网站提供基础后台和 `custom/src/pages/index.astro` 开发入口；执行 `site build --apply` 后启用自己的页面。

Node 位置可在安装时用 `-Node` 指定。程序和网站可放在其他位置。安装目录的 `installation.json` 登记本机路径，网站的 `program.json` 固定所选程序编号与清单；登记表不代替网站自身的部署选择。`program add --from 路径 --default` 只改变新网站的默认版本。

创建后可通过 `owner setup-link` 发放一次性账户设置链接。日常文章、媒体、评论、设置、统计和备份在各自后台操作。内容结构、类型、布局和复杂配置仍通过既有 CLI/API 管理，不恢复页面搭建器。

## 运行、检查和维护

```powershell
E:\WeavaRuntime\weava.cmd site list
E:\WeavaRuntime\weava.cmd site inspect company
E:\WeavaRuntime\weava.cmd site stop company
E:\WeavaRuntime\weava.cmd site restart company
E:\WeavaRuntime\weava.cmd site logs company
E:\WeavaRuntime\weava.cmd host status
```

`site start` 启动后台进程，终端可以关闭；`--foreground` 保持终端并由 Ctrl+C 停站。网站目录的 `start.bat` 使用同一个安装入口。旧的 `--site 完整目录` 选择方式和内容、媒体、发布等命令继续支持，数据操作交给该网站选定的编译 CLI。

双击 `start.bat` 会显示“已启动”、本机网站和后台地址，按任意键关闭窗口后网站继续运行。它使用 `--human` 输出提示；外部工具直接调用 CLI 时仍默认获得 JSON。需要由 Ctrl+C 停站时，显式使用 `site start --foreground`。

正常启动、状态和账户检查不迁移数据库。内容、统计或扩展需要迁移时，入口拒绝启动并给出后续操作。网站未通过初始化与扩展检查前不报告就绪。停止时暂停新任务并等待在途请求和任务，默认最多五分钟；超时保留运行任务并取消停止，不强杀任务来假装更新成功。

`extensions/state` 用于行情、公告等可重建的运行缓存，后台刷新这些缓存不会取消升级预检；缓存仍随恢复点保存。需要参与升级资料核对的业务数据应使用 SDK 业务库。预检会带上主题图片、字体等静态资源，复用站点媒体；资源核验遇到临时服务器错误时最多重试两次，持续失败仍会阻止升级。

同一安装中的网站各用独立端口。托管器为每次启动生成身份标识，检查真实健康响应；意外退出采用退避重启，连续五次失败后停止重试。网站资料和程序不进入 nginx 的静态公开目录。

## 功能选择与专用开发

```powershell
E:\WeavaRuntime\weava.cmd site features company
E:\WeavaRuntime\weava.cmd site features company --set content,media,analytics
E:\WeavaRuntime\weava.cmd site build company
E:\WeavaRuntime\weava.cmd site build company --apply
```

功能名称为 `content`、`media`、`analytics`、`engagement`。站主账户、设置与维护为基础功能；互动依赖内容，内容功能包括发布与搜索。停用会检查使用情况，保留原数据；界面、接口和任务一起遵循配置。

专用代码放在 `custom/src/pages`、`custom/src/components`，公开静态资源放在 `custom/public`。使用 Astro 页面、CSS、脚本和 React 组件；React 组件用 `client:load` 等 Astro 指令启用交互。网站构建只生成专用代码和浏览器资源，并登记到 `site-builds`，公共服务和后台继续读取已安装程序。

```astro
---
import { getWebsite } from '@weava/site';
const website = getWebsite();
const posts = website.content.query({ type: 'post' });
---
<html lang="zh-CN"><head><title>{website.settings.name}</title></head>
<body><h1>{website.settings.name}</h1>{posts.items.map(post => <a href={post.path}>{post.title}</a>)}</body></html>
```

`getWebsite()` 在请求内提供当前网站的设置、内容查询、预览内容、媒体、SEO、业务数据和任务入口；在模块顶层调用会报错。专用页面先于通用内容路由处理，命中的页面返回 404 时不会跳去另一个页面。后台、框架 API、媒体、预览和健康入口不能被专用代码覆盖。

`custom/migrations.ts` 可默认导出 `{id,version,up({business})}` 数组。版本逐个连续执行，迁移只操作业务数据库的同步事务。业务数据通过 `business.get/list/put/transaction` 访问，与文章修订和公开发布分开；预览不允许写业务数据或领取持久任务。

`custom/extensions.ts` 可定义网站扩展，使用既有扩展生命周期和区块接口，并用 `jobs` 声明具名任务。请求内通过 `website.tasks.enqueue('扩展编号:任务名称', payload)` 入队，任务状态和日志沿用框架。旧实例原有 `extensions/index.mjs` 或清单继续支持。扩展有数据迁移时，自动更新要求显式声明 `migrationFiles: []`，或列出 `extensions/state/` 内会写入的确切文件。

`site build` 只准备候选构建；`--apply` 才执行演练、迁移、切换与启动检查。编译失败继续使用原构建。为新框架准备专用构建时用 `site build --program 程序编号`，再用 `site update --to 程序编号 --build 构建编号` 启用配套版本。

## 更新、恢复和搬迁

```powershell
E:\WeavaRuntime\weava.cmd program add --from E:\WeavaRuntime\programs\release-next
E:\WeavaRuntime\weava.cmd site update company --to 程序编号
E:\WeavaRuntime\weava.cmd site update --sites company,blog --to 程序编号
E:\WeavaRuntime\weava.cmd site recover company
```

更新先核验版本、空间和任务占用，再按下文的在线准备流程演练和比较公开输出；通过后才停止写入、建立恢复点、迁移真实数据并检查实际网站。仅在实际检查通过后完成操作。多站名单按顺序执行，一个失败即停止后续网站。未完成的切换会阻止普通启动，应先 `site recover`。

### 升级的 SEO 保护与维护响应

支持 `upgradeProtocol: 2` 的程序采用在线准备流程：旧站继续提供服务时创建数据库工作副本，演练迁移并启动隔离的真实 HTTP 网站，用匿名身份比较升级前后的输出。检查公开内容网址、旧网址跳转、网站地图及其索引、页面链接和分页；不使用登录账户代替访客。比较 HTTP 状态、正文、H1、标题、摘要、canonical、robots/noindex、结构化数据、hreflang、站内链接、图片位置和原有站内图片可用性。脚本、CSS、空白和框架已知的实时评论/计数不作为正文变化；自定义实时区域可用 `data-weava-live` 标明。没有抽样跳过：默认最多 50,000 个公开地址，超过限制明确失败。

```powershell
E:\WeavaRuntime\weava.cmd site update blog-blacknico --to 程序编号 --check
E:\WeavaRuntime\weava.cmd site update blog-blacknico --to 程序编号
```

`--check` 只演练，不停止正在运行的旧站或切换版本。原先停止的网站会临时启动以取得真实页面，检查成功或失败后都恢复停止状态；无法恢复时明确报错。检查报告独立保留，不替换已完成升级的恢复点。意外的 SEO 差异会阻止切换并返回具体报告路径。若本次确实有意调整页面输出，先核对报告，再用 `--accept-seo 报告中的approval值` 确认这一组精确差异；内容、目标程序、构建或差异变化后，原确认失效。没有通用跳过检查的开关。

随机文章入口这类临时跳转需要在 `site.json` 明确声明规则，例如 `"upgrade":{"dynamicRedirects":[{"path":"/试试手气/","status":302,"contentType":"post"}]}`。检查仍要求它返回指定的临时跳转状态，并且目标属于当前已发布、公开的对应内容类型；改到站外、私密文章或改成永久跳转仍会拦截。普通旧网址不适用这项规则。

准备期间保存新文章、修改设置、账户、业务数据、扩展代码或来源状态时，会取消本次切换，保留新资料并要求重新检查。通过准备后才进入维护、停止旧进程、保存恢复点和迁移实际数据。重复的完整渲染已经在在线阶段完成，不再占用停站窗口；实际新进程仍会再次比较匿名页面输出，完成初始化和后台检查后才恢复访问。初始化失败、实际输出异常或迁移进程中断时，可恢复数据与部署选择；恢复未完成前保留维护状态。

公网代理沿用现有 nginx。为每个站生成维护 include，并把它放进该站已有的 `server` 块，保留现有域名、TLS、上传限制和访问策略；已有 `location /robots.txt` 应合并替换，不能重复定义。

```powershell
E:\WeavaRuntime\weava.cmd site deployment-info blog-blacknico --proxy-origin https://你的域名
```

命令在安装目录的 `proxy/网站编号` 生成 `maintenance.conf`，并输出 include 和普通代理位置示例。维护标记由升级流程写入和撤销，不需要每次升级重载 nginx。维护期间返回 `503`、`Retry-After: 60`、`Cache-Control: no-store`；原 robots.txt 单独保留可访问，不用 `noindex`、`404` 或首页 `200` 替代维护状态。上游进程短暂不可用也返回维护 `503`。

登记 `--proxy-origin` 后，升级会实际探测该代理的维护响应和 robots.txt；尚未接入或配置错误时会在停止旧站前取消切换。未登记代理时只验证本机应用，结果中的 `proxyVerified` 为 false，不代表公网代理已接入。本次未更改真实公网 nginx、域名、证书或防火墙。

SEO 报告保留在该站恢复根目录的 `preflight-*` 下，恢复点仍是独立的 `update-*`。准备阶段不会复制大型媒体；隔离站只读原有媒体资源。框架减少的是升级引入的意外变化，不能保证 Google 必然收录或排名不变。

迁移恢复点保存数据库、配置、密钥及可能修改的扩展文件，预检不复制媒体目录。恢复过程保留失败文件并登记恢复进度。它不等于完整站点备份；完整备份还包括媒体、网站专用源码和构建，但不会复制共用依赖目录。已完成升级后要连数据一起回退，必须明确使用 `site recover --restore-data`，升级之后的文件作为失败现场保留，不会自动合并。

旧网站用 `site adopt 网站编号 --path 完整目录 --program 程序编号` 原位接管，账户、内容、端口、媒体和网址保留。接管失败只能保证恢复到操作前，不能保证原先不兼容的旧程序变得可用。

搬到另一台 Windows 机器时，准备兼容的 Node、程序文件和完整站点备份，创建安装登记。程序内的旧目录联接用 `program add --from 路径 --repair-links` 重建，旧链接本身保留作诊断，不修改它原来指向的内容。恢复网站后原位接管，重建网站构建的依赖引用并完成 HTTP 核对。数据库不能由两台机器同时打开。

## 开机运行和反向代理

`host autostart --account 机器名\普通账户` 输出任务配置；加 `--configure` 才登记 Windows 开机任务。任务使用该账户以普通权限运行，不保存口令；登记需要调用者具有相应任务计划权限。网站还须通过 `site start --autostart` 标记为开机恢复。

`site deployment-info 网站编号` 输出监听地址、启动入口和 nginx 转发片段。代理必须传递正确 Host 和覆盖转发头。服务环境按网站保存在 `site.json` 的 `environment`，可配置 `WEAVA_REQUIRE_HTTPS`、可信代理和备份目录；编辑后重启生效。域名、证书和防火墙由服务器实际配置，本机检查不代表公网切换完成。

## 本机实施记录（2026-11-05）

管理入口已安装到 `E:\WeavaRuntime\weava.cmd`，首次多站实施的程序为 `E:\WeavaRuntime\programs\weava-0.2.0-windows-host-20261105`，编号 `43799324-555e-4686-b9b6-43613ae57e37`。demo、博客和加密站原位接管，端口分别为 4322、4324、4323，原有目录、账户、内容、媒体和公开版本保持不变。博客原有数据库 12 与旧程序 11 的失配已解除。后续 SEO 保护的实施记录见下文。

Windows 任务 `Weava-3c090b6c-ff20-4411-9195-aa3188aeb8e0` 已登记为开机触发，使用 Lenovo 账户、S4U 登录和 Limited 权限，不在项目内保存账户口令。已从任务计划程序实际启动，验证三个网站恢复以及普通会话 CLI 的跨登录会话管理；未重启整台电脑。三个网站均已登记为自动恢复。

已验证六种模板、专用 Astro 页面、React 交互、业务接口、静态资源、独立业务迁移、SDK 持久任务、功能启停和草稿预览；编译失败保持原部署，服务初始化失败恢复数据和原部署，迁移进程中断后可恢复。实际后台登录与专用页面预览也通过了内置浏览器检查。

相关六个测试文件共 47 项通过，TypeScript 和 API 文档一致性检查通过。全量测试曾暴露的另外四项失败涉及草稿查询投影、统计测试夹具、共享布局搜索和 WordPress 图片预期，未在本次实施中扩展修复；不能将全量测试描述为全部通过。

本次测试、故障复现、任务脚本和结果集中在 `D:\Tools\cache\weava\tasks\shared-runtime-20261105`；复用既有测试时，原测试脚本另在 `D:\Tools\cache\weava\tests` 创建了用例目录。逐目录占用见任务目录中的 `artifact-inventory.json`。正式恢复点位于 `D:\Tools\weava\backups\shared-runtime`，失败现场保留在网站同盘的 `.weava-recovery-*` 目录，跨盘恢复只复制经校验的恢复成员，不移动网站媒体。

新增源码目录为 `packages/manager` 和 `packages/site-runtime`；安装目录新增 `manager`、`logs`，程序目录新增以下八个版本。前七个为实施过程中保留的构建、故障复现与恢复引用，最终版本为最后一个；它们不会因新建网站再次复制。

```text
E:\WeavaRuntime\programs\shared-runtime-20261105
E:\WeavaRuntime\programs\shared-runtime-0.2-20261105
E:\WeavaRuntime\programs\shared-runtime-0.2-final-20261105
E:\WeavaRuntime\programs\shared-runtime-0.2-release-20261105
E:\WeavaRuntime\programs\shared-runtime-0.2-verified-20261105
E:\WeavaRuntime\programs\weava-0.2.0-20261105
E:\WeavaRuntime\programs\weava-0.2.0-windows-20261105
E:\WeavaRuntime\programs\weava-0.2.0-windows-host-20261105
```

旧程序、恢复点和测试材料未经删除授权均保留。没有打包、发布 npm 包、提交或推送代码，也没有更改真实公网域名、证书或防火墙。

最终程序约 290.1 MiB，三个正式网站共用这一份。保留的七个中间构建合计约 1.98 GiB；本机接管和更新恢复点约 3.95 GiB；专用任务目录约 181.7 MiB，复用既有测试留下的 69 个用例目录约 896.1 MiB；demo 跨盘恢复失败现场约 0.8 MiB。新增管理源码约 51 KiB，网站构建与 SDK 声明目录约 6 KiB。上述目录不包含对原有大型媒体的复制。

### SEO 保护补齐记录（同日）

当前安装默认版本为 `E:\WeavaRuntime\programs\weava-0.2-seo-final-20261105`，编号 `e9872a98-8f66-4ec6-965b-ffec5755ba5d`。博客已通过新的升级流程绑定此版本，demo 和加密站继续绑定原版本，证明新增程序不会隐式切换其他网站。博客原有“试试手气”入口声明了 302 随机文章规则，其余旧网址继续严格核对跳转。

真实博客比较了 1,228 个地址和 1,186 个站内图片资源，意外差异为零，内容、历史修订、账户和公开版本指纹保持一致；在线准备约 20.7 秒，维护约 21.9 秒。首页、代表性文章、后台、robots.txt 和 sitemap.xml 实际 HTTP 均为 200。博客的 `proxyVerified` 为 false，因为本次没有改动真实公网代理；本机 nginx 专用夹具已验证维护 503、Retry-After、不缓存、robots.txt 保留、上游停止以及恢复到 200。

相关单元检查合计 41 项通过，TypeScript、API 文档一致性及差异格式检查通过。真实进程验证包括在线预检不停止旧站、错误 canonical 拦截、成功切换、服务初始化失败回退、迁移进程中断后恢复；切换期间观测到的响应仅为 200 和维护 503。快速启动脚本也已在真实 cmd 窗口验证，现在显示网站和后台地址，并明确关闭窗口后网站继续运行。

本次新建 `D:\Tools\cache\weava\tasks\seo-upgrade-20261105`，约 17 MiB，保存专用夹具、日志和必要失败复现；构建版本 `weava-0.2.1-seo-20261105` 和最终版本 `weava-0.2-seo-final-20261105` 各约 292.3 MiB。安装目录新增 `proxy`，仅数 KiB。博客新增两个 `preflight-*` 检查目录约 78.9、80.2 MiB，以及一个 `update-*` 恢复点约 67.2 MiB；均未复制媒体目录。精确路径、复用测试的新增目录和占用见任务目录的 `artifacts.json`。材料未经删除授权均保留，测试托管器和专用 nginx 已停止，正式托管器继续由原 Windows 计划任务运行。
