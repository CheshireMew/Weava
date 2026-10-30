# 六个 CMS 项目的借鉴与实施

依据：本聊天按 Ghost、Halo、Hugo、Hexo、Payload、Strapi 顺序完成的固定源码研究，以及用户“根据上面的建议，全面优化当前这个项目，直到做完为止”的授权。实施基线 `c1512c7`。这份清单跟踪本轮实际结果，不能用此前验收记录代替本轮证据。

保留单站主、实例数据独立、不可变修订和事务发布。CLI/API 供外部 Agent 使用。不增加内置 Agent、商城、会员支付、多用户审批，不改技术栈。只验收 Windows，不部署、不删除文件、不制作安装包。开发实例和输出放在 D 盘。

| 编号 | 要完成的行为 | 来源 | 状态 |
| --- | --- | --- | --- |
| 01 | 字段默认值、长度/数值/数量约束、条件显示；表单与后台共用规则 | Payload | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 02 | 引用限制目标类型和条件，选择、保存、导入、发布一致 | Payload | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 03 | 未保存候选检查，字段路径错误集合；后台/API/CLI 入口 | Payload | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 04 | 按类型配置后台字段排列、宽度、列表字段和默认排序；重复字段组标题、折叠与移动 | Strapi | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 05 | 命名保存内容筛选组合 | Payload | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 06 | 新建内容模板，填充初始字段与正文；后台与 CLI 一致 | Hexo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 07 | 文章结构化卡片和可复用片段，复用既有区块/组合/共享区域 | Ghost | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 08 | 有限的多份本地草稿恢复、存储失败提示；登录过期原位重认证并保留编辑 | Ghost | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 09 | 媒体分组及公用选择器筛选；分组不改变文件网址 | Halo、Strapi | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 10 | 批量元信息编辑，明确追加/替换/清空，预检和修订检查 | Halo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 11 | 主题自己的设置归属与显示，切换主题保留原设置 | Halo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 12 | 评论待审核状态及单篇评论开关，保留旧评论和点赞 | Halo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 13 | 从统一字段/接口定义导出机器可读资料，供 CLI 和外部工具使用 | Halo、Payload、Strapi | 部分完成：已有导出；原建议中的接口定义、文档和调用端同步尚未完成 |
| 14 | 文档分组与顺序，侧边导航、面包屑和上一篇/下一篇 | Hugo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 15 | 手动推荐/置顶与按主题相关内容推荐，区别于浏览量排行 | Ghost、Hugo | 部分完成：推荐已实现；原建议中匹配不足时回退最新尚未实现 |
| 16 | 图片使用规格、裁切焦点、尺寸与格式；派生文件按原文件和参数复用 | Hugo、Payload | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 17 | 按类型/分类的订阅源及页面发现入口 | Hugo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 18 | 明确手填摘要与正文截断/提取规则，供列表、RSS、SEO 共用 | Hexo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 19 | 代码语言和服务端高亮，行号/重点行可选，复制保留原代码 | Hexo | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 20 | 网址别名维护界面和批量预检，复用既有循环检查及历史 | Ghost | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 21 | 可保存命名的多内容发布计划，组合发布/撤下并固定修订 | Strapi | 已通过本轮源码、单元、正式构建与浏览器验收 |
| 22 | 专用字段输入器扩展映射基础类型，包含校验、交换和停用兼容 | Strapi | 已通过本轮源码、单元、正式构建与浏览器验收 |


研究中附带条件的可分享预览、发布后通知、外部/临时重定向、多语言，保留为有相应实际需求后再启用的设计，不将它们冒充现有缺陷或本轮必做项。不直接搬用来源项目代码，尤其 Strapi 企业模块；这里只采用已解释的行为与组织方法。

验收按每项的正式用户入口和跨层数据链推进。功能测试覆盖错误、旧数据、冲突、发布隔离和必要恢复；最后运行 TypeScript、现有测试、正式构建与新增功能浏览器验收。未完成的行持续保留，不因部分测试通过而标记整轮完成。

## 内容模型与写作工具

内容类型的“字段规则”支持默认值、数值/字数/列表数量范围、条件和关联限制。默认值只填缺项；显式清空的值不被覆盖。条件使用同组字段的等于、不等于或已填写判断；不满足条件时保留原值，跳过该字段的有效性要求，通用访客字段模板也不展示它。它不改变内容本身的公开/私密设置。文字长度按 Unicode 字符计数。

