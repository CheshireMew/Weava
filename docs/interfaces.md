# API 与 CLI

后台接口前缀为 `/api/admin/v1`。浏览器使用 HttpOnly 会话 Cookie，CLI 使用站点目录内的 cli-token，通过 Authorization: Bearer 发送。不要把这个文件放入公开网站。

接口统一返回 JSON；错误包含 error 和可选 details。409 表示修订冲突或同类任务冲突。耗时任务返回 202 和任务对象，通过 job/id 查询。

| 接口 | 方法与用途 |
| --- | --- |
| session、login、logout | 获取状态、登录和退出 |
| state | 获取列表摘要、设置、类型、媒体、任务和扩展面板 |
| entry/id | GET 指定条目的完整工作稿 |
| entry | POST `{value, revision}` 保存内容或页面，新内容 revision 为 null |
| settings、types | GET 读取；POST `{value, revision}` 保存 |
| media | GET 列表；POST `{name, base64}` 返回 202 媒体任务；完成后的 result 为媒体记录 |
| history?id=… | GET 历史记录 |
| revision?id=…&version=…、revision/compare?id=…&from=…&to=… | GET 不可变修订；或两个修订及内容差异和正文预览 |
| entry/merge、entry/merge/save | POST `{id,baseRevision,value,choices?}` 预览三方合并；保存再带 currentRevision，冲突 choices 按返回的 JSON 指针选择 local 或 remote |
| restore | POST `{id, version, revision}` 恢复为工作稿 |
| publication | POST 与 publish 相同的选择，返回变更摘要及冻结检查所需的 options |
| publish | POST `{scope?, ids?, revisions?, label?}`；scope 为 all、entries、settings、layouts 或 terms；省略时按 ids 推断单篇或全站 |
| entries/query | GET 带分页和筛选的后台摘要，返回 items、page、pageSize、total、pages |
| terms | GET 分类标签；POST `{value, revision}` 保存稳定编号、名称、slug、kind、parentId |
| layouts | GET 合并内置与自定义布局；POST `{value,revision}` 新建、保存或覆盖内置布局，kind 为 template、region 或 pattern |
| media/query、media/references?id=… | GET 分页媒体库（q、kind、archived、page、pageSize）；或内容、布局、设置和历史引用 |
| media/info、media/archive、media/crop | POST `{id,revision,value:{name,alt?,caption?}}`；`{items:[{id,revision}],archived}`；或 `{id,revision,crop:{left,top,width,height}}` 百分比裁切任务 |
| schedules、schedule、schedule/cancel、schedule/retry | GET 计划列表；POST `{id,revision,dueAt}` 创建，取消和重试使用计划自身 id 与 revision |
| withdraw | POST `{id, revision, archive?}` 撤下或归档 |
| rollback | POST `{id}` 切换公开版本 |
| jobs、job/id、logs?id=… | 查询任务；logs 支持 offset，每页最多 20000 字符 |
| backup、verify | POST `{path}` 创建或校验目录备份 |
| analytics、analytics/export | GET 完整报表或 CSV，支持 start、end、path、channel、country、browser、os、device、model；导出用 dataset，兼容 group |
| analytics/realtime、analytics/visitor、analytics/geo | GET 当前在线、分页访客轨迹、地区库状态；POST analytics/geo 更新免费数据库，完整口径见 [访问统计](analytics.md) |
| seo/audit、seo/audits | POST `{target:"published"\|"draft",http?:boolean}` 创建检查；GET 不可变报告及当前 stale 状态；HTTP 只适用于已发布页面 |
| seo/metadata?id=…&path=… | GET 指定公开内容的最终元信息，path 可带分页或筛选参数 |
| search-data、search-data/import | GET 搜索数据与 AI 观测报告；POST 标准数据集，验证后保存，同编号同内容可重试 |
| comments?status=all\|visible\|hidden&page=1 | GET 评论管理列表，每页 30 条，返回 items、total、hasMore |
| comment | POST `{id,status:"visible"\|"hidden"}` 显示或隐藏评论 |
| export | GET 站点设置、类型与内容的 JSON 交换格式 |
| import | POST `{value, options:{mode?,dryRun?,revisions?}}`，全量预检后在一个事务中导入；不自动发布 |
| import/revisions | GET 可合并对象的当前修订号映射 |
| import/wxr | POST `{xml,options:{dryRun?,settings?,downloadMedia?,comments?,mode?,revisions?,review?}}`；预检返回转换报告，实际导入返回 202 任务；review 使用预检返回的对象 |
| extensions、extensions/usage?id=…、extensions/toggle | GET 诊断或引用；POST `{id,enabled,revision}` 切换已配置扩展，失败保留前一启停状态 |
| maintenance/preview、maintenance/archive | POST `{before,keepReleases,keepRevisions}` 预检；POST `{options,review}` 任务归档，保留活动版本与待执行计划 |
| maintenance/archives、maintenance/archive?id=…、maintenance/restore | GET 归档列表或校验后的内容；POST `{id}` 任务恢复历史，不切换当前工作稿或公开版本 |

