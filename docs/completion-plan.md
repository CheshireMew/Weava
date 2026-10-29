# Weava 完善计划与验收记录

2026-10-29 后续 GEO/SEO 七项改进的范围、用法与独立验收记录见[搜索与内容改进](seo-improvements.md)。下文保留此前建站功能验收的原始范围和证据，不把历史测试数量当作新增能力的验证结果。

依据：2026-10-28 WordPress 源码对比，以及用户“按上面说的继续完善，彻底完成为止”的授权。目标是完整的轻量通用内容建站产品，保留博客、官网、作品集、文档和资源目录五种场景。采用单站主；本轮只验收 Windows。不开拓商城、多用户权限或多站点网络。未经另行授权不部署、不删除文件、不制作安装包。

当前基线：`75695a6`。该提交已包含前一轮审查之后新增的评论、点赞与数据库版本 2，实现时以当前代码为准并保留这些能力。

| 范围 | 完成条件 | 状态及证据 |
| --- | --- | --- |
| 发布正确性 | 设置独立发布；变更预览；日期、区块、引用与候选渲染检查；错误保留旧版本 | 内置模板、共享区域和扩展区块候选检查已实现；内容、设置、布局和分类独立发布已验证 |
| 发布存储与历史 | 不可变对象复用；搜索不随未改内容重复；旧版本迁移、回退、备份；归档预检与维护 | 已完成。对象/索引复用、版本 3 迁移、回退、历史归档、校验恢复、后台任务和离线整理通过；200 篇内容与 30 次发布的增长检查通过 |
| 查询、搜索与网址 | 页面区块正文可搜；页面/API/后台统一筛选排序分页；稳定内容链接；路径历史随版本回退 | 声明字段、类型校验、网页表单/后台/API/CLI 同条件分页已验证；稳定链接含锚点，原 WordPress ID 入口和路径历史已验证 |
| 分类与导航 | 稳定分类编号与 slug、层级、改名；关联选择；嵌套导航编辑和展示 | 层级管理、稳定编号选择、同名子分类、上级包含后代筛选、独立发布与回退已验证；嵌套导航保留 |
| 页面、模板与主题 | 模板实际生效；共用区域、可复用布局、响应式画布编辑；换主题保留页面内容 | 已完成。模板、共享区域、组合、字段绑定、实际画布、响应式列数、离页保存及换主题保留内容通过；文档目录与五类独立站点通过 |
| 编辑、媒体与修订 | 公用媒体/内容选择器；图片信息与展示编辑；表格编辑；历史查看比较与冲突恢复 | 公用选择器、信息编辑、裁切、引用、批量归档、表格增删行列及 Markdown 往返、版本正文/页面对比、冲突三方合并和刷新恢复已验证 |
| 定时任务 | 持久定时发布、取消、指定版本、重启补执行、失败可见且可重试 | 已完成。单元、正式构建任务、重开数据库、异步扩展最终渲染检查和真实事务进程中断验证通过 |
| 数据交换与 WordPress 迁移 | 可预检、原子导入、合并与设置；标准 WXR 入口，明确页面/类型/分类/区块的转换结果 | JSON 和标准 WXR 已验证；页面/类型/层级/评论/可复用区块/本地附件/来源功能报告；附件失败原子回退，过期预检拒绝，重复导入复用 |
| 扩展与程序升级 | 多扩展声明、依赖/启停/迁移/诊断；共享区块契约；程序与数据库升级检查备份恢复 | 已完成。扩展依赖/启停/迁移备份/失败回退/诊断、区块契约与异步整页渲染检查通过；独立程序校验、副本预检、版本选择、实际启动、备份回退和真实进程中断恢复通过 |
| 整体验收 | 五种网站真实浏览器操作；API/CLI；故障恢复；资源和数据增长；文档一致 | 已完成。98 项自动测试、TypeScript、正式构建全流程、五类独立网站和手机宽度、故障恢复、增长检查通过；证据及边界见下文 |

实现顺序按依赖推进；完成局部模块不等于总目标完成。每一范围需代码、针对行为的测试和实际入口证据，最终再逐项审计。已有真实站点数据只在有明确必要并已准备备份后才升级，开发验证使用 D 盘隔离实例。

## 已形成的实现与证据

- `packages/core/src/publication.ts` 统一发布候选与提交，`publication-store.ts` 保存去重的不可变对象和版本清单。设置范围不选择文章工作稿；发布摘要附带已查看的公开版本与工作稿编号，变动后拒绝继续发布。
- `packages/contracts/src/blocks.ts` 为内置区块提供共用属性定义。保存检查属性类型，发布检查必填值及实际区块渲染；正文、字段和区块中的内容引用在候选中检查。
- `query.ts` 为访客、后台与 CLI 提供相同查询和分页；`taxonomy.ts` 保留稳定分类关联；旧网址保存在公开版本中，回退同时恢复网址与内容。
- `exchange.ts` 为整个 JSON 导入预检、冲突检查与事务写入；`schedules.ts` 记录指定修订的定时计划，发布与完成记录处于同一事务，后续工作稿保持独立。
- 回归测试见 `tests/publication.test.ts`、`tests/exchange.test.ts`、`tests/schedules.test.ts`；既有评论、媒体、私密内容、备份、迁移测试继续保留。
- `scripts/foundation-check.ts --production` 在 D 盘独立构建并启动前台、后台与任务程序，使用真实 Chrome 验证公开 API、页面翻页、发布范围、定时任务与数据交换。不会替换共享 dist 或重启现有站点。
- 正式构建证据：`D:\Tools\cache\weava\foundation-1793206308715\results.json`，覆盖模板、画布、媒体编辑、表格、版本/冲突恢复、标准 WXR、扩展依赖/启停/迁移/区块编辑与任务渲染；全部通过，浏览器无脚本错误。
- 分类和声明字段筛选的正式构建证据：`D:\Tools\cache\weava\foundation-1793206965282\results.json`，网页表单分页、后台条件、公开 API、编译后 CLI、分类层级编辑与稳定关联、分类独立发布均通过。
- `scripts/schedule-interruption-check.ts` 已在真实子进程进入发布事务后终止该进程，重开数据库确认事务回退并只补执行一次。证据：`D:\Tools\cache\weava\schedule-interruption-1793197955319\results.json`。

