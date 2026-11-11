# 搜索与内容改进

本次获准范围是前次研究的七项改进，保持 Weava 通用建站框架、外部 Agent 操作和既有修订发布体系。参考项目只用于机制学习，代码由 Weava 原生实现。

| 编号 | 用户结果 | 正式所有者与消费者 | 验收状态 |
| --- | --- | --- | --- |
| W1 | 分页规范地址与搜索、筛选索引策略 | core SEO → 两个内置主题、扩展 | 完成：规则测试、真实分页与筛选 HTTP 输出 |
| W2 | 统一元信息、按内容语义生成结构化数据 | contracts/core → 编辑器、类型、设置、主题 | 完成：两主题、扩展整页、软件与 FAQ 实测 |
| W3 | 可解释、带覆盖与版本的站点检查 | core → 预检、后台、CLI | 完成：版本失效、未知覆盖与实际分页发现 |
| W4 | 单篇读取、检查及按已预检修订发布 | 既有 API/发布事务 → CLI | 完成：编译 CLI 读取、拒绝过期、重新预检发布 |
| W5 | 所有公开页面的来源和关键动作统计 | analytics → 后台、API、CLI | 完成：来源口径测试、页面和业务成功事件实测 |
| W6 | 内容来源、核验日期和待确认信息 | 内容修订 → 编辑器、正文、JSON-LD、检查 | 完成：浏览器编辑、状态失效、核验和发布回读 |
| W7 | 可选搜索数据与 AI 观测接入 | 标准导入与连接器 → 统计、后台、CLI | 本机实现完成：三连接器协议测试、实际导入；真实账号未接入 |

停止位置：当前 Windows 上的本机目标测试、类型检查、构建与正式 CLI/API/浏览器链验证。不会购买额度、创建外部账号或发送平台采样问题；凭据与真实平台效果分别记录为外部证据。源码与测试写入当前仓库；隔离站点、浏览器和运行证据使用项目既有的 D 盘工作根，保留且不删除。

验证采用当前 Node 24、项目锁定工具和根级配置。顺序是类型检查、目标测试、受公共合同影响的原测试、构建及隔离真实用户链。各阶段失败只补跑受影响检查。查询到公开仓库尚无 Actions 运行，因而没有最近完成的远端失败可消费。其它平台、公开部署和真实排名提升不属于本轮本机验收。

## 页面与检查策略

`packages/core/src/seo.ts` 是元信息真源。单篇显式设置优先于扩展默认值、内容类型与网站默认值；普通标题、摘要和封面仍是未覆盖时的来源。两个内置主题及整页扩展 render 使用同一 head 输出与索引策略。FAQ 来自实际输出的问答，来源引用只使用当前有效的编辑者核验记录。Product 等语义只声明页面类型，不会凭空补价格、评价或商品信息，也不保证搜索引擎授予富媒体结果。

列表分页使用自身规范地址，例如 `/?page=2`，保留该页面实际列表声明的 pageKey。追踪参数不进入规范地址；搜索、筛选、排序、无效或重复分页参数使用 noindex,follow，预览与私密内容使用 noindex,nofollow。普通内容页不会因为带上任意 page 参数而成为可索引的分页。Newsletter 归档采用自己的分页入口。

HTTP 检查最多请求 200 个地址，并发 4 个，每次读取最多等待 8 秒、内容上限 2 MB；先读取公开内容入口，再跟随相同站点公开路径的上一页、下一页。未读取或超预算的页面保持未知，链接发现不完整时不判断孤立页面。生成检查适合待发布内容，实际 HTTP 检查还能发现最终主题和响应差异。报告包含规则版本、公开版本、修订、证据、覆盖和操作建议；内容、设置、扩展文件、启停配置或日期变化后标为过期。它不会把机械分数当作搜索排名或 AI 引用概率。

## 外部 Agent 的正式入口