异步操作可以带 Idempotency-Key，同一个标识只领取一次执行权。重试相同任务取得同一个编号，不再启动另一个进程。

WP Statistics 历史迁移通过 CLI 提供 `migrate wordpress-statistics-script/extract/inspect`、`migrate wordpress-statistics`（默认只预检，写入需 `--apply --review`）、`analytics wordpress-sources/wordpress-report/wordpress-verify`。它不依赖服务器账号，也不合并原生统计与历史累计，完整命令和格式见 [迁移工具](wordpress-statistics.md)。

公开接口为 `/api/v1/content`、`/api/v1/search?q=…`、`/api/v1/analytics`。内容列表不返回草稿、兼容模板或编辑器状态。内容与搜索结果保持 JSON 数组响应，支持 page、pageSize（或 limit，最多 100），并通过 X-Total-Count、X-Total-Pages、X-Page、X-Page-Size 返回分页信息。内容列表支持 kind、type、category、tag、q、sort 及 field.字段名。字段必须在类型中声明 filterable，并选择对应 type；数字、日期、布尔和选项条件会校验。后台 entries/query 与 CLI 使用同一查询服务；分类可以用稳定编号、slug 或名称，上级分类包含其后代。

文章互动仅对已发布的公开内容开放，响应禁止缓存。首次请求设置 HttpOnly 的 `weava-reader` Cookie，后续请求须保留该 Cookie。`GET /api/v1/engagement?id=文章编号&page=1&sort=latest|oldest` 返回点赞数、评论数、当前访客点赞状态及评论列表（每页 20 条）。`POST /api/v1/like` 接收 `{id,liked:boolean}`，设置状态可安全重试。

`POST /api/v1/comment-captcha` 接收 `{id}`，返回验证码编号 `id`、PNG data URL `image` 和毫秒时间戳 `expiresAt`。答案仅保存为摘要，不随接口返回。`POST /api/v1/comment` 接收 `{id,author,body,captchaId,captcha,clientId}`；称呼最多 40 字、评论最多 4000 字，验证码不区分大小写，五分钟内单次使用。`clientId` 使用 UUID，同一访客重试同一已成功的请求不会重复创建评论。错误验证码也会消耗验证机会。

评论每位访客至少间隔 15 秒、每小时最多 10 条，同一网络地址每小时最多 30 条；验证码每位访客每分钟最多 10 次、每个网络地址每分钟最多 40 次；点赞请求每个网络地址每分钟最多 120 次。达到限制返回 429。访客与网络标识经站点密钥摘要后保存，不保存原始 IP。Newsletter 目录设置保存在 `settings.extensions.newsletter.tocDefaultOpen` 布尔值中，随设置发布生效。

