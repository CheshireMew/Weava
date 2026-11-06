# 前后端架构审查（2026-11-06）

下述为审查时发现的问题；20 项后续修复已全部完成，逐项处理和验证见文末“修复完成记录”。

审查对象为 `E:/Code/Weava` 当前工作树，分支 `main`，HEAD `0295040`，包含审查开始前已有的未提交和未跟踪代码。本次只检查和复现，未修复业务代码、构建程序版本或改变正式网站。

共记录 **20 项问题与缺口：6 项 P1、14 项 P2**。其中 16 项有定向复现或已有测试证据，2 项由调用顺序与状态生命周期确认，另外 2 项属于错误恢复和验证覆盖缺口。P1 表示应优先处理的数据丢失、启动隔离或恢复可靠性问题；P2 表示功能、性能、恢复体验或保障不足。

总体职责划分可以保留：React 管理后台负责编辑与交互，Astro 服务负责 HTTP 和公开页面，contracts 定义传输合同，core 处理数据和发布，工作进程承担任务，manager 管理网站进程与版本。主要问题发生在这些部分交接时：编辑内容与发布结果没有按版本衔接，数据库状态与文件恢复清单不一致，公开缓存没有真正保持不可变，专用网站路由没有进入统一的发布校验，任务错误和启动状态没有贯穿整个调用链。

本轮覆盖模块依赖、后台编辑与缓存、接口合同、公开查询与渲染、媒体与上传、发布与任务、备份恢复、网站 SDK、功能开关、托管与升级。结论针对当前源码和下述验证条件；未把以前文档中的问题原样当作现存问题，也不把本轮结果当作正式部署版本的运行验收。

## 优先处理的问题

1. **[P1，已复现] 笔记发布成功会清掉发布期间继续输入的内容。** [useContentWorkspace.ts:94](E:/Code/Weava/apps/admin/src/useContentWorkspace.ts:94) 在异步发布完成后直接 `editor.clear()`，没有检查当前记录是否仍是发布时的版本；[NoteEditor.tsx:22](E:/Code/Weava/apps/admin/src/NoteEditor.tsx:22) 的正文仍可编辑，busy 只限制按钮。复现中先开始发布，再输入新正文，完成前 `dirty=true`，任务完成后记录变成 `null`。应让完成回调绑定文章 ID、编辑代次和实际发布修订，保留发布期间的新稿，并明确显示它尚未发布。

2. **[P1，已复现] 尚未首次保存到服务器的新笔记，刷新后无法从本地副本恢复。** [useContentWorkspace.ts:47](E:/Code/Weava/apps/admin/src/useContentWorkspace.ts:47) 创建 revision 为 0 的本地记录；[useEntryEditor.ts:144](E:/Code/Weava/apps/admin/src/useEntryEditor.ts:144) 却必须先成功读取服务器记录，之后才读取本地草稿。新笔记在自动保存前刷新，服务器返回 404，恢复流程就结束；列表也不枚举本地独有的笔记。复现确认本地副本存在，但恢复记录为空，草稿读取次数为 0。应让草稿仓库支持枚举与本地独有记录恢复，先识别本地身份，再决定读取服务器和进行冲突合并。

3. **[P1，已复现] 多窗口未保存草稿相互覆盖。** [draft-repository.ts:63](E:/Code/Weava/apps/admin/src/draft-repository.ts:63) 按文章 ID 用单份新稿替换已有副本；[local-drafts.ts:9](E:/Code/Weava/apps/admin/src/local-drafts.ts:9) 又只保留最新一份。两个窗口的服务器修订冲突虽然受保护，浏览器恢复数据却没有窗口或编辑会话身份。复现中 A 窗口的未保存正文在 B 保存本地副本后消失。应按文章和编辑会话保存有界副本，确认服务器已接收相应内容后，只确认该会话对应的副本。