关联字段可填写允许的内容类型标识和字段等值条件。选择器、保存、导入与发布使用同一判断；导入可以前向引用本批次的其它内容，整批失败回退。后台“检查”读取当前编辑值，返回全部字段路径错误，不保存修订；发布时仍执行独立的冻结版本和实际页面检查。

“后台布局”独立于访客模板，控制字段排列、半行/整行、列表显示和默认排序。自定义字段放在编辑主区域；重复字段组支持摘要标题、折叠、拖动和上下移动，错误定位会展开相关项。

内容列表可保存命名筛选，也可归档和恢复。编辑器的“保存为新建模板”保存初始值和正文；新建时选择该模板会创建独立草稿、网址与区块编号，保留初始可见性，不改已有内容。筛选和新建模板随 JSON 内容交换及完整备份保留。

本地副本保留每篇最多 10 份、最多 40 篇、总量最多约 3 MiB。连续输入在 15 秒内合并为一个快照；上限内较新的副本优先保留。未保存副本可在刷新后选择恢复，已确认保存的近期副本仍可从“本地副本”查看。旧版单副本格式可读取，迁移写入成功后才清理旧键。浏览器拒绝存储时明确提示，网站保存仍独立工作。过期登录不会卸载编辑器；用户重新登录后只保存当前草稿，不重放发布或其它操作。

新增机器入口：

```powershell
pnpm weava --site D:\Sites\example content check --input candidate.json
pnpm weava --site D:\Sites\example content new --type post --template TEMPLATE_ID --title 新文章
pnpm weava --site D:\Sites\example view list
pnpm weava --site D:\Sites\example creation-template list
pnpm weava --site D:\Sites\example media group list
pnpm weava --site D:\Sites\example media move --input move.json
```

`content check` 接受完整条目或 `{value:条目}`，返回 `{valid,errors,value}`，无效时退出码为 1；`--draft` 允许暂缺必填项。`view save`、`creation-template save`、`media group save` 都用 `--input` 读取 `{value,revision}`，首次创建修订为 null。`media move` 读取 `{items:[{id,revision}],groupId}`，null 代表未分组，整批原子处理。

后台 API：`entry/check`、`entries/create`、`references/query`、`authoring/views`、`authoring/templates`、`media/groups`、`media/move`；与 CLI 共用核心服务。媒体分组只修改数据库分类，不移动原文件、不改变 URL；分组随媒体元信息保存在实例数据库和完整备份中。

## 编辑、阅读与发布

文章可用“使用区块正文”把当前正文转换成独立区块，再使用既有的页面设计器增加代码、图片、组合与共享区域。“保存正文片段”创建组合；每次插入重新生成区块编号，后续编辑不会改写组合或其它文章。原正文仍在历史修订中可恢复。新建模板同时保存摘要来源、评论开关、推荐和文档导航选项。

批量编辑先选择内容，再选择字段及替换、追加或清空操作。分类、标签和多值字段支持追加；保存前返回预检摘要，确认时重新检查每份内容的修订和规则，整批成功或整批回退。它只保存工作稿，不改变当前公开页面。CLI 的 `content bulk --input 文件.json` 默认预检，`--apply` 使用输入中的 `review` 确认。输入为 `{items:[{id,revision}],changes:[{field,mode,value}]}`，自定义字段名为 `fields.字段名`。

摘要来源有手填、正文 more 标记前、自动提取三种，已填写摘要优先。标记适用于 Markdown/HTML 及区块正文，写法为 `<!-- more -->`，缺少标记时不擅自截断。文章转换为区块后以当前区块正文为准，后续区块改稿会更新发布摘要，转换前的源正文仍留在历史修订；自动模式从实际正文提取最多 180 个 Unicode 字符，并排除复制代码控件文字。公开列表、RSS 和 SEO 使用发布时确定的同一摘要。代码支持 TypeScript、JavaScript、Python、JSON、HTML、CSS、Shell、SQL、YAML 服务端高亮；其它语言显示原代码。Markdown 围栏可写 `ts linenos {2,4-6}`，也可直接使用代码区块配置；复制按钮保留原代码与换行。

推荐字段提供首页推荐、顺序权重和手动相关内容。相关内容优先使用手选结果，再按共同标签和分类计算关联，不以访问量代替关联度。文档导航按分组、上级和顺序生成目录、面包屑及前后篇；发布检查禁止循环、无效上级和不可访问关联。`/rss.xml?type=类型编号` 与 `/rss.xml?category=分类编号` 提供独立订阅源，页面头部声明对应的 RSS 发现链接，仍遵守公开与收录设置。

