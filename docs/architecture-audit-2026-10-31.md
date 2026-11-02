# Weava 前后端架构审查 · 2026-10-31

审查对象是 `E:/Code/Weava` 当前工作树，HEAD 为 `b3383510accd116aff48566ea5e28440194096c8`，包含开始审查前已有的全部未提交修复。发现 **22 项问题与架构风险：7 项 P1、15 项 P2**。其中 16 项经过隔离代码、HTTP 或真实 Chrome 复现，另外 6 项由源码确认其结构性风险；后者没有通过破坏现有构建或制造大量进程来验证后果。

主要问题集中在编辑状态、接口返回与实际提交的一致性、公开渲染与媒体权限，以及主服务承担的同步计算。Astro、React、core、contracts 和独立实例目录的总体划分可以保留；需要收紧这些边界，避免各功能继续各自实现一套保存、校验和恢复规则。

| 当前部分 | 实际职责 | 本次发现的薄弱点 |
| --- | --- | --- |
| `apps/admin` | React 后台、Lexical、页面画布 | 编辑会话、请求顺序和离开保护没有覆盖全部面板 |
| `apps/web` | Astro 页面、媒体、95 个后台操作及访客接口 | 手写分发与合同脱节；参数错误未统一处理；部分重工作仍在请求内执行 |
| `packages/core` | 内容、修订、发布、任务、存储、统计、维护 | 有些操作绕过共同校验；若干读取随全部内容或历史增长 |
| `packages/contracts` | 浏览器可用类型、Zod 和 API 客户端 | 已有统一声明，但声明与处理函数返回值之间没有编译期绑定 |
| CLI / worker | 外部工具入口和后台子进程 | 已有持久任务和幂等键，但缺少统一的工作进程并发上限 |
| 构建 / 程序版本 | 前后台文件、版本选择及回退 | 默认构建先移走有效产物；旧版本继续共享可变依赖目录 |

**P1 表示应优先修复的隐私、内容执行、编辑丢失、状态误报或明显阻塞问题；P2 表示功能一致性问题和需要治理的容量、恢复风险。以下均为本次审查结束时的未修复项。**

1. **ARC-01 · P1 · 私密媒体可通过另一种文件地址匿名读取〔HTTP 已复现〕。** [middleware.ts](E:/Code/Weava/apps/web/src/middleware.ts:59) 将原始 URL 交给权限判断，再将解码后的路径交给 Windows 文件系统；[Site.isPrivateMedia](E:/Code/Weava/packages/core/src/site.ts:300) 只做字符串集合匹配。隔离文件 `/media/secret.png` 返回 404，`/media/SECRET.PNG` 和 `/media/foo%2f..%2fsecret.png` 均返回 200 及相同私密内容。应先得到唯一的媒体文件身份，再用同一身份做权限与文件读取；需要涵盖 Windows 大小写和编码分隔符。双斜线请求在本次 Astro 实际链路中返回 404，没有把它计为成功绕过。

2. **ARC-02 · P1 · 导入内容能绕过正文清洗并在公开页面执行脚本〔Chrome 已复现〕。** [render.ts](E:/Code/Weava/packages/core/src/render.ts:198) 原样输出 `compatibility.props.html`；按钮等区块直接将网址写入 `href`，而 [blocks.ts](E:/Code/Weava/packages/contracts/src/blocks.ts:29) 只检查它是字符串。通过普通 Weava JSON 导入并发布的 `<script>` 实际执行；`javascript:` 按钮点击后也实际执行。触发前提是站主导入或保存该内容并发布。WXR 自己调用清洗函数，JSON 导入、保存和最终渲染没有同等边界。应在公共渲染边界清洗来源 HTML，并对所有区块网址使用共同的协议规则；确有脚本需求的可信扩展应有独立入口。

3. **ARC-03 · P1 · 回退已经成功，却向后台与 CLI 返回失败〔HTTP 已复现〕。** [Site.rollback](E:/Code/Weava/packages/core/src/site.ts:351) 提交后返回 `{releaseId}`，但 [admin-api.ts](E:/Code/Weava/packages/contracts/src/admin-api.ts:61) 声明返回完整 Release。[响应验证器](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:397) 因此返回 500。实测公开指针已切换，调用方却收到“网站返回数据与接口定义不一致”。应使处理函数返回类型与合同直接绑定，并增加真实 HTTP 回退测试，核对响应和提交状态一致。

4. **ARC-04 · P1 · 设置页能拿新版修订号保存旧内容，静默覆盖另一窗口的修改〔Chrome 已复现〕。** [SettingsPanel](E:/Code/Weava/apps/admin/src/main.tsx:1100) 只在 props 更新时替换 revision，没有一起处理 value。窗口 B 保存新站名后，窗口 A 点击当前“外观与导航”刷新状态，仍显示旧站名，却已得到 B 的修订号；A 再保存就覆盖 B，没有 409。应把值、来源修订和修改状态作为同一个编辑会话更新，收到远端变化时保留原基线并进入冲突处理。