4. **[P1，已复现组件时序] 任务执行没有等待网站初始化完成，升级验证期间也可能提前领取任务。** [job-runner.ts:13](E:/Code/Weava/packages/core/src/job-runner.ts:13) 默认未暂停，构造函数立即开启 250ms 的 pump；[runtime.ts:25](E:/Code/Weava/apps/web/src/runtime.ts:25) 先构造它，到异步初始化完成后的第 40 行才暂停验证模式任务。扩展初始化超过 250ms 时就存在执行窗口。复现设置 `WEAVA_VALIDATION=1`、放入排队任务，尚未显式恢复就观测到 launch。HTTP 的 `ready` 也只用于健康响应，没有统一拦住普通入口。应默认暂停任务和普通请求，待扩展、构建、业务版本检查完成后，再统一进入正常服务或只读验证状态。

5. **[P1，已复现] 完整备份恢复不重建网站构建的依赖关联。** [site-files.ts:15](E:/Code/Weava/packages/core/src/site-files.ts:15) 正确跳过 `site-builds/<id>/node_modules` 关联以避免复制共享依赖，但 [backup.ts:107](E:/Code/Weava/packages/core/src/backup.ts:107) 的恢复流程只复制文件和检查主数据库，没有调用已有的依赖关联修复，也不检查专用网站能否启动。备份副本缺少该关联；在清除测试进程的全局 `NODE_PATH` 后，原构建能解析 sharp，恢复副本报 `MODULE_NOT_FOUND`。应从部署选择定位并核验已安装程序，重建清单登记的关联，完成实际构建加载检查后才报告恢复成功；缺少程序时应明确要求准备它。

6. **[P1，已复现] SEO 升级检查会漏掉专用网站图片失效。** [seo-check.ts:18](E:/Code/Weava/packages/manager/src/seo-check.ts:18) 把真实 `/_site/<build>/...` 地址归一成 `/_site/{build}/...` 用于比较，但 [seo-check.ts:40](E:/Code/Weava/packages/manager/src/seo-check.ts:40) 又拿归一后的地址发资源请求。受控 HTTP 复现中，两轮 HEAD 实际请求的都是 `/_site/%7Bbuild%7D/logo.png`，得到 404；即使升级后的真实图片也变成 404，报告仍然通过。应分别保存真实请求地址和归一后的比较标识，始终请求真实地址，再按比较标识关联升级前后的资源。

## 其它已确认问题

7. **[P2，已复现] SDK 直接暴露可修改的共享公开版本对象。** [site-sdk.ts:49](E:/Code/Weava/packages/core/src/site-sdk.ts:49) 把缓存中的 settings、content.get 结果及查询结果交给专用代码，类型和运行时都没有只读约束。复现通过一次请求修改文章标题，下一请求立即读到修改后的标题，数据库仍是原标题；这也会使已经生成的目录索引与对象内容不一致。应在公开版本边界提供真正只读的数据，或返回与缓存分离的视图，保证渲染代码不能改变跨请求快照。

8. **[P2，现有测试失败] 内容列表仍读取完整正文。** [query.ts:41](E:/Code/Weava/packages/core/src/query.ts:41) 对没有显式封面的内容调用 `store.get('entry', id)` 后提取图片，笔记也先读取正文再判断类型。列表响应虽不带正文，服务器仍解析当前页各篇完整内容。已有 `ARC-18` 测试在第 42 行报 `full body read`。应在保存或索引阶段维护列表需要的封面和摘要，列表查询只读取投影数据。

9. **[P2，已复现] 任务失败的状态码和详细原因在前后端之间丢失。** 核心 Job 有 `errorStatus/errorDetails`，但 [api-models.ts:30](E:/Code/Weava/packages/contracts/src/api-models.ts:30) 的 jobSchema 没声明它们；客户端解析会删除这两个字段。[api.ts:62](E:/Code/Weava/apps/admin/src/api.ts:62) 随后又抛出普通 Error。[useSettingsApplication.ts:50](E:/Code/Weava/apps/admin/src/useSettingsApplication.ts:50) 因而拿不到任务中的 409，不能执行为冲突设计的重试。复现确认任务状态码和最终异常状态码都为空。应统一任务错误合同，并保留结构化错误贯穿查询、轮询和调用者。

