# 运行、备份与恢复

0.2 的正式运行入口为安装目录的 `weava.cmd`，创建、启动、升级和接管方法见[共用程序与多个网站](shared-runtime.md)。网站不再隐式跟随默认构建；普通打开不会升级旧数据库。本文原有备份和维护 API 仍可通过安装入口按 `--site 网站编号` 调用，具体数据操作由网站选定的编译版本执行。

本地和服务器使用同一份生产程序及站点数据。Node 服务同时提供 Astro 前台、React 后台静态资源及 API。默认监听 127.0.0.1，显式设置 HOST 可更改；服务器 HTTPS 可由已有反向代理提供。当前交付只在 Windows 验收，没有执行公网切换。

正式构建写入新程序目录，核验成功后用 `program add` 登记，再逐站 `site update`。源码开发仍保留 `dist/current.json`，它不改变已接管网站的部署选择。失败构建保留现场，当前程序和后台资源继续可用。源码、站点数据库和媒体不放进公开静态目录；媒体通过受控路径响应。托管器结合进程身份与健康响应判断存活，不仅凭旧 `runtime.json`，也不允许同一个实例并行启动。

```powershell
E:\WeavaRuntime\weava.cmd site start demo --autostart
E:\WeavaRuntime\weava.cmd site status demo
```

## Windows 服务器部署

多站后台运行和开机恢复使用安装 CLI 的 `host` 命令；反向代理片段通过 `site deployment-info` 输出。原有 `scripts/server.ps1` 和 [nginx 配置模板](../deploy/nginx.conf.example) 保留用于检查公网部署环境和权限。此入口固定 Node 监听 `127.0.0.1`，只信任本机代理并启用 HTTPS 请求检查。证书和防火墙由服务器实际配置，普通本地 `start` 继续支持 HTTP。

先修复、构建生产程序并初始化站点。旧站点升级到数据库版本 12 时，由现有离线迁移机制先保存数据库副本，再补建私密媒体和引用索引，包括旧修订和已经归档的内容；归档文件不改写。升级时必须停站并等待任务退出，不要让旧服务和新程序同时访问该站点。

在 Windows 创建专用普通账户，例如 `weava`；不要用管理员账户运行网站。站点、备份和程序分别存放，站点和备份目录预先创建，不允许目录链接或互相嵌套。由管理员为指定的两个数据目录设置权限；这一步会替换其文件权限，保留服务账户、SYSTEM 和 Administrators：

```powershell
.\scripts\server.ps1 -Site E:\WeavaSites\my-site -BackupRoot D:\WeavaBackups -PublicOrigin https://example.com -Account "$env:COMPUTERNAME\weava" -Prepare
```

服务账户只需要读取已构建的程序和 Node 工具；程序目录不要给其它普通用户写权限。证书私钥只允许代理服务账户和管理员读取。完整备份包含账户密钥和 CLI 令牌，与站点采用相同的私有权限，不放在公开网页目录。

复制模板作为 nginx 配置，替换 `example.com`、证书路径和需要时的 Node 端口，使用代理自己的 `nginx -t` 检查。模板只将请求转交 Node，不直接公开任何本地目录；覆盖客户端提供的转发头，设置连接、请求频率、请求大小和超时限制。防火墙仅向公网开放代理的 80/443 端口，保留服务器必需的远程管理规则；Node 端口不得向公网开放。模板中的 HSTS 要求域名持续提供有效 HTTPS，证书续期由服务器维护。

以服务账户先检查，再启动；进程管理器使用同一入口：

```powershell
.\scripts\server.ps1 -Site E:\WeavaSites\my-site -BackupRoot D:\WeavaBackups -PublicOrigin https://example.com -CheckOnly
.\scripts\server.ps1 -Site E:\WeavaSites\my-site -BackupRoot D:\WeavaBackups -PublicOrigin https://example.com
```