主题配置按主题编号保留，切回时恢复各自的颜色、宽度等值。扩展设置面板可用 `themes` 声明所属主题，只在这些主题下显示。扩展还可用 `fieldWidgets` 声明颜色、滑杆、网址或长文本输入器，字段通过 `widget` 引用。输入器必须映射 text/number 基础类型，规则与字段约束取交集；内容保存、发布、交换及 schema 导出沿用同一基础类型和校验。内容类型仍在使用输入器时禁止停用扩展。

媒体详情可以保存命名图片规格，设置宽高、适配、格式、质量和 0～100% 的焦点。选择媒体时可直接采用规格。派生文件由原图内容、规格、焦点与处理版本确定，相同请求复用已有记录和文件，不改原图；文件权限与原图及使用它的内容保持一致。CLI：`media preset list/save`、`media variant --input 文件.json --wait`；生成输入为 `{id,revision,presetId}` 或 `{id,revision,spec}`。规格更改不会改写旧网址，已有页面继续引用原生成文件。

网址别名在独立页面维护，支持单条编辑、停用和 JSON 批量输入。预检检查冲突、循环、目标和修订，保存后通过“发布别名”单独发布。CLI 为 `redirect list/preview/save --input 文件.json`；输入 `{items:[{source,target,revision,disabled?}]}`，确认保存还需要预检返回的 `review`。本轮仅支持永久站内别名。

发布计划保存名称、可选执行时间及多项发布/撤下动作，每项固定修订。确认执行前检查当前公开版本与工作稿变更，正式执行沿用既有后台任务和最终页面校验；发布、撤下、计划完成记录在同一事务提交。后续改稿保持独立；到期计划重启后可继续运行且不重复提交。失败计划可重新检查、保存或取消，已完成/取消的计划不能原地重用。CLI 为 `publication-plan list/save/preview/run/cancel`，保存输入 `{value:{id,name,dueAt?,actions:[{id,action:"publish"|"withdraw",revision}]},revision}`；preview 使用 `--id` 和 `--revision`，run 的 `--input` 读取完整预检结果并可加 `--wait`。

新增后台 API 包括 `entry/structure`、`entries/bulk/preview`、`entries/bulk/apply`、`media/presets`、`media/variants?id=…`、`media/variant`、`redirects`、`redirects/preview`、`redirects/save`、`plans`、`plans/entry?id=…`、`plans/preview`、`plans/run`、`plans/cancel`。图片生成及计划执行返回任务，使用已有 job 接口等候结果。

`schema --format json|openapi|types --output 文件路径` 或 `GET schema?format=…` 导出当前实例合同。JSON 包含基础记录、各类型字段约束和需进一步执行的条件/引用规则；TypeScript 提供按类型区分的条目联合。OpenAPI 覆盖内容、内容类型、筛选、新建模板和媒体分组的写入及候选检查接口，其余接口参照 interfaces.md。修改内容模型后重新生成，无需重新编译框架。

## 本轮验证记录

验收证据对应如下。单元测试验证数据及失败路径；浏览器脚本通过正式后台操作、实际 API、CLI 和访客页面验证用户入口，不以单元测试代替页面操作。

| 清单 | 数据与失败路径 | 正式入口 |
| --- | --- | --- |
| 01～04 | content-models.test.ts | check-content-models.ts：字段表单、关联选择器、候选检查、重复项与布局 |
| 05～06 | authoring-tools.test.ts | check-authoring-tools.ts：命名筛选、模板新建和 CLI |
| 07 | editorial-tools.test.ts | check-cms-finish.ts：正文转换、片段保存/插入；check-authoring.ts：组合/共享区域 |
| 08 | local-drafts.test.ts | check-writing-recovery.ts：离线副本、重新登录、配额失败 |
| 09 | media-groups.test.ts | check-media-groups.ts：分组维护、移动、两个筛选入口、CLI |
| 10 | editorial-tools.test.ts | check-cms-finish.ts：多选、预检、保存、公开版本隔离 |
| 11 | editorial-tools.test.ts | check-cms-finish.ts：切换主题恢复设置、专属面板 |
| 12 | engagement.test.ts、editorial-tools.test.ts | check-cms-finish.ts：待审核提交、审核通过、关闭评论后旧评论和点赞 |
| 13 | routes-schema.test.ts、field-widgets.test.ts | check-cms-finish.ts：CLI 导出 JSON、OpenAPI 与 TypeScript 文件 |
| 14～15 | editorial-tools.test.ts | check-cms-finish.ts：桌面侧栏、面包屑、前后篇、手选相关内容与首页推荐 |
| 16 | image-plans.test.ts：真实双色图检查焦点裁切像素 | check-cms-finish.ts：规格保存/生成、选择器、CLI、原图和复用 |
| 17～19 | editorial-tools.test.ts | check-cms-finish.ts：类型/分类 RSS、摘要、代码重点行与真实剪贴板复制 |
| 20 | routes-schema.test.ts | check-cms-finish.ts：别名预检、保存、单独发布及 301 |
| 21 | image-plans.test.ts；publication-plan-interruption-check.ts：真实事务中断/恢复 | check-cms-finish.ts：命名计划、组合发布/撤下、固定修订与后续工作稿 |
| 22 | field-widgets.test.ts：校验、规则交集、交换、停用保护 | check-cms-finish.ts：颜色与滑杆编辑、schema 导出 |