10. **[P2，已有测试及定向验证] 每次写操作都使全部后台查询两次失效。** [api.ts:34](E:/Code/Weava/apps/admin/src/api.ts:34) 在写入前失效所有查询，finally 再失效一次；[useAdminQuery.ts:20](E:/Code/Weava/apps/admin/src/useAdminQuery.ts:20) 对失效立即重读。文章自动保存因此会连带刷新 state 和列表，保存设置还会叠加显式 refresh。state 的 summary 仍包含类型、分类、布局、扩展等完整集合。应按操作声明实际影响的数据域，合并一次提交后的刷新，避免保存开始时先请求一份即将过期的数据。

11. **[P2，已复现] 退出登录网络失败后，后台查询会永久保持暂停。** [api.ts:33](E:/Code/Weava/apps/admin/src/api.ts:33) 在服务器确认退出前 suspend 缓存；失败分支没有恢复缓存或同步会话状态。[App.tsx:211](E:/Code/Weava/apps/admin/src/App.tsx:211) 保留原来的已登录状态，普通网络错误又不会打开重新登录提示。复现退出请求失败后，新的缓存读取持续返回“请重新登录后继续”。应把退出处理成明确的会话状态转换，失败后重新核实登录状态，再恢复读取或进入可操作的重新登录界面。

12. **[P2，已复现] 无版本号的专用静态资源也被缓存一年。** [site-render.ts:23](E:/Code/Weava/packages/core/src/site-render.ts:23) 同时处理带构建编号的资源和 `/logo.svg` 等根路径静态文件，两者都调用 [asset-response.ts:15](E:/Code/Weava/packages/core/src/asset-response.ts:15) 返回一年 immutable。复现 `/logo.svg` 响应为 `public, max-age=31536000, immutable`。网站更新同一路径的图片、文件或脚本后，浏览器可以长期不重新请求，ETag 也没有机会发挥作用。应仅对含内容散列或构建编号的地址使用 immutable，稳定根路径使用重新验证或生成版本化地址。

13. **[P2，已复现] 专用页面路由与内容发布校验使用两套网址规则。** [publication.ts:180](E:/Code/Weava/packages/core/src/publication.ts:180) 只认可公开内容路径、少数系统路径和跳转，不读取专用网站路由。复现专用渲染器访问 `/tools/` 返回 200，但文章链接到它时，发布报“内容或媒体引用无效”。应让运行时分发、站内链接校验和公开路由盘点读取同一个部署路由描述，明确动态路由的匹配规则。

14. **[P2，已复现检查窗口，调用链确认] 停用功能先检查引用，之后才停止网站。** [manager/index.ts:106](E:/Code/Weava/packages/manager/src/index.ts:106) 在停站前运行 checkFeatures，停止后直接写入新配置，没有再次检查。并发请求能在两者之间保存媒体或引用，最终让仍有使用者的媒体功能被停用，现有图片返回 404。定向验证确认第一次检查允许停用，插入并发媒体后，同一检查已不再允许。应在排空请求和任务、持有维护占用后执行最终引用检查，并把检查与配置切换放在同一维护过程内。

15. **[P2，调用链确认] 意外重启丢失显式启动端口。** [host.ts:39](E:/Code/Weava/packages/manager/src/host.ts:39) 支持启动时覆盖端口，但 [host.ts:51](E:/Code/Weava/packages/manager/src/host.ts:51) 的退避重启仅调用 `start(id)`；Managed 状态也没有保存本次端口。通过 `site start --port` 启动的网站崩溃后会回到 site.json 中的端口，原访问入口或代理失效。应保存本次经过验证的完整启动参数，并在自动恢复时复用。这里没有通过故意终止正式网站来验证。

16. **[P2，已复现差异指纹] 部分 SEO 差异无法通过下一次 --accept-seo 确认。** [upgrade.ts:48](E:/Code/Weava/packages/manager/src/upgrade.ts:48) 每轮加入含随机 operation 的 404 探测地址，第 55 行又把所有差异原样纳入 approval。若有意修改 404 页标题、正文或 canonical，差异里包含本轮随机地址；下一轮即使数据和程序完全相同，确认值仍会改变。受控相同前后页面差异的指纹验证得到两次 approval 不同。应为探测用例提供稳定的比较身份，随机请求地址保留为证据，不进入用户确认的差异身份。