`-CheckOnly` 只核对参数、目录与权限，不代表证书或公网防火墙已经验证。启动入口设置 `WEAVA_REQUIRE_HTTPS=1`：未通过可信代理报告 HTTPS 的网页和 API 请求返回 403；只保留不含秘密的健康/会话状态探针，以及来自本机回环地址、持有正确 Bearer 凭据的 CLI 请求。伪造 `X-Forwarded-Proto` 的外部来源不能绕过检查。`PublicOrigin` 用于生成 HTTPS 账户链接，网站设置中的域名也应配置为同一地址。

上线时从另一台机器核实 HTTP 跳转 HTTPS、证书链有效、Node 端口不可达、匿名管理接口返回 401、私密页面和附件返回 404、登录 Cookie 带 Secure；用本站小样本确认统计正常。项目本机验证不会代替这一步真实服务器检查。

站点没有通用默认密码，也不开放注册。新站点使用不带 `--password-file` 的 `init` 后，第一次 `start` 或 `dev` 会在终端显示后台地址和一次性设置链接。打开链接，在网页中选择自己的账户名和密码，再用新账户登录。普通后台地址不能直接初始化账户；只有持有本机生成链接的人才能设置。

链接 10 分钟内有效，只能成功提交一次，重新生成会使旧链接失效。链接只允许设置账户，不能当作登录凭据读取内容或备份。它属于临时凭据，请只交给站主；程序不会把它写入站点公开接口。已初始化的站点启动时只显示账户名、后台地址和重设命令，不再显示密码或自动生成重设链接。

丢失或过期时，在站点所在电脑重新生成；已有账户忘记密码时使用第二条命令。这两个命令可在支持此功能的站点运行期间使用，不会自动升级数据库，也不会在提交前改变原账户或退出原会话：

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner setup-link
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner reset-link
```

重设成功会撤销全部网页登录，之后正常登录。两步验证默认保留；验证器和恢复码都丢失时，可由持有本机站点权限的人执行 `owner reset-link --reset-two-factor`，明确授权在提交新账户时一并关闭两步验证。CLI 令牌独立管理，重设链接不会轮换它。默认链接使用本机回环地址；需要交给远端站主时，加全局参数 `--url https://你的网站域名`，只接受 HTTPS 或本机 HTTP 地址。程序会检查当前运行版本是否支持，旧版本需要先更新重启。

也可使用原有离线恢复命令，不需要邮件服务。先停止目标站点；不提供密码文件时，终端隐藏输入并要求确认两次：

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner reset-password
```

自动化可使用 `--password-file D:\Tools\weava\my-password.txt`，请勿将密码放入命令参数。文件只去掉 UTF-8 BOM 和末尾的一次换行，密码首尾空格保持不变。初始化、后台改密和本机恢复共用规则：新密码至少 15 个 Unicode 字符、最多 1024 个 UTF-16 单元，支持中文、空格和长口令，拒绝本地名单内的常见密码及明显重复模式。不会将密码发送到外部检测服务；已有旧密码继续可登录，主动改密时才应用新规则。

后台“账户”管理单个站主的账户名、显示名、密码、两步验证、登录会话、后台入口及外部工具凭据。已有实例的默认账户名是 `owner`，这不是默认密码；更改账户名或密码后全部旧网页登录失效。敏感操作均需当前密码，已启用两步验证时还需验证码或恢复码。会话显示浏览器、系统、登录时间、最近活动与到期时间，可撤销单个或其他会话。退出由服务端撤销会话，复制的旧 Cookie 也不能继续使用。

登录与敏感操作分别限制频率并持久化。单来源每分钟最多 10 次登录或 20 次敏感验证，全局分别最多 60 或 120 次；密码校验最多同时处理 2 个。连续 5 次失败后从 2 秒开始加倍等待，单来源最多等待 5 分钟，全局累计 30 次失败后等待最多 30 秒；无新失败的计数 10 分钟后过期。`429` 包含 `Retry-After`、`details.retryAfter` 和 `details.retryAt`，页面显示倒计时。本机密码恢复会清除限流状态，避免永久锁住站主。

两步验证由站主主动设置：用验证器扫描本地生成的二维码，或手动添加密钥，输入 6 位验证码确认后才启用，随后复制或下载页面一次显示的 10 个恢复码，确认保存在网站之外后再重新登录。每个恢复码只能使用一次，可代替验证码登录和重新认证。可以验证身份后重新生成恢复码，全部旧码立即失效。启用、关闭两步验证及重新生成恢复码都会撤销现有网页登录；刚使用过的验证码不能重用，重新登录时应等待验证器下一组数字或使用恢复码。账户密钥 `account.key` 随完整备份保存，不能只复制数据库来恢复已开启两步验证的实例。

验证器和恢复码都丢失时，先停止目标站点并等待任务退出，再从持有该站点文件权限的本机终端执行以下恢复命令。命令仅关闭两步验证并撤销全部会话，原密码仍然有效；不知道原密码时再使用密码恢复命令。运行中的实例会拒绝离线恢复。

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner reset-two-factor --confirm
```