## 最终验收（2026-10-29）

本轮约定的功能完善范围已完成。当前源码通过 18 个测试文件中的 98 项自动测试，原有迁移主题与来源服务故障测试保留；TypeScript 和 `git diff --check` 通过。测试输出为 `D:\Tools\cache\weava\final-unit-tests-20261029.txt`。

完整正式构建验收报告：`D:\Tools\cache\weava\foundation-1793209774803\results.json`。同一构建依次通过发布、API/CLI、模板画布、媒体表格、修订冲突、标准 WXR、扩展、分类筛选、历史归档、五类站点和程序升级。所有临时服务已停止，浏览器脚本错误为零。重复执行入口：

```powershell
node --import tsx scripts/foundation-check.ts --production --authoring --extensions --organization --maintenance --five-sites --upgrade
node --import tsx scripts/storage-growth-check.ts
node --import tsx scripts/schedule-interruption-check.ts
```

| 验收要求 | 当前证据 |
| --- | --- |
| 发布范围、日期和区块错误、失败保留旧版 | `tests/publication.test.ts`；报告 publicApi、invalidBlockRejected、browserSettingsPublication；extensions.asyncFinalRendererFailurePreservesRelease 检查异步整页渲染失败 |
| 模板匹配、绑定、共享区域、组合和主题切换 | `tests/layouts.test.ts`；authoring.canvas/layoutEditor/themeChangePreservesPage；五类站点分别读取 article、portfolio、documentation、resource 模板 |
| 媒体选择、信息、裁切、引用、批量归档 | `tests/media-edit.test.ts`；editing.media、richText；历史私密媒体及其副本的保护测试保留 |
| 表格与 Markdown、版本比较和冲突恢复 | editing.richText、conflictRecovery、revisions；源码模式/页面对照/新工作稿恢复、两个窗口修改及刷新后的浏览器恢复实际操作通过 |
| 查询、分类层级、稳定引用和旧网址 | `tests/organization.test.ts`、`tests/publication.test.ts`；organization、nestedNavigation、wordpress.internalAnchors；声明字段在网页/后台/API/编译 CLI 中一致 |
| 定时任务和中断恢复 | `tests/schedules.test.ts`；scheduledPublication；最新真实中断报告 `D:\Tools\cache\weava\schedule-interruption-1793209683769\results.json` |
| JSON/WXR 标准交换、预检和失败回退 | `tests/exchange.test.ts`、`tests/wordpress-wxr.test.ts`；wordpress 覆盖 CLI/后台/实际任务、附件、页面、层级、复用区块、评论、过期预检和来源功能检查 |
| 扩展声明、依赖、启停、版本迁移与诊断 | `tests/extension-lifecycle.test.ts`；extensions；失败迁移回退、启用失败恢复、停用引用检查及任务程序不重复启动服务 |
| 历史归档、恢复及程序升级 | `tests/history-archive.test.ts`、`tests/programs.test.ts`；maintenance、upgrade；真实编译程序启动和实际中断的升级检查进程恢复 |
| 博客、官网、作品集、文档、资源目录 | fiveSites 为五个独立数据库、端口和后台登录；逐一新建/保存/预览/发布/后续改稿隔离、字段、模板、分页、手机布局、SEO/RSS；文档还检查正文目录锚点与正文全文搜索 |
| 访客资源与长期数据增长 | 五类网站普通前台未加载后台、React 或 Lexical；示例首页交互脚本 913 字节；增长报告 `D:\Tools\cache\weava\growth-1793209297073\results.json` |

增长检查使用 200 篇内容，正文与 HTML 的不可变对象合计约 8.5 MB。连续 30 次设置发布后，文章对象保持 200 个、搜索记录保持 200 条；31 个版本清单合计约 432 KB。单篇改动只新增一个文章对象和搜索记录。归档与恢复不改变当前公开版本；本机设置发布耗时中位数约 704 ms，P95 约 736 ms。这是指定夹具的 Windows 本机测量，不是与 WordPress 生产性能的比较。

已同步使用、接口、迁移、扩展、架构、运行恢复及 README 文档。没有对真实实例执行升级或公网切换，没有删除文件、制作安装包，WordPress 原主题和插件程序不由 WXR 自动迁入执行；依赖来源功能的内容保留原始资料，检查后再发布。新的 UI 优化由另一个已授权聊天接手，不改变这里的功能验收范围。