17. **[P2，状态生命周期确认] 评论回复没有接入现有离开保护。** [Comments.tsx:15](E:/Code/Weava/apps/admin/src/Comments.tsx:15) 把正在输入的回复只保存在组件 useState；没有注册编辑 guard，也没有本地恢复。[App.tsx:186](E:/Code/Weava/apps/admin/src/App.tsx:186) 导航时只 flush 已注册的编辑器。输入回复后切换页面、切换另一条回复或刷新，正文直接丢失。应让回复草稿接入同一编辑会话和离开处理机制，按明确的取消或成功提交结束其生命周期。

18. **[P2，已复现] 完整备份保存了未完成上传的状态，却遗漏对应暂存文件。** [media-upload.ts:18](E:/Code/Weava/packages/core/src/media-upload.ts:18) 将分块数据保存在 `uploads/`，但 [site-files.ts:25](E:/Code/Weava/packages/core/src/site-files.ts:25) 没有枚举它。复现一份 4 字节文件上传了 2 字节后备份，备份数据库仍记载 receiving、offset=2 和暂存路径，清单里却没有该文件。恢复后客户端会尝试从 offset=2 继续，而文件不存在。应为备份建立明确的上传快照策略：一致地保存可恢复暂存，或在恢复阶段明确废止不具备文件的上传并让客户端重新开始，不能继续报告其可续传。

## 容错与验证缺口

19. **[P2，结构性风险] 后台大部分懒加载页面没有错误边界。** [AdminRoot.tsx:15](E:/Code/Weava/apps/admin/src/AdminRoot.tsx:15) 和 [App.tsx:281](E:/Code/Weava/apps/admin/src/App.tsx:281) 用 Suspense 处理等待，但没有处理 import 拒绝或面板渲染异常；现有 LexicalErrorBoundary 只包住富文本编辑器。更新后旧页面加载不到代码分块或某个面板抛错时，整个工作区缺少局部恢复入口，还可能连同编辑会话一起卸载。应在保留会话的工作区和独立面板边界提供错误恢复、代码分块重取与安全重载策略。本轮没有破坏真实构建文件来制造故障。

20. **[P2，检查范围已确认] 常规检查不能覆盖 Astro 模板和编译后 HTTP 生命周期。** [tsconfig.json:28](E:/Code/Weava/tsconfig.json:28) 只纳入 web 的 `.ts`，`pnpm check` 只是 tsc，未对 `.astro` 文件做模板类型检查。[http-lifecycle.test.ts:39](E:/Code/Weava/tests/http-lifecycle.test.ts:39) 没有 `WEAVA_TEST_WEB_ENTRY` 就跳过编译后服务测试，本次确实跳过 2 项；当前 GitHub 工作流也只有 star-history。因而 TypeScript 通过不能证明主题组件参数、实际响应结束、维护排空和功能 HTTP 门禁正确。应把模板检查及使用明确版本构建的 Windows HTTP 测试纳入固定验证入口，并让“未运行”在结果中明确可见。

## 验证结果与修复顺序

`node node_modules/typescript/bin/tsc --noEmit` 通过。本次只运行与架构边界有关的 10 个现有测试文件，共 **60 项通过、1 项失败、2 项跳过**，没有运行全量测试。失败项为 `tests/architecture-boundaries.test.ts` 的 ARC-18；两项跳过来自缺少编译服务入口的 HTTP 生命周期测试。第一组 6 个测试文件中 21 项通过、2 项跳过，四个核心测试文件中 39 项通过、1 项失败。

此外通过内存中的 React Hook、共享草稿仓库、真实 API 合同、独立 SQLite 测试站点、备份复制和受控 HTTP 输入验证了上述具体问题。没有下载或安装依赖，没有打包，没有修改或重启正式网站。组件时序复现不冒充完整部署进程验证，静态调用链和结构性风险已单独标明。