5. **ARC-05 · P1 · 迟到的文章读取响应会覆盖当前编辑〔Chrome 已复现〕。** [select](E:/Code/Weava/apps/admin/src/main.tsx:282) 没有请求序号或过期响应检查。延迟 Alpha 请求、随后选择 Beta 并输入新标题，再放行 Alpha，编辑器退回 Alpha，Beta 的新输入消失。应给选择操作建立唯一序号，过期响应不能修改 record、dirty、保存基线或本地恢复状态，并在切换前统一完成当前保存。

6. **ARC-06 · P1 · 分类保存期间继续输入，会被返回的旧快照覆盖〔Chrome 已复现〕。** [TaxonomyManager.save](E:/Code/Weava/apps/admin/src/TaxonomyManager.tsx:10) 在响应后直接 `setSelected(row)`、`setChanged(false)`；输入框在请求期间仍可编辑。实测第一份修改发出后输入第二份修改，第一份响应返回就抹掉第二份输入，并显示为已保存。媒体说明保存也有同类写法，见 [MediaManager](E:/Code/Weava/apps/admin/src/MediaManager.tsx:34)。应复用文章保存时的快照比较和串行保存机制；本次实际复现的是分类面板。

7. **ARC-07 · P1 · 统计报表会长时间占用网站主线程〔隔离规模测试已复现〕。** [analytics-reports.ts](E:/Code/Weava/packages/core/src/analytics-reports.ts:155) 读取完整区间事件与相关会话，再在 JavaScript 中计算全部维度；[HTTP 处理器](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:368) 在网站进程中同步调用它。100,000 条合成 view 事件的一次报表计算耗时 **8,999 ms**，运行后进程 heap 约 269 MB；这不是线上容量数字或峰值内存。该同步执行期间同一事件循环无法处理正常请求。Newsletter 每个页面还通过 [viewTotals](E:/Code/Weava/packages/core/src/analytics.ts:206) 聚合全部历史浏览量。应以数据库聚合、可复用汇总数据和独立计算作业承担报表，访客页读取已计算的计数。

8. **ARC-08 · P2 · 面板离开保护只覆盖部分编辑器〔Chrome 已复现〕。** [navigate](E:/Code/Weava/apps/admin/src/main.tsx:301) 只保存文章及注册了 childSave 的面板；设置、类型、媒体、别名、组合发布计划没有共同的未保存状态。设置页输入后切换到内容再回来，新输入已经丢失。退出按钮也只调用文章 persist。应让所有可编辑面板注册同一保存、未保存检查和离开处理；支持明确放弃修改，并为需要恢复的编辑数据保留本地副本。

9. **ARC-09 · P2 · “正文引用”读取已过时的 document〔core 已复现〕。** [content-detail](E:/Code/Weava/packages/core/src/render.ts:149) 无条件渲染 `target.document`，而正常文章的 `entry-body` 在存在 blocks 时以 blocks 为准。实测目标的当前区块正文为新文本，引用页却输出旧 document。迁移后的文章也可能出现不同正文。应提取共用正文渲染函数，覆盖 document、blocks 和递归引用保护，并让引用校验与搜索采用相同来源。

10. **ARC-10 · P2 · 直接撤下内容绕过了完整发布校验〔core 已复现〕。** [Site.withdraw](E:/Code/Weava/packages/core/src/site.ts:325) 直接删掉公开快照中的成员并切换版本，没有经过 `preparePublication`。两篇文章互有必填引用时，正常撤下预检会拒绝；直接 withdraw 却成功，剩余文章继续引用已撤下对象。应让普通撤下、归档和计划撤下走相同的候选版本、引用、渲染校验与事务提交路径。

11. **ARC-11 · P2 · 合法保存的百分号编号无法正常读取〔HTTP 已复现〕。** [matchAdminApi](E:/Code/Weava/packages/contracts/src/admin-api.ts:133) 自行 `decodeURIComponent`；Astro 已解码的 rest 参数又参与匹配，处理器也有自己的解码。[ALL](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:400) 在错误响应之后再次匹配，解码异常逃出统一错误处理。编号 `percent%id` 能保存，编码后 GET 却返回 500 和 HTML URIError。应统一只解码一次，以匹配结果中的 params 调用处理器，并让匹配错误也返回合同内的 JSON 错误。

