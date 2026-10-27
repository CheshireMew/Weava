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

服务退出、端口占用和任务异常会留下可读错误。任务完整日志位于站点 logs 目录；后台和 CLI 通过 offset 分页读取。服务器开机自启可调用同一个 start 入口，由服务器既有进程管理负责，不将本机 Windows 验收当成服务器部署证明。

后台“空间占用”与 CLI `status --storage` 提供数据库、媒体、历史版本、已记录备份及未引用媒体的占用情况。未引用判断涵盖内容工作稿、公开快照与作者历史；该检查只报告，不清理。构建程序前应停止使用当前程序的所有站点，避免替换仍在使用的构建目录。