账户名、密码和验证器都需要恢复时，可一次处理；下面的命令还会轮换 CLI 令牌，使外部工具保存的旧令牌失效：

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner recover --username nico --reset-two-factor --rotate-cli-token
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner status
```

`owner status` 在本机显示账户名、两步验证状态和后台地址，不输出密码、验证码或令牌。普通改密只撤销网页登录；CLI 令牌独立管理。后台可以轮换 CLI 令牌并选择同时退出全部网页登录；离线命令是 `owner rotate-cli-token --revoke-sessions`。本站 CLI 每次读取新文件，手动保存令牌的其他工具需要重新配置。程序不会在接口或命令结果中返回新令牌。

默认后台地址仍为 `/admin/`，可以在“账户”中修改真实路径，或停站后运行 `owner admin-path --path /manage-my-space`。旧地址直接返回 404，不跳转到新地址。配置仅在站点私有数据、本机状态及已认证账户接口中出现，不放入公开站点设置。地址不能与现有内容、跳转或系统路径冲突。更改入口不会取消任何 API 身份校验；忘记地址时运行 `owner status`。后台使用 `Referrer-Policy: no-referrer`，避免从后台打开外站时带出入口。

账户记录包含登录成功、验证失败、退出、资料或密码变更、两步验证与恢复码操作、本机恢复、CLI 轮换和入口更改。数据库保留最近 1000 条，后台显示最近 100 条；记录采用固定事件名，不存密码、验证码、恢复码或完整会话令牌。

备份是独立目录，不是压缩包。内容、统计和业务数据库使用在线备份接口；复制期间统一阻止数据库写入和媒体删除，WAL 读取仍然可用，写入操作可能需要等备份结束后重试。普通文件逐项复制并记录 SHA-256；如果检测到文件被外部程序改动，或者媒体记录引用的文件缺失，本次备份不会生成成功清单。默认备份位置 D:\Tools\weava\backups。备份包括站点数据、媒体、由 `/site-assets/` 提供的 `public` 资源、自定义主题扩展和任务日志，记录框架版本；框架源码通过 Git 单独保存。已登记的共享依赖和可重建缓存不重复复制。

恢复必须先停止站点并等待独立任务结束。程序在整个维护期间持有排他占用，核对服务和任务进程，校验备份数据库及清单全部成员，只复制已校验文件，保存恢复前备份，再从旁边的暂存目录切换。旧目录保留为 retained 目录。恢复到全新目录同样支持。

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\restored backup verify --path D:\Tools\weava\backups\备份目录
scripts/run.ps1 --site E:\Code\WeavaSites\restored backup restore --path D:\Tools\weava\backups\备份目录
scripts/run.ps1 --site E:\Code\WeavaSites\restored backup recover
```

恢复日志保存在站点旁边的 .restore.json。文件占用或中断时保留暂存、旧目录和日志，使用 recover 核对恢复，不能直接删掉旧目录。缓存、历史修订、媒体、备份和旧构建没有自动清理策略；需要整理时先归档并核对。