修复顺序应先覆盖 1—6：保证编辑中的内容不丢失，初始化与升级验证确实隔离持久任务，恢复结果可以启动，升级检查真正访问原资源。接着统一公开只读快照、路由描述、任务错误合同、草稿会话身份和备份成员清单，再处理列表投影、查询刷新范围与页面错误恢复。这样可以保留现有模块划分，同时把跨模块的行为规则收回到明确的边界中。

## 本次产物

新增最终文档为本文件。新增专用复现目录为 `D:/Tools/cache/weava/tasks/architecture-review-20261106`，约 1.84 MiB，保存小型站点、缺少依赖关联的恢复副本、未完成上传备份及失败复现资料；没有复制共享依赖，目录关联指向的已有依赖不计入占用。

复用现有测试另新增下列目录，未改写原有测试资料：

| 新增位置 | 占用 |
| --- | ---: |
| `D:/Tools/cache/weava/tests/architecture-1793947096753` | 16.42 MiB |
| `D:/Tools/cache/weava/tests/publication-1793947102761` | 6.08 MiB |
| `D:/Tools/cache/weava/tests/public-query-1793947105479` | 1.26 MiB |
| 既有 `D:/Tools/cache/weava/tasks/shared-runtime-20261105` 下本轮新增的 12 个 unit 目录及其 10 个占用协调文件 | 5.16 MiB |

上述磁盘复现和测试资料合计约 **30.75 MiB**，另加本审查文档及复用测试工具的少量缓存。没有执行文件删除；测试产物未取得删除授权。

本轮新增的 12 个 unit 目录编号为 `20e91270-f2f7-4791-bc10-b4c76c7aa6ac`、`4ff0b30e-d1f6-492f-b2f6-ac3253fc1538`、`609fbccd-7209-48a5-b44f-724055655a47`、`82e36d99-c1e6-4885-9e02-f6e3c587a1c4`、`a320a974-49c8-4944-851f-f0203a5e5a96`、`ac046295-335b-4523-82b3-62d0ecf48525`、`acc12d0d-b288-4c5b-ac38-06847b7d790e`、`bce4caef-9a5e-4319-9065-658f486567c4`、`cf9ca84b-544e-4566-9ddd-0f02cfb08c77`、`d7936b77-8566-477b-ad32-e213d8cff81b`、`f8ec3e8f-8682-4a75-9535-facbe44e361f`、`fffde7f9-4f9f-4074-9888-723bfea7d553`，名称均有 `unit-` 前缀。


## 修复完成记录（2026-11-06）

以上 20 项为修复前的历史审查结果。本节记录随后按用户要求完成的源码修复，不表示正式网站已升级。修复保留原有模块分工，没有内置 Agent，没有构建或选择正式程序版本，没有改动正式网站。

