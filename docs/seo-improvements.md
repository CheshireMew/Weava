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

所有实际公开内容页，包括普通页面、文章和整页扩展，加载同一访客统计。sources 按 referrer 主机区分搜索、AI 来源、其它引荐和直接/未知，无法从没有 referrer 的访问反推真实来源。actions 是业务成功边界发送的具名事件，浏览和点击继续各自计数；声明的爬虫 User-Agent 请求单独保存，不计入访客浏览。声明爬虫身份、AI 来源访问和 AI 回答引用是三种不同证据。

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