- TypeScript `tsc --noEmit` 通过；`git diff --check` 通过。
- 本轮完整单元测试：29 个文件、172 项全部通过，报告 `D:\Tools\cache\weava\unit-final-17933608.json`。覆盖字段、候选预检、交换、模板、恢复副本、媒体、批量编辑、旧评论升级、阅读规则、别名、发布计划和扩展输入器。
- 本轮完整正式构建与浏览器记录：`D:\Tools\cache\weava\foundation-1793360682763\results.json`。该次实际使用编译后的前台、后台、CLI 和 worker；原写作/导入/扩展/分类/维护流程与全部新增功能通过，受监测浏览器脚本错误为零。
- 同一正式构建的博客、企业站、作品集、文档站、资源站五类实例全部通过真实后台新建、保存、预览、发布和访客验收，包含手机布局。升级程序校验、实际启动、数据备份回退、真实进程中断及恢复也通过。主验证服务及五个临时站点均已停止。
- 摘要与区块改稿衔接的最新正式构建复验：`D:\Tools\cache\weava\foundation-1793360758612\results.json`。编译后的后台、CLI、worker 和访客页面再次通过全部新增功能专项检查，确认区块改稿摘要在公开 API、RSS 和 SEO 中一致，验证服务已停止。
- 新发布计划真实中断记录：`D:\Tools\cache\weava\plan-interruption-1793360147524\results.json`。在数据库事务内、公开指针已经写入而计划尚未完成时终止进程，重新打开保留旧公开版本与待执行计划；恢复后组合发布/撤下一起完成，第二次运行不重复提交。
- 原单篇定时恢复记录：`D:\Tools\cache\weava\schedule-interruption-1793359524889\results.json`，真实事务中断与一次恢复通过。
- 存储增长记录：`D:\Tools\cache\weava\growth-1793359476077\results.json`。200 篇内容连续 30 次设置发布未增加文章对象或搜索文档；历史归档与恢复不切换当前公开版本。
- 最终截图位于正式构建记录目录的 `cms-finish-article.png`、`cms-finish-article-mobile.png`、`cms-finish-images.png`、`cms-finish-mobile.png`，已人工查看桌面侧栏及手机阅读/后台布局。

正式验收命令：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run
node --import tsx scripts/foundation-check.ts --production --authoring --extensions --organization --maintenance --five-sites --upgrade --cms-models --authoring-tools --writing-recovery --media-groups --cms-finish
node --import tsx scripts/foundation-check.ts --production --cms-finish
node --import tsx scripts/publication-plan-interruption-check.ts
node --import tsx scripts/schedule-interruption-check.ts
node --import tsx scripts/storage-growth-check.ts
git diff --check
```

2026-10-31 按聊天中六份原建议重新复核，发现上一轮把实施清单的完成当作原建议全部落实，结论过满。已确认两处缺口：Halo 第 5 条要求让接口定义、文档与调用端同步，当前仅导出了六个写入/检查端点的 OpenAPI，响应未提供完整数据结构，后台仍使用通用 any 请求；Hugo 第 2 条写明匹配不足时回退最新，当前推荐只返回手选和匹配项，没有这一回退。上述测试真实通过，但未覆盖这两个未实现的要求，不能据此宣称全部完成。13、15 已改回部分完成；其余项的原建议细节仍须以逐项证据为准。

验证使用 D 盘隔离实例，没有更新真实站点，也没有制作发行包。研究中明确带条件的后续功能仍按前述范围处理。2026-10-31 复核前的 78 个改动文件与最终验收 source-state.json 全部散列一致，复核只修正文档结论。随后按用户要求提交并推送 Weava 框架到 GitHub main；第 13、15 项仍按部分完成记录，GitHub 推送不代表真实站点部署。
