# 旧站迁移

当前加密网站位于 E:\Code\crypto.blacknico.com，作为只读来源。迁移实例为 E:\Code\WeavaSites\crypto-blacknico。框架仓库没有复制文章、第三方媒体、原邀请码或统计数据库。

先运行一次隔离捕获：

```powershell
node --import tsx scripts/capture-crypto.ts E:\Code\crypto.blacknico.com D:\Tools\cache\weava\crypto-capture
```

捕获调用旧项目已有 Python 环境和渲染器，读取当前未提交的源码与内容，将参考网页、目录信息、规则和报告写入 D 盘；不会构建到原站 site 或写回原站报告。它前后比较来源文件的 SHA-256。Python 只用于这次旧站格式转换，不是 Weava 日常运行依赖。

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\crypto-blacknico migrate crypto --source E:\Code\crypto.blacknico.com --capture D:\Tools\cache\weava\crypto-capture --dry-run
scripts/run.ps1 --site E:\Code\WeavaSites\crypto-blacknico migrate crypto --source E:\Code\crypto.blacknico.com --capture D:\Tools\cache\weava\crypto-capture
```

迁移保留网址、稳定编号、公开状态、工作稿、历史、分类、图片、字幕、来源及统计。原创文章恢复为 Markdown 工作稿；来源文章为可编辑 HTML。原始文件另存在 imports/legacy。

为了保留已有视觉和复杂交互，旧页面使用明确标记的兼容布局。文章正文仍是独立可编辑内容，标题、导航和已发布内容引用在运行时更新；来源页面没有被截图或丢弃。普通新站使用原生通用区块。旧页面布局可以在页面搭建器中保留兼容区块，并逐步替换为通用区块。

公告、股票目录、邀请参数和视频地址处理由实例扩展承担。刷新失败保留上一成功结果；原始视频不复制到新站，播放器仍向来源请求临时地址。Stock+ 原有“目录未确认”的限制保持原样，不推测可交易清单。

迁移通过来源校验值避免重复导入。目标内容被站主修改后再遇到来源变化，会报告冲突并停止公开版本切换。站主应停止服务后运行迁移；修改过的站点扩展源码不会被迁移器无条件覆盖。

迁移报告位于实例 imports/migration-report.json。scripts/migration-check.ts 核对所有原网址、内部引用、目录锚点及来源文件。scripts/performance-check.ts 使用同一内容和 Chrome 条件做本机对照。真实来源接口的可用性另行记录，不用离线快照代替网络成功证明。