恢复会核对备份选定的已安装程序，重新建立网站构建的依赖关联，并实际加载、检查专用页面和业务数据版本。缺少对应程序或依赖时不会报告恢复成功。在线备份不复制未完成上传的暂存字节，因此恢复后的这些上传会明确过期，相关未完成媒体任务以 409 结束；请重新选择文件上传，不能从旧偏移继续。原网站的上传进度不受影响。

恢复副本不会接管原网站的进程或自动重放其未完成命令，即使原进程仍在运行。复制来的备份、导入等任务会结束并提示重新发起；可继续的图片优化会重新排队，已有公开版本能证明完成的发布会记为完成。新任务和自动备份可在恢复站点正常执行，原网站的任务状态不变。

源码验证使用 `pnpm check` 检查 TypeScript、生成的 API 文档和 Astro 模板，`pnpm verify` 继续运行架构回归及编译后 HTTP 生命周期检查。HTTP 检查只编译测试服务，不生成或选择正式程序版本；缺少入口时不会默默跳过。`scripts/setup.ps1` 在 D 盘准备固定版本的模板校验工具，可通过 `WEAVA_VALIDATION_TOOLS` 指定位置；测试目录可通过 `WEAVA_TEST_OUTPUT` 指定，默认位于 `D:/Tools/cache/weava/tasks/architecture-repair-20261106`。已有相同源码的 HTTP 编译结果经校验后复用。

只验证备份资源、上传中断和托管升级恢复的 HTTP 链路时，可运行 `node --import tsx scripts/check-http.ts --recovery`；默认 HTTP 检查也包含这些用例。

## 历史维护

后台“历史归档”先按时间和至少保留数量预检，保护当前工作稿、当前公开版本、近期版本和定时计划需要的修订。执行时把旧修订、公开清单及所需不可变对象写到 `archives/history`，核对校验值后才从日常数据库移出。没有文件删除，媒体和完整备份继续保留。历史中用到的私密媒体仍受保护。

归档列表可查看内容、核对校验值并恢复到历史列表。恢复不会覆盖工作稿，也不会自动切换公开版本；需要时另选公开回退。数据库可用空间先在 SQLite 内复用，停机后 `maintenance compact` 创建数据库副本、整理空闲页并做完整性检查。完整实例备份包括所有归档。

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-site maintenance preview --before 2026-01-01 --keep-releases 20 --keep-revisions 20
scripts/run.ps1 --site E:\WeavaSites\my-site maintenance archive --input D:\Tools\weava\history-plan.json --wait
scripts/run.ps1 --site E:\WeavaSites\my-site maintenance archives
scripts/run.ps1 --site E:\WeavaSites\my-site maintenance restore --id 归档编号 --wait
```

## 独立程序版本与升级

程序版本可以构建到指定的新目录。它不是压缩包，也不复制站点内容。版本清单固定前台、后台、CLI、任务程序和检查程序；已存在清单的目录不能再次构建覆盖。运行依赖及其传递依赖、原生模块会复制到该版本内，逐文件记录校验值及内部目录关联。更新源码目录的依赖不会改变已保留的版本；校验发现版本文件变化时拒绝选择。旧的共享依赖构建需要重新构建后才能选用。源码 Git 提交仍单独管理。

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-site build --output D:\Tools\weava\programs\release-20261029
```