12. **ARC-12 · P2 · 无效访客查询参数会成为服务器错误〔HTTP 已复现〕。** [公开页面](E:/Code/Weava/apps/web/src/pages/[...path].astro:157) 和 [列表渲染](E:/Code/Weava/packages/core/src/render.ts:120) 将 URL 页码直接交给分页函数，没有将领域校验错误转换为 HTTP 响应。`/search/?page=NaN`、列表页 `?page=-1` 均返回 500。应在页面入口统一校验查询参数，返回明确的 400 或采用明确的规范化策略；不能把错误页码或字段条件当作内部故障。

13. **ARC-13 · P2 · Windows 大小写差异绕过备份目录限制〔core 已复现〕。** [createBackup](E:/Code/Weava/packages/core/src/backup.ts:17) 以区分大小写的字符串判断备份是否位于实例内。将实例 `media/backups` 的路径转成小写后，备份被接受，实际仍写进原实例的 media 目录，还把正在形成的备份成员再次纳入复制。后续备份会继续包含旧备份。应复用规范实例身份与真实路径包含判断，在创建目标前拒绝实例自身及后代目录。

14. **ARC-14 · P2 · 同批合法的模型与内容变更因中间状态失败〔core 已复现〕。** [importSite](E:/Code/Weava/packages/core/src/exchange.ts:97) 先调用 saveType，再导入同批 entry；[saveType](E:/Code/Weava/packages/core/src/site.ts:128) 此时仍校验数据库中的旧内容。将一个 number 字段改为 text，并在同一批把文章值由 `1` 改为 `"one"`，提供正确修订仍被拒绝。最终组合本可合法，但导入顺序无法表达它。应先构造整批候选模型和内容，验证最终组合，再在事务中核对修订并写入，保留真正冲突与不合法组合的拒绝机制。

15. **ARC-15 · P2 · 默认构建会先移走有效运行文件〔源码确认的架构风险〕。** [build.ts](E:/Code/Weava/scripts/build.ts:14) 在任何编译成功前就把三个当前输出目录改名；后续失败没有自动恢复。未指定独立输出目录的构建失败，会使默认 start 缺少入口，运行服务按原路径读取的后台资源也会消失或逐步混入新版。应先在独立目录完成前台、后台和 worker 编译与核验，成功后才统一选择该版本，并为切换失败保留恢复路径。本次没有执行破坏现有输出的构建探针。

16. **ARC-16 · P2 · 保留程序目录不足以保证旧版本可回退〔源码确认的架构风险〕。** [build.ts](E:/Code/Weava/scripts/build.ts:77) 让每个版本的 node_modules 链接到同一个当前依赖目录。[verifyProgram](E:/Code/Weava/packages/core/src/programs.ts:18) 只能发现部分直接依赖的 package.json 变化，无法冻结运行所需的完整依赖。一次正常依赖更新就可能使所有旧版本拒绝启动，或在未被清单覆盖的传递依赖、原生文件变化后运行不同代码。文档已经说明共享依赖的限制，这里将其列为恢复能力的既有风险。应为每个版本固定可恢复的完整依赖集合，或固定内容寻址且不可变的依赖环境。

17. **ARC-17 · P2 · 耗时任务没有统一的并发和输入资源预算〔源码确认的架构风险〕。** [execute](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:35) 对每个领取成功的任务立即 spawn；数据库只限制一个 publish，其他媒体、裁切、备份等可以不断增加子进程。WXR 接口又在启动 worker 前执行全量转换与 dry-run 导入，见 [导入入口](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:209)。媒体也先在主服务解析 JSON、解码 base64 才检查 32 MB。当前安装的 Node adapter 默认请求体上限是 1 GB，不能视为业务级预算。应采用持久任务调度、有限 worker 数及各操作的输入上限，耗时预检也应使用作业执行。本次没有制造进程洪峰。

18. **ARC-18 · P2 · 多个“分页”接口仍完整读取全部内容〔源码确认的容量风险〕。** [queryDrafts](E:/Code/Weava/packages/core/src/query.ts:9) 先通过 `site.entries()` 读取一次全部记录，再 list 一次全部完整 entry，筛选和排序之后才 slice；[媒体查询](E:/Code/Weava/packages/core/src/media.ts:14) 也一样。后台每次 refresh 的 [state?summary=1](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:219) 只省略 entry，仍携带全部媒体、公开版本、计划等。界面每页 25 项并没有限定数据库读取或响应成本。应增加面向列表的查询投影、SQL 分页与索引，按面板读取数据；完整不可变公开版本可继续服务需要快照一致性的渲染路径。

19. **ARC-19 · P2 · 日志分页没有限制服务器读取量〔源码确认的容量风险〕。** [logs](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:353) 每次同步读取完整日志，随后才截取 20,000 字符。已有日志窗口解决了“看不到后半段”的问题，但大日志每翻一页仍会完整读入主服务内存并阻塞事件循环。worker 还直接把完整 result 写进日志。应定义稳定的日志游标或索引，只读取当前页所需字节，正确处理 UTF-8 边界，并约束任务输出量。