在已运行的站点上通过现有脚本调用：

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo content get --id article-id
scripts/run.ps1 --site E:\Code\WeavaSites\demo seo metadata --id article-id
scripts/run.ps1 --site E:\Code\WeavaSites\demo seo audit --http
scripts/run.ps1 --site E:\Code\WeavaSites\demo publication preview --id article-id --output D:\Tools\weava\review.json
scripts/run.ps1 --site E:\Code\WeavaSites\demo publish --input D:\Tools\weava\review.json --wait
```

保存仍使用完整 `{value,revision}`。修改已核验的说法、名称或来源地址后，服务端强制退回 pending；回读保存结果、实际核对内容，再在后一次保存中确认 verified。发布沿原有修订与公开版本事务，不增加第二套发布状态。过期发布预检会失败，不能静默改成发布最新工作稿。

## 可选数据连接

连接器在 CLI 进程中按需执行，框架不保存访问令牌、DataForSEO 密码或常驻模型服务。先在仓库外准备本地 JSON，再运行 `search-data plan --config 文件`，确认请求计划后运行 `search-data pull --config 文件 --output 数据集.json`；pull 获取并校验数据后通过正常 API 导入，output 只包含数据。凭据需要由站主从服务商取得，过期时在该本地配置中更换。

| provider | 必要配置 | 数据与边界 |
| --- | --- | --- |
| gsc | property（如 sc-domain:example.com）、accessToken、start、end | Search Console 最终数据，page/query/date/country/device 维度；maxRows 默认 1000、上限 10000；受平台筛选、延迟与隐私限制 |
| ga4 | property（数字资源编号）、accessToken、start、end | 页面地址、日期、渠道、sessions、keyEvents；maxRows 上限 10000；sessions 不称作页面浏览量 |
| dataforseo | property（完整目标站点 URL）、login、password、keywords、locationCode、languageCode、maxRequests、allowPaid:true | Google 即时自然结果；device 为 desktop/mobile，最多 100 个明确请求；start/end 必须都是当天 UTC 日期 |

DataForSEO 计划不请求服务，费用估计为 null，并明确费用由服务商定价和账户决定；maxRequests 是请求数上限，不是金额上限。执行前需要显式 allowPaid，去重后一个关键词发一次请求，不自动重试；即时结果只取前 100 项，rank:null 表示未见目标域名。发生部分失败时立即停止，CLI 非零退出并在 `details.partialDataset` 保留已经取得的数据和已知费用；失败请求也可能计费。可把这份数据按标准 import 保存，修正连接后仅查询尚缺的关键词。

接口协议依据：[Search Console query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)、[GA4 runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)、[DataForSEO Live Advanced](https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/)。本轮只做协议与本地存储测试，没有使用真实账号或付费额度。

## 数据集合同与观测

所有数据集包含 `version:1`、唯一 id、provider、property、start/end（YYYY-MM-DD）、collectedAt（带时区时间）和 rows；可选 language、expectedSamples、notes。相同 id 和相同内容可重复导入，内容变化必须换 id；数据行需落在声明窗口内，重复行被拒绝。每批最多 10000 行。实现真源是 `packages/core/src/search-data.ts` 的 searchDatasetSchema。

| kind | rows 必要字段 |
| --- | --- |
| search-performance | url、date、clicks、impressions；可选 entryId、query、country、device、position |
| web-analytics | url、date、sessions、keyEvents、channel |
| keyword-rank | keyword、country、device、date、rank（正整数或 null）；可选 url、searchVolume |
| ai-observations | id、platform、model、query、answer、citations（URL 数组）、observedAt、locale、collectionMethod、panelVersion、status |

AI 观测的 collectionMethod 为 browser/api/manual，status 为 answered/failed。外部 Agent 或人工在真实平台采样后导入；Weava 不代替它们调用模型。报告保留问题、答案、引用和时间，按平台、模型、语言、采样方式、问题面板版本分组，显示计划、实际、缺失和回答中的本站引用率；API 观测与浏览器界面观测不会混算。无连接、空批次、失败回答和未取得样本都有明确状态，不能据此声称全平台可见度。

```json
{
  "version": 1, "id": "manual-panel-20261029",
  "kind": "ai-observations", "provider": "manual", "property": "https://example.com",
  "start": "2026-10-29", "end": "2026-10-29", "collectedAt": "2026-10-29T12:00:00+08:00",
  "expectedSamples": 2,
  "rows": [{
    "id": "q1", "platform": "实际采样平台", "model": "实际可见版本", "query": "实际问题", "answer": "保留的原始回答",
    "citations": ["https://example.com/article/"], "observedAt": "2026-10-29T11:58:00+08:00",
    "locale": "zh-CN", "collectionMethod": "manual", "panelVersion": "v1", "status": "answered"
  }]
}
```

## 统计口径

所有实际公开内容页，包括普通页面、文章和整页扩展，加载同一访客统计。sources 根据外部来源域名、已记录的来源名称或链接来源参数归类。缺少归属证据的访问只计入全站流量。actions 是业务成功边界发送的具名事件，浏览和点击各自计数。访客事件与缺失页面统计共用自动访问识别规则，涵盖已知搜索爬虫、AI 代读、链接预览和常见自动化客户端。“访问统计 → 行为 → 爬虫请求”按声明身份汇总请求及成功抓取的不同公开页面，展开可查看网址和 HTTP 状态。来自 AI 平台的读者点击仍计入访问来源。AI 回答的引用需用平台提供的数据另行核对。

迁移自 WordPress 的 robots.txt 如果已声明旧地图，会同时发布当前 /sitemap.xml 的入口。旧地图索引和抓取规则仍可使用。当前地图列出可索引的规范地址和修改日期，帮助搜索服务发现旧地图未覆盖的内容。

## 本轮验收记录（2026-10-29）

当前 Windows / Node 24.22.1 / pnpm 12.4.2 下类型检查通过；15 项 SEO 目标测试通过，覆盖 URL 策略、类型与可见 FAQ、来源有效性、不可变报告和失效、数据与指标分组、三种连接器的线协议、付费拒绝及部分恢复、扩展合成与分页预算。受影响的既有核心、发布、隐私、布局、扩展、交换、修订及历史统计共 58 项测试通过；未执行无关的全仓或跨平台矩阵。

正式构建的真实链报告为 `D:\Tools\cache\weava\seo-1793277023909\results.json`，使用 `D:\Tools\cache\weava\seo-1793276968695` 的编译前台、后台、任务程序和 CLI。HTTP 读取 36 个公开内容入口及 2 个分页地址，排除 1 个私密条目；Chrome 实际保存 SEO 与来源、核验失效再确认、发布、切换主题、执行检查与导入观测，CLI 拒绝过期预检并通过新预检发布。统计经过真实浏览器采集器与服务端存储，首页、文章、扩展页、成功点赞及声明爬虫分别回读。1440 与 390 宽截图已打开检查，浏览器脚本错误为零，所属服务已停止。

末次付费布尔值严格校验通过目标测试；最终源码的独立构建为 `D:\Tools\cache\weava\seo-final-build-1793277131833`，构建通过，公开 UI 与已验收构建一致。最后一次差异空白检查通过。执行中出现的夹具数量断言、异步状态等待和核验确认顺序问题均已修正，失败目录保留；最终通过报告不混用失败结果。

重复验证入口（需要当前项目依赖与 Node 24）：

```powershell
pnpm check
pnpm test -- tests/seo.test.ts
node --import tsx scripts/seo-check.ts
```

已同步 authoring、interfaces 和 extensions 文档。本轮完成本机实现与上述证据，未部署、未提交或推送、未打包；真实 GSC/GA4 账号、DataForSEO 额度、外部 AI 平台采样和搜索排名变化仍属于未取得的外部证据。没有把这些未知项改称通过，也没有内置 Agent 或模型服务。

## 2026-11-11：不改变页面布局的后续改进

本轮只修改网址、页面 head、公开响应、检查任务及 CLI/API。后台和正文不新增面板或内容；专题、正文内链、可见面包屑、搜索与分享预览仍需另行设计。

分页策略现在识别实际使用的内容列表、共享区域列表、随笔时间流、Newsletter 归档和 Library catalog。资源目录的 `?page=2` 与 `/page/2/` 统一声明后者为首选网址；普通不分页的 collection 展示不因此成为可索引分页。合法分页使用自己的规范网址，超出实际页数返回 404，搜索及任意筛选参数保持 noindex。文档已有层级导航同步生成 BreadcrumbList，不另加可见导航。

站点地图使用统一元信息生成器及当前启用扩展的 canonical/indexable 结果。私密、noindex 及声明其他首选地址的条目不进入主 sitemap；lastmod 使用条目自身修改日期，不再在没有条目日期时套用整站发布日期。生产模式已知公开内容的缺失尾斜杠地址跳转到标准路径；通过非首选主机或协议访问时跳转到已配置域名。本机回环访问保留在本机，HTTPS 代理须沿用运行文档中的代理信任配置，避免错误协议判断。

HTTP 检查规则版本升级为 3。正式复用任务服务与独立 worker 使用同一业务入口。每批默认 200 个地址、上限 1000，并发 4，每个响应最多 2 MB、8 秒；从 robots.txt、sitemap 索引、公开内容、专用静态路由及实际页面链接发现地址，总发现上限 50000。`crawl.pending` 是未读取地址，`crawl.complete` 只表示本次发现队列已读完；请求失败仍然保持未知，不能据此宣称检查全部通过。续查继承已检查页面的摘要证据，重新计算跨批重复页面和内链关系，不在每份报告中保存整页 HTML。

检查新增 X-Robots-Tag、Googlebot 元标签、robots.txt 抓取冲突、地图与索引策略冲突、规范地址目标的实际响应，以及面包屑、文章、视频、FAQ 的基础结构检查；FAQ 还会与可见正文核对。对动态自定义路由，只有清单登记或实际链接能够证明它存在；不声称能穷举任意程序可以生成的全部网址。

网站 `seo.templates` 和内容类型 `seoTemplates` 支持可选 `title`、`description` 模板，变量为 `{title}`、`{description}`、`{siteName}`、`{type}`、`{author}`、`{page}`。内容类型覆盖网站模板，单篇显式搜索字段优先；模板在生成元信息时应用，不批量改写文章。通过现有 settings/types API 保存后沿现有发布流程生效，未配置时维持原默认规则。例如：

```json
{"seoTemplates":{"title":"{title} | {siteName}","description":"{type}：{description}"}}
```

`seo insights` 在给定窗口与前一等长窗口分析已导入的 search-performance 数据，列出高展示低点击、平均位置 8～20、点击下降和同查询多页面的复核建议。不同服务商、资源和维度分开；重叠批次的同一观测行使用较新值，不重复累加。缺失行不冒充零流量；结果保留观测日期数、页面编号与公开修订，来源核验待办及当前有效检查中的链接问题也进入复核清单。多页面共同获得同一查询的展示只提示核对意图，不自动认定冲突、合并或改稿。

生产模式默认给匿名 sitemap、robots、RSS 提供进程内短期响应复用和 ETag；发布或扩展配置变化立即换代。缓存最多 64 个条目、16 MiB，每条最多 2 MB、60 秒；未生成压缩副本的图片仍输出已知原始宽高以减少布局偏移。普通 HTML 默认不启用缓存，测量确认适用后可设置 `WEAVA_PUBLIC_CACHE_SECONDS=10`（最多 60 秒）；登录 Cookie、Authorization、Set-Cookie、私密或 no-store 响应不共享。HTML 开启后公开实时数字最多延迟该秒数，应由站点按实际内容选择。

专项真实链入口为 `node --import tsx scripts/seo-foundation-check.ts`。默认产物在 `D:/Tools/cache/weava/tasks/seo-foundation-20261111`，支持用 `WEAVA_CHECK_OUTPUT` 指定隔离目录、`WEAVA_CHECK_BUILD` 复用既有构建。它使用独立测试站点验证实际 HTTP、编译 CLI 和复用任务，进行 390×844、5 Mbps/80 ms 的本地移动端抽样；单次实验数据不等于真实用户 Core Web Vitals，也不证明搜索排名提升。

本轮 Windows 验证：新增基础与任务目标测试 12 项通过，既有 SEO、分页、升级、接口合同、分类发布和编辑能力按影响范围验证；TypeScript、41 个 Astro 文件的模板检查和接口文档一致性检查通过，生产构建及独立 HTTP/编译 CLI 链通过。实际 HTTP 检查分 4 批取得 37 个页面，含 2 个分页地址与扩展路由，排除 1 个私密条目，已取得页面无未知响应；验证搜索建议、待核验清单、规范跳转、扩展 canonical 的地图排除、304 与发布换代。测试数据均为隔离夹具，没有连接真实 GSC 账号或切换已运行站点。

同一生产程序的移动端抽样：Weava 首页 LCP 1072 ms、文章 500 ms，Library 资料列表 548 ms、文章 528 ms；四个样本 CLS 均为 0、无横向溢出，未加载后台 React/Lexical 资源。菜单事件实验为 32～40 ms，不称作真实用户 INP。当前测量未显示需要默认启用普通 HTML 缓存的服务端瓶颈，因此维持其默认关闭。

验证限制：全仓模块边界检查被本次范围外的 `apps/web/src/api/comments.ts` 直接访问 store 阻止；媒体编辑文件中有一项旧断言仍期望“无正文图片时封面为空”，与当前未改动的默认封面实现不一致。本轮新增原图宽高所对应的目标用例通过，未改动默认封面规则，也未声称整个测试套件全部通过。先前脚本的 networkidle 等待、旧任务执行入口漏接续查和读取工作稿地址错误均在本轮发现并修正。用户已授权清理本次临时产物，但执行工具先后拒绝了限定目录的批量删除与单个测试子目录删除，均返回 blocked by policy；未绕过该拒绝，也未声称已回收。任务目录暂留约 986 MiB，最终验证记录在 `verified/result.json`，所有所属测试服务均已停止。

后续核对修正了中文网址的 301、HTTP 检查及搜索数据匹配。多个列表共用同一页码时，只要其中一个列表仍有该页，就会正常显示。视频地图与普通地图共用索引和规范网址判断。中文跳转、分批检查、共享分页、两种地图和搜索数据匹配通过对应回归用例，41 个 Astro 文件通过检查。此前生产构建和移动端抽样仍记录在 `verified/result.json`。当前工作树的模块依赖检查已通过，完整类型检查仍报后台分类和编辑器改动中的错误，接口文档差异出现在 `state`、`stageImportSource` 和 `runImportSource`，SEO 接口文档与当前定义一致。