| 原问题 | 最终处理 | 验证依据 |
| --- | --- | --- |
| 1 | 发布完成按文章身份和编辑代次确认，继续输入的笔记保留并提示尚未发布。 | notes-ui：发布期间继续输入、切换另一笔记 |
| 2 | 本地仓库支持枚举；未首次保存的笔记可在列表恢复，服务器 404 不再截断恢复。 | notes-ui、draft-repository、entry-autosave |
| 3 | IndexedDB 与关闭窗口副本都带独立会话身份；只确认对应内容，容量满时拒绝新增并提示。 | draft-repository、local-drafts；baseRevision=0 的冲突合并 |
| 4 | 任务默认暂停；普通 HTTP 由 ready 门禁保护；initialize/resume 控制也等待完整初始化。 | architecture-repairs ARC-R04；编译 HTTP 两项启动时序用例 |
| 5 | 恢复前核验所选程序，重建登记的依赖关联，实际加载渲染器并检查页面和业务版本。 | architecture-repairs ARC-R05/12/13；core、managed-recovery |
| 6 | 真实资源地址与比较标识分开，始终请求真实构建图片，按稳定标识比较状态。 | seo-upgrade ARC-R06：两种构建真实 HEAD、升级后图片 404 |
| 7 | SDK 公开内容和设置使用深层只读视图，保留正文的按需读取。 | architecture-repairs ARC-R07；shared-runtime |
| 8 | 保存及类型更新维护列表封面投影；数据库版本 14 为旧数据重建，列表不读取正文。 | architecture-boundaries ARC-18；architecture-repairs ARC-R08 验证迁移及作者修订不变 |
| 9 | 任务 API 合同保留错误状态码和详情，waitJob 抛出同一结构的客户端错误。 | architecture-repairs ARC-R09；admin-cache-invalidation；settings-application |
| 10 | 写操作按数据域声明影响；写入期间阻挡旧结果，提交后合并一次刷新。 | admin-query-cache；admin-cache-invalidation；admin-navigation-performance |
| 11 | 退出失败后核实实际会话，仍登录则恢复读取，状态不明则提供重新登录入口。 | admin-cache-invalidation；account-ui、admin-dialogs |
| 12 | 仅含构建编号的资源使用 immutable，根路径文件采用 public, no-cache 和 ETag。 | architecture-repairs ARC-R05/12/13 |
| 13 | 部署路由描述共用于渲染分发、内容链接与跳转校验、公开网址盘点。 | architecture-repairs ARC-R05/12/13：静态与动态页面链接、未声明路径 |
| 14 | 停止并排空后，在维护占用内重新检查功能引用，并在同一过程切换配置。 | architecture-repairs ARC-R14：预检后新增媒体仍被最终检查阻止 |
| 15 | 托管进程保存本次端口、验证模式与探测令牌，意外重启复用相同启动参数。 | architecture-repairs ARC-R15：独立子进程退出后真实端口恢复 |
| 16 | 缺失页面探测身份由源数据与目标程序、构建确定，相同升级不受随机操作编号影响。 | seo-upgrade ARC-R16：两轮独立操作的确认值相同 |
| 17 | 评论回复加入编辑会话、关闭与离开保护和本地恢复；离开不会自动发布。 | comments-edit-session：取消离开保留、显式发布、原评论不在本页仍可恢复 |
| 18 | 在线备份不保存上传暂存；恢复明确废止复制的偏移与租约，并让相关未完成媒体任务失败。 | architecture-repairs ARC-R18：receiving/processing、关联任务409、原站不变 |
| 19 | 工作区及面板错误边界可重试失败分块；会话跨面板异常保留，安全重载先持久保存修改。 | admin-error-recovery；managed-autosave；admin-dialogs、admin-organization |
| 20 | 固定 check/verify 入口覆盖 TS、API文档、Astro模板和不可跳过的编译 HTTP 测试；增加 Windows CI。 | scripts/check.ts 通过，33个模板/TS文件0错误；当前编译 HTTP 4项通过 |

验证按修改范围分批复用现有测试。初轮架构回归中唯一失败是新增托管重启测试在健康检查完成前读取状态；补齐就绪等待后该项通过。随后新增的迁移、上传处理、评论恢复与启动控制回归均通过。最终源码的 TypeScript、API 文档一致性和 Astro 模板检查通过，编译 HTTP 的 4 项实际运行，没有跳过。没有把整仓全量测试或尚未运行的 GitHub Actions 描述为通过。

常规入口为 `pnpm check`、`pnpm test:architecture`、`pnpm test:http`，`pnpm verify` 依次组合这三部分。HTTP 编译仅服务于测试，缓存按源码指纹复用，不创建正式部署版本。模板检查器固定为 @astrojs/check 0.9.12 与 TypeScript 6.0.3，隔离安装在 D 盘，项目 TypeScript 版本保持原样。

现有数据库需要通过原有 `site update` / `site adopt` 流程显式迁移到版本 14；本轮没有擅自迁移已安装网站。

### 本轮新增目录与占用

以下清单仅包含本次“解决全部问题”目标开始后新增的测试材料；上文审查阶段的产物不属于此清理范围。目录关联不跟随、不计入共享目标体积，工具与共享运行环境不属于待清理范围。

| 本轮临时路径 | 占用 |
| --- | ---: |
| `D:/Tools/cache/weava/tasks/architecture-repair-20261106` | 53.678 MiB |

| 本轮临时路径 | 占用 |
| --- | ---: |
| `D:\Tools\cache\weava\tests\1793950784040` | 6.858 MiB |
| `D:\Tools\cache\weava\tests\architecture-1793950765440` | 16.416 MiB |
| `D:\Tools\cache\weava\tests\job-runner-1793950778526` | 1.482 MiB |
| `D:\Tools\cache\weava\tests\revisions-1793950790210` | 2.160 MiB |