先停止站点，再检查升级。检查验证程序文件、Node/API/数据库兼容性，保存完整实例备份，在独立副本上执行候选程序和扩展迁移，并渲染当前公开内容。通过后返回计划文件。正式应用要求程序与实例资料仍匹配该计划；任何变化都要重新检查。应用会核对真实实例、迁移数据，再写入站点 program.json 选择版本，旧程序目录继续保留。

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-site upgrade check --program D:\Tools\weava\programs\release-20261029 --backup-root D:\Tools\weava\backups
scripts/run.ps1 --site E:\WeavaSites\my-site upgrade apply --input D:\Tools\weava\backups\upgrade-plan-编号.json
scripts/run.ps1 --site E:\WeavaSites\my-site start
```

`start` 使用已经选择的版本，后台显示程序与数据库版本。`upgrade verify` 校验独立构建；`upgrade status` 查看选择。失败时恢复检查前的实例，失败目录保留。突然中断后先执行 `upgrade recover`，按旁边 `.upgrade.json` 恢复；不会继续使用半迁移实例。

升级成功后确需连数据一起退回时，使用 `upgrade rollback --restore-data`。它明确恢复升级前的备份，升级之后的编辑留在 `.upgrade-retained-*` 目录，不会自动合入旧数据。恢复历史公开版本时，先用 `status` 找到版本编号，再用 `rollback --id <版本编号> --output rollback.json` 查看差异。确认后运行 `rollback --input rollback.json`。如果当前公开版本已变化，需重新预览。以上只在当前 Windows 平台验证。

服务退出、端口占用和任务异常会留下可读错误。任务日志位于站点 logs 目录，每项最多保留约 8 MB 输出；任务结果和错误独立保存。后台和 CLI 的 offset 单位是 UTF-8 字节，每页读取约 20 KB 并对齐字符边界。任务使用持久队列，默认最多同时运行两个，最多等待 128 个；统计报表与 WXR 预检也在任务进程计算。服务器开机自启可调用同一个 start 入口，由服务器既有进程管理负责，不将本机 Windows 验收当成服务器部署证明。

CLI `status --storage` 提供数据库、媒体、历史版本、已记录备份及未引用媒体的占用情况。需要更新扫描结果时，先运行 `maintenance scan --wait`。未引用判断涵盖内容工作稿、公开快照与作者历史；该检查只报告，不清理。单独编译新程序不替换正在使用的版本；对站点执行升级和数据迁移仍需停机。

有反向代理时设置 WEAVA_TRUST_PROXY=1，并用 WEAVA_TRUSTED_PROXIES 指定直接连接服务的代理 IP，多个地址用逗号分隔，默认只信任本机回环地址。只有受信任代理提供的 X-Forwarded-For 和 X-Forwarded-Proto 会影响互动额度、统计来源、登录限制及 HTTPS Cookie。未启用时始终使用直接连接来源和实际请求协议。

写请求在扩展调用之前检查来源，正式数据接口只接收 JSON。管理页面限制同源嵌入、脚本和连接，保留同源设计画布；响应禁止类型嗅探，敏感接口和已登录页面不缓存。后台列表和报表仅在当前登录会话的内存中短期复用，保存或发布后重新读取，退出或会话失效时清除。公开媒体在浏览器和 CDN 缓存一小时，登录状态不会禁用公开图片缓存；私密媒体仍验证权限并使用 private, no-store。公开 `/__health` 只提供就绪状态和公开版本编号；本机路径、进程编号须通过已登录会话或 CLI Bearer 令牌读取。意外服务错误只在服务日志记录细节，网页不显示本机路径。HTML 附件使用隔离沙箱，SVG 禁止脚本，PDF 等附件作为下载提供；上传会检查基础文件签名。

实例旁边的 `.access.sqlite` 记录网页服务、任务和统计连接的进程占用；恢复、程序升级、数据库升级、压缩和离线导入持有排他占用，期间新写入连接会被拒绝。这个协调库不进入备份，恢复换目录后仍使用同一个规范路径。正常重启允许服务与仍在运行的任务同时连接，不会把存活任务误判为中断；进程退出后的记录在下次准入时回收。不要手动改写占用记录。

`pnpm test:browser` 在 D 盘新建隔离实例并从当前源码构建，完成保存、预览、确认发布、访问、历史恢复和归档，同时检查日志分页、桌面及手机选择器和媒体分段读取。它不读取私人实例或密码文件，不修改真实站点；每次报告与截图均保留在命令输出的 `D:/Tools/cache/weava/foundation-*` 目录。