20. **ARC-20 · P2 · 媒体权限重建随全部历史增长〔源码确认的容量风险〕。** [isPrivateMedia](E:/Code/Weava/packages/core/src/site.ts:257) 用全局最大 revision 使缓存失效；任何对象保存后，下一次媒体访问都会读取私密修订、加载每个历史公开版本，再遍历媒体与派生关系。即使修改的是无关设置，也会承担这个成本；嵌套 filter/find 还使媒体关系计算进一步增长。应把媒体身份和引用关系持久化或增量维护，以相关变更更新权限，保留历史私密保护，而不是让媒体请求重新扫描站点历史。

21. **ARC-21 · P2 · 公开登录接口同步计算密码且没有限速〔core 已复现，HTTP 调用链源码确认〕。** [Site.login](E:/Code/Weava/packages/core/src/site.ts:379) 使用 scryptSync；[登录接口](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:162) 没有尝试频率或并发限制。20 次错误密码在本机同步占用约 667 ms，所有尝试均继续进行密码计算。公开部署时，失败登录流量可以持续占用整个站点的事件循环。应在昂贵计算前限制失败尝试，并使用有并发预算的异步密码校验。

22. **ARC-22 · P2 · 反向代理身份与协议处理不统一〔HTTP 已复现，部署影响由源码确认〕。** [访客互动](E:/Code/Weava/apps/web/src/pages/api/[...route].ts:108) 使用 context.clientAddress；只有统计接口额外处理 `WEAVA_TRUST_PROXY`。当前 Astro 配置没有 allowedDomains，安装版本的 adapter 不会因此信任转发地址和协议。实测开启该变量后，两个不同 X-Forwarded-For 地址仍进入同一个点赞限速桶。反向代理后的真实访客可能共享评论和验证码额度；登录 Cookie 的 secure 又依赖未统一解析的 url.protocol。应明确代理信任边界并集中解析客户端地址、外部协议和主机，让统计、互动与登录使用相同结果。本次未进行公网或 HTTPS 部署验收。

修复顺序建议先处理 ARC-01～07，再统一编辑会话与发布操作入口，随后处理读取和任务预算，最后完善构建及依赖回退。前端可以用共用编辑会话管理值、基线修订、未保存状态、请求顺序与保存中的后续输入。后端可以用按操作类型绑定的处理器消费 contracts，并让发布、撤下和计划操作共同消费同一个候选版本校验。现有 worker 与 SQLite 已具备基础，不需要为这些问题增加产品内 Agent、外部队列服务或拆成多套服务。

**验证与证据。** 本次 `tsc --noEmit` 通过；Vitest **32 个文件、190 项测试全部通过**；API 文档生成器 `--check` 通过。以上结果表明现有检查通过，并未覆盖本报告列出的错误行为。特别是现有合同测试检查接口是否声明、文档是否同步和客户端是否校验，没有把回退等真实处理结果逐一同合同核对；`tsc` 的 include 也不包含 `.astro` 模板。本次另外启动当前源码的 Astro 服务、编译隔离后台测试资源，并通过本机 Chrome 验证编辑行为和公开脚本执行。

| 证据 | 内容 |
| --- | --- |
| [results.json](D:/Tools/cache/weava/architecture-audit-20261031-01/results.json) | 媒体匿名访问、回退误报、设置覆盖、切换丢稿、文章选择竞态、旧正文引用 |
| [followup-results.json](D:/Tools/cache/weava/architecture-audit-20261031-01/followup-results.json) | 分类保存丢稿、无效页码、百分号编号、备份目录、同批模型导入、撤下引用、统计规模计算 |
| [render-results.json](D:/Tools/cache/weava/architecture-audit-20261031-01/render-results.json) | 导入 HTML 脚本执行、javascript 按钮、代理限速桶、同步密码计算 |
| [probe.mts](D:/Tools/cache/weava/architecture-audit-20261031-01/probe.mts) | 第一批隔离复现脚本 |
| [followup.mts](D:/Tools/cache/weava/architecture-audit-20261031-01/followup.mts) | 数据与编辑并发复现脚本 |
| [render-probe.mts](D:/Tools/cache/weava/architecture-audit-20261031-01/render-probe.mts) | 公开渲染与代理复现脚本 |

验证只涉及 Windows、本机当前源码与新建的 D 盘测试实例；没有把开发模式结果当作线上或生产构建验收。报告中的规模数字是一次合成输入的观测。站点正式数据与已有业务代码没有修改，先前未提交修复保持原状；本次仓库只新增此报告。没有删除文件、安装依赖、制作发行包、提交、推送或部署；本次启动的测试服务和浏览器均已退出。测试目录保留供复查。
