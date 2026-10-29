# 旧站迁移

## WordPress 标准 WXR

在 WordPress“工具 → 导出”取得 XML，可以在 Weava“运行与备份”中上传、预检并导入。标准导入支持文章、页面及父子路径、自定义内容类型、分类和标签层级、作者、日期、状态、附件、封面及普通评论。评论保留审核状态，回复按时间列表展示；回复关系与完整原始数据留在 XML。自定义分类和未声明的插件字段保留在来源资料中，并在转换报告说明。

段落、标题、列表、表格、图片、画廊、按钮、视频、分组和多列等转换为可编辑区块；可复用区块在引用位置展开。未知区块保留可用的静态 HTML，缺失的动态功能和短代码要求人工检查后才能发布。原始 WXR 保存在实例 `imports/wordpress-wxr/文件指纹/source.xml`，转换报告同时保存在数据库。WXR 不包含原主题、插件程序、菜单位置、全部服务器设置或媒体文件本身。

勾选下载附件会按内容散列导入本地媒体库，替换正文、封面及 WordPress 缩略图地址；未勾选时保留来源网址。重复导入相同来源复用已下载附件，已有不同内容必须选择合并并匹配当前修订。文件、选项或站点在预检后变化时，需要重新预检。附件失败会回退全部内容和媒体记录，已准备的文件继续保留。

离线 CLI 要求先停止目标服务：

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wxr --input D:\Data\wordpress.xml --download-media --dry-run
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wxr --input D:\Data\wordpress.xml --download-media
```

可用 `--media-dir D:\Data\wordpress-files` 代替网络下载，例如附件原网址为 `/wp-content/uploads/2026/photo.jpg`，则文件应位于该目录下同一路径。`--settings` 同时导入网站名称、说明和语言，目标域名继续使用本站设置。`--no-comments` 不导入评论；`--merge-revisions 文件.json` 提供合并对象的当前修订号。

标准导入不会自动发布。原私密内容继续私密，密码保护转为仅站主可见；原定时内容保留为带原时间的工作稿，需要在本站重新安排。`?p=`、`?page_id=` 和旧 slug 随公开版本保存为跳转，站内正文链接使用稳定内容编号并保留锚点。

## WordPress 博客

使用已下载并核对的 WordPress 内容目录。迁移命令先核对每篇 Markdown 和全部图片的 SHA-256，再保留原文章路径、作者、日期、分类标签、封面和可见性。原始内容与元数据归档于实例的 `imports/wordpress`，正文只改写链接与图片目的地址，保留可见文字。

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-blog init --password-file D:\Tools\weava\my-password.txt --port 4324
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wordpress --source D:\Data\wordpress-export\download --dry-run
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wordpress --source D:\Data\wordpress-export\download
```

公开文章保持公开，私密文章以仅站主可读的已发布内容保存，空自动草稿只保留原始资料。图片按内容散列去重并生成响应式尺寸，原上传地址、WordPress ID 查询链接和旧 slug 建立本地跳转。来源检查失败或目标内容已被人工修改时停止；重复导入相同资料不创建重复文章或新公开版本。运行迁移前停止目标实例。

迁移报告为 `imports/wordpress-migration-report.json`。`scripts/wordpress-check.ts` 核对所有文章原文可见文字、原路径、分类标签、封面校验值、图片 HTTP 入口及私密文章对访客的隔离。数据导入和本地预览不切换线上 WordPress。

WordPress 累计阅读量可独立导入，避免为更新计数覆盖已经编辑的文章或站点设置：

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wordpress-views --input D:\Data\wordpress-view-totals.json
```

输入格式为 `wordpress-view-totals-v1`，包含 `sourceId`、`capturedAt` 和 `entries: [{postId, views}]`。按 WordPress 原编号对应已经迁移的文章。导入前保存统计库副本，原快照及结果留在 imports；重复导入相同快照不会重复累计，较旧快照或同篇文章的其他重叠统计来源会被拒绝。历史累计浏览保存在独立计数表，不伪造访问日期、访客或每日趋势；热门排序使用历史累计加 Weava 新记录的浏览量。原文中的旧元数据仅作为档案，不再直接决定主题排序。

## WP Statistics

WP Statistics 的每日汇总、访客、地区设备及访问关系有独立的[迁移工具](wordpress-statistics.md)，与上述文章累计计数分开。工具默认只预检，支持生成只读服务器导出脚本、server-ops 响应校验、来源快照去重、备份与导入后核验；真实统计留到切换站点时再采集。

## 加密网站

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
