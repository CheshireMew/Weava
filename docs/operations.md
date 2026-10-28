# 运行、备份与恢复

本地和服务器使用同一份生产程序及站点数据。Node 服务同时提供 Astro 前台、React 后台静态资源及 API。默认监听 127.0.0.1，显式设置 HOST 可更改；服务器 HTTPS 可由已有反向代理提供。当前交付只在 Windows 验收，没有执行公网切换。

程序构建输出在 apps/web/dist、apps/admin/dist、dist。源码、站点数据库和媒体不放进公开静态目录；媒体通过受控路径响应。运行目录内的 runtime.json 记录本实例进程，不允许同一个实例并行启动。

```powershell
$env:WEAVA_FRAMEWORK='E:\Code\Weava'
$env:WEAVA_SITE='E:\Code\WeavaSites\demo'
$env:HOST='127.0.0.1'
$env:PORT='4322'
& 'D:\Tools\NodeJS\node.exe' E:\Code\Weava\apps\web\dist\server\entry.mjs
```

站主密码通过 CLI 设置或恢复。重置密码会使已有会话失效，不需要邮件服务：

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo owner reset-password --password-file D:\Tools\weava\my-password.txt
```

备份是独立目录，不是压缩包。内容数据库和统计数据库使用在线备份接口；普通文件逐项复制并记录 SHA-256。默认备份位置 D:\Tools\weava\backups。备份包括站点数据、媒体、自定义主题扩展和任务日志，记录框架版本；框架源码通过 Git 单独保存。

恢复必须先停止站点。程序核对运行记录，校验全部备份对象，保存恢复前备份，再从旁边的暂存目录切换。旧目录保留为 retained 目录。恢复到全新目录同样支持。

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\restored backup verify --path D:\Tools\weava\backups\备份目录
scripts/run.ps1 --site E:\Code\WeavaSites\restored backup restore --path D:\Tools\weava\backups\备份目录
scripts/run.ps1 --site E:\Code\WeavaSites\restored backup recover
```

恢复日志保存在站点旁边的 .restore.json。文件占用或中断时保留暂存、旧目录和日志，使用 recover 核对恢复，不能直接删掉旧目录。缓存、历史修订、媒体、备份和旧构建没有自动清理策略；需要整理时先归档并核对。

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

程序版本可以构建到新的独立目录。它不是压缩包，也不复制站点内容。版本清单固定前台、后台、CLI、任务程序、检查程序及依赖版本；已存在清单的目录不能再次构建覆盖。Node 依赖通过该目录的 node_modules 关联现有依赖，依赖版本改变后需重新构建检查。源码 Git 提交仍单独管理。

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

升级成功后确需连数据一起退回时，使用 `upgrade rollback --restore-data`。它明确恢复升级前的备份，升级之后的编辑留在 `.upgrade-retained-*` 目录，不会自动合入旧数据。普通内容回退使用后台公开版本切换，不能把程序回退当作内容撤销。以上只在当前 Windows 平台验证。

服务退出、端口占用和任务异常会留下可读错误。任务完整日志位于站点 logs 目录；后台和 CLI 通过 offset 分页读取。服务器开机自启可调用同一个 start 入口，由服务器既有进程管理负责，不将本机 Windows 验收当成服务器部署证明。

后台“空间占用”与 CLI `status --storage` 提供数据库、媒体、历史版本、已记录备份及未引用媒体的占用情况。未引用判断涵盖内容工作稿、公开快照与作者历史；该检查只报告，不清理。构建程序前应停止使用当前程序的所有站点，避免替换仍在使用的构建目录。