| 本轮临时路径 | 占用 |
| --- | ---: |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-03de2233-8f02-4d04-8ce5-a99d62963173` | 0.000 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-75e30d61-894f-472d-b94b-c406a0df5b32` | 0.880 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-7ad90296-9ff4-4aaa-8151-51889e786eff` | 0.000 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-90e5c75d-bb55-47ca-ad23-72181b289844` | 0.001 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-e3a998ef-7a6a-4cbb-8027-f1df102d06ce` | 0.000 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-f5a120ad-7eb4-4015-908c-553a5babade6` | 0.430 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\recovery-f70a09a3-2b9e-40db-b42d-d34110016d8d` | 0.005 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-34664d3a-d906-4786-9434-f7893d003073` | 0.020 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-4dc67821-5227-4421-a975-95ec2c8e8c1b` | 0.418 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-4dc67821-5227-4421-a975-95ec2c8e8c1b.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-4e69c8a0-1a74-4365-a10d-9afb80056ef4` | 0.434 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-4e69c8a0-1a74-4365-a10d-9afb80056ef4.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-6af5a5c7-ecf8-4f91-b808-c50242c547ac` | 0.524 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-6af5a5c7-ecf8-4f91-b808-c50242c547ac.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-7524228a-b80c-4509-966f-3b83911a5591` | 0.867 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-7524228a-b80c-4509-966f-3b83911a5591.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-80c74bea-901d-49a1-a212-8bd70e1d4d37` | 0.434 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-80c74bea-901d-49a1-a212-8bd70e1d4d37.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-8c997b04-5275-4328-b428-6ec55434fd74` | 0.434 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-8c997b04-5275-4328-b428-6ec55434fd74.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-a61b34a2-b49e-4b3d-91a8-6744e3a48ba3` | 0.434 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-a61b34a2-b49e-4b3d-91a8-6744e3a48ba3.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-abc5fc45-8f72-44a6-8932-5a6d982080ae` | 0.609 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-abc5fc45-8f72-44a6-8932-5a6d982080ae.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-ba27878c-f61e-41de-a99f-7ac1f69d3dc9` | 0.434 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-ba27878c-f61e-41de-a99f-7ac1f69d3dc9.access.sqlite` | 0.012 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-ba6d6afe-6f26-4327-8ead-585c569c46c3` | 0.020 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-c820edf4-f375-425f-8c7f-d2b8d235cb2f` | 0.418 MiB |
| `D:\Tools\cache\weava\tasks\shared-runtime-20261105\unit-c820edf4-f375-425f-8c7f-d2b8d235cb2f.access.sqlite` | 0.012 MiB |

| 本轮临时路径 | 占用 |
| --- | ---: |
| `D:\Tools\cache\weava\tasks\seo-upgrade-20261105\snapshot-700c8544-2c5f-43ef-9b3d-4ee31d038658` | 0.880 MiB |
| `D:\Tools\cache\weava\tasks\seo-upgrade-20261105\snapshot-f1c547b2-59a5-4da3-99be-1b6178f172a1` | 0.880 MiB |

本轮临时材料合计 **88.83 MiB**。另新增持续使用的模板校验工具目录 `D:/Tools/weava-validation`，约 **60.23 MiB**；安装缓存使用现有 D 盘 npm-cache，少量测试与编译缓存复用既有目录。源码新增目录为 `scripts/validation`（固定工具清单和锁文件，约 41.52 KiB）；Windows 验证入口加入既有 `.github/workflows` 目录。未复制共享依赖、模型或用户媒体。用户已于本轮明确同意清理上述材料。清理前逐项核对实际绝对路径、目录内容、全部链接及进程占用，先移除关联本身，再用 PowerShell 明确路径逐项删除；36 个清单目标全部清理，释放约 88.83 MiB。源码、共享依赖、用户资料和 D 盘校验工具均保留。此表保留为已完成的清理记录，不表示这些目录仍存在。