CLI 默认返回 JSON，`--human` 输出格式化 JSON；成功为 0，失败为 1，等待超时且任务仍在执行为 2。使用 `--site` 指定实例，`--url` 可以覆盖本机服务地址。

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo content list
scripts/run.ps1 --site E:\Code\WeavaSites\demo content save --input D:\Tools\weava\change.json
scripts/run.ps1 --site E:\Code\WeavaSites\demo publish --id 内容编号 --wait
scripts/run.ps1 --site E:\Code\WeavaSites\demo logs --id 任务编号 --offset 0
scripts/run.ps1 --site E:\Code\WeavaSites\demo backup create --path D:\Tools\weava\backups --wait
scripts/run.ps1 --site E:\Code\WeavaSites\demo export --output D:\Tools\weava\export.json
```

`page`、`settings`、`media` 同样有 list/save；保存输入遵循对应 API。content/page list 返回分页对象，支持 --page、--page-size、--type、--category、--tag、--query、--status、--visibility。

`content get --id 编号` 与 `page get --id 编号` 返回完整工作稿和修订号。`publication preview --id 编号 --output 文件.json` 保存检查结果，`publish --input 文件.json --wait` 使用其中原始 options 发布；检查后发生变动会拒绝执行，需要重新检查。`seo audit --http` 读取最多 200 个实际公开页面，`seo audit --draft` 检查候选生成内容，`seo reports` 读取保存结果，`seo metadata --id 编号 --path '/?page=2'` 检查具体地址策略。

`search-data plan/pull --config 文件.json` 分别给出请求计划、执行可选连接器；`search-data import --input 数据集.json` 和 `search-data report` 导入、查看观测。完整数据合同、凭据边界、请求预算及示例见[搜索与内容改进](seo-improvements.md)。统计报告新增 sources、actions、crawlers，CSV 仍按原有页面浏览与点击口径导出；声明爬虫请求与访客事件分开。

JSON import 默认新增或跳过完全相同的对象。空的已初始化站点允许应用导出的设置和类型；已有不同对象需要 --merge，并在输入中提供 revisions，例如 `{"entry:内容编号":123,"settings:site":456}`。--dry-run 执行同样的校验但回滚全部写入。正式导入也在一个事务中完成，后续对象失败不会留下前半批。JSON 交换不包含媒体二进制文件，完整站点恢复仍使用 backup。Markdown 内容保存为 `{version:1, format:"markdown", source:"正文"}`，由 content save 写入。外部工具通过 CLI 或 API 工作，产品没有内置 Agent 或模型服务。

稳定站内链接写作 `entry:内容编号`，编号需要 URL 编码，可以追加 `#锚点`。正文链接和按钮网址在渲染时解析为该公开版本的实际路径。修改文章网址会保留旧入口，公开回退同时恢复路由历史。交换格式也包含已保存的网址别名。

定时任务可使用 `schedule create --id 内容编号 --revision 当前修订 --at 带时区的时间`、schedule list、schedule cancel/retry。取消和重试使用计划自身的 id 与修订号。计划发布所选历史修订，之后的工作稿仍然保留。

`media save` 会等待后台媒体处理完成后返回任务结果。API 调用者可以用 Idempotency-Key 重试同一上传请求，并通过 job/id 查询派生图片生成进度。原文件按内容散列保存，媒体处理失败时文件仍然保留，空间检查可以定位未引用文件。

离线标准迁移使用 `migrate wxr --input 文件.xml --dry-run`，预检通过后去掉 --dry-run 导入。可选 --download-media、--media-dir 离线目录、--settings、--no-comments，以及 --merge-revisions 当前修订号文件。离线目录按来源 URL 的完整路径存放附件；该命令要求目标实例停止。后台 import/wxr 可在服务运行时通过任务完成，同样不会自动发布。

内容记录的 `visibility` 为 `public` 或 `private`，缺省为 `public`；它与 `status` 独立。后台与 CLI 均可保存该字段，再通过 publish 发布可见性变更。公开 API 永远不返回私密文章，站主可通过带认证的 `entry/id` 获取完整工作稿。
