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
| restore | POST `{id, version, revision}` 恢复为工作稿 |
| publish | POST `{ids?, revisions?, label?}`；省略 ids 表示全站发布 |
| withdraw | POST `{id, revision, archive?}` 撤下或归档 |
| rollback | POST `{id}` 切换公开版本 |
| jobs、job/id、logs?id=… | 查询任务；logs 支持 offset，每页最多 20000 字符 |
| backup、verify | POST `{path}` 创建或校验目录备份 |
| analytics、analytics/export | GET 报告或 CSV，支持 start、end、path |
| export | GET 站点设置、类型与内容的 JSON 交换格式 |

异步操作可以带 Idempotency-Key，同一个标识只领取一次执行权。重试相同任务取得同一个编号，不再启动另一个进程。

公开接口为 `/api/v1/content`、`/api/v1/search?q=…`、`/api/v1/analytics`。内容列表不返回草稿、兼容模板或编辑器状态。

CLI 默认返回 JSON，`--human` 输出格式化 JSON；成功为 0，失败为 1，等待超时且任务仍在执行为 2。使用 `--site` 指定实例，`--url` 可以覆盖本机服务地址。

```powershell
scripts/run.ps1 --site E:\Code\WeavaSites\demo content list
scripts/run.ps1 --site E:\Code\WeavaSites\demo content save --input D:\Tools\weava\change.json
scripts/run.ps1 --site E:\Code\WeavaSites\demo publish --id 内容编号 --wait
scripts/run.ps1 --site E:\Code\WeavaSites\demo logs --id 任务编号 --offset 0
scripts/run.ps1 --site E:\Code\WeavaSites\demo backup create --path D:\Tools\weava\backups --wait
scripts/run.ps1 --site E:\Code\WeavaSites\demo export --output D:\Tools\weava\export.json
```

`page`、`settings`、`media` 同样有 list/save；保存输入遵循对应 API。JSON import 用于新内容导入，已有编号需要通过带修订号的 save 更新。Markdown 内容保存为 `{version:1, format:"markdown", source:"正文"}`，由 content save 写入。外部工具通过 CLI 或 API 工作，产品没有内置 Agent 或模型服务。

`media save` 会等待后台媒体处理完成后返回任务结果。API 调用者可以用 Idempotency-Key 重试同一上传请求，并通过 job/id 查询派生图片生成进度。原文件按内容散列保存，媒体处理失败时文件仍然保留，空间检查可以定位未引用文件。
