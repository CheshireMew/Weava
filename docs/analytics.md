# 访问统计

后台“访问统计”直接读取站点自己的统计库，不依赖付费统计平台、Google Analytics 或模型 API。它包括流量概览、连续日期趋势和上期对比、搜索与 AI 来源、来源域名、页面排行、国家或地区、浏览器、操作系统、设备类型和型号、最活跃及最新访客、访问轨迹、当前在线、世界地图、链接点击、关键动作和推广链接。爬虫请求单独展示。

报表默认显示站点时区下的近 30 天，可选今天、昨天、7 天、30 天、90 天或自定义日期。上期是紧邻所选范围之前、天数相同的一段时间，零访问日期也保留。页面路径和来源可直接筛选，点击地区、浏览器、系统、设备或型号分布可继续筛选；筛选条件显示在日期下方，点击即可移除。图例可以切换曲线，图下“查看每日数据”提供精确数值。表头支持排序，长表分页。

趋势图例默认显示整个区间的统计，访客使用区间去重人数；移动到某天时显示当天数值，不能把每天的独立访客相加后当作区间访客。只选一天时显示数据点。报表查询失败会提供重试入口，并暂停展示与导出本次查询结果；实时刷新失败会注明最后成功记录的时间，恢复可见或点击重试后重新读取。实时与地区库状态请求都避免重叠轮询。

## 数据口径

- 浏览量是可见的公开页面加载次数。刷新会新增浏览；同一事件重试不会新增。后台、预览和私密页面不计入。
- 访客使用浏览器保存的随机标识，清除数据或换设备会识别为新访客。浏览器禁止存储时仍可采集，但不能稳定识别跨页访客。
- 会话在 30 分钟未活动后更新。一次会话的各页面沿用首次来源，即使会话跨过午夜。搜索或 AI 图表统计发生访问的会话，不把每次站内跳转算成新的引荐。
- 来源结合外部 referrer 主机与 `utm_source`、`utm_medium`、`utm_campaign`。可识别搜索、AI、社交、邮件、付费推广、其它引荐和直接/未知；来源被浏览器或 App 隐藏时无法反推。AI 来源代表点进网站的访问，不代表 AI 抓取或回答引用。
- 地区、浏览器、系统、设备和型号按所选范围内每位访客最后一次访问的信息分组，因此每个分布的比例之和为 100%。没有采集到的信息明确保留为未知。设备型号来自浏览器信息，不猜测被隐藏的手机型号。
- 页面排行中的进入、退出对应会话实际第一、最后一页。尚未结束的会话，其最后一页仍可能变化。筛选只统计范围内实际发生的进入/退出，不把范围中间的页面当作入口。
- 停留时间只累加页面可见的时间，心跳间隔 30 秒，记录最深滚动进度。心跳更新独立状态，不创建浏览事件。离开页面时使用 keepalive 发送并保留未确认队列，下一页可以重试。进程被强制结束或网络中断时，最后一段停留可能缺失。
- 当前在线独立于历史日期和设备/来源筛选，以最近 5 分钟收到的可见页面状态为准，后台每 15 秒刷新；页面路径筛选仍生效。正常隐藏页面会发送离开状态，浏览器被强制关闭且未发送状态时最多延后约 5 分钟消失。
- 流量概览固定显示今天、昨天、近 7 天、近 30 天和累计记录，独立于地区、设备及来源筛选，仍支持页面路径筛选。迁移历史累计浏览单独保留，只支持页面路径筛选，不伪造日期、访客、设备或地区。

访客列表每组最多展示 100 位；点击编号查看所选日期内的浏览、点击和关键动作，详情每页 50 条。链接点击与业务成功动作分别计数。点赞、评论、复制和分享事件沿用已有业务成功边界。导出选择器包含 14 类 CSV，使用当前已应用的筛选；“最新访客”导出与列表相同的最近 100 位。空数据也保留字段表头。

浏览器 Do Not Track、`?analytics=off` 和后台“排除本机后续访问”都能停止采集；排除本机只影响此浏览器的后续访问。

## 免费地区库

地区查询使用 [DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite) 的本地 MMDB 数据库，支持 IPv4/IPv6，不按访问次数调用外部 API。没有账号、密钥或付费订阅要求。服务启动时检查当月版本，此后每天检查一次；后台和 CLI 均可手动更新。

文件位于站点目录 `analytics/geoip-country.mmdb`，不会放在框架仓库或 C 盘缓存。新文件经过解压和格式验证后再替换，旧版本保留为 `.retained-*`。下载失败会在后台显示原因和重试按钮，已有数据库继续使用；尚未安装时仍记录访问，其地区保持未知。后来安装地区库不会补造此前未采集的地区，因为事件库不保存原始 IP。

数据库按 CC BY 4.0 使用，地图和地区库状态保留官方要求的 `IP Geolocation by DB-IP` 链接。免费库有覆盖和准确度限制，代理、VPN 和公共 DNS 等出口所在地可能与访客所在地区不同。地图使用 [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 公共领域的 110m 国家边界，离线显示，不调用地图 API；新加坡、香港等小面积地区另有点位。

直接运行时使用连接的客户端 IP。部署在受信任的反向代理之后时，设置 `WEAVA_TRUST_PROXY=1`，并由该代理覆盖 `X-Forwarded-For`；否则保留默认关闭，避免把代理地址误当访客地址。此配置只影响接入服务后的地区判断，本轮没有做服务器部署或跨平台验收。

## API 和 CLI

管理接口沿用后台会话或 CLI Bearer 鉴权。

| 接口 | 用途 |
| --- | --- |
| `GET /api/admin/v1/analytics` | 完整报表。支持 start、end、path、channel、country、browser、os、device、model |
| `GET /api/admin/v1/analytics/realtime?path=…` | 当前在线人数和页面，最多列出 100 位；count 是全部在线访客数 |
| `GET /api/admin/v1/analytics/visitor?id=…&start=…&end=…&page=…` | 分页访问轨迹 |
| `GET /api/admin/v1/analytics/export?dataset=…` | CSV，沿用报表筛选；兼容原 group 参数 |
| `GET /api/admin/v1/analytics/geo` | 地区库可用性、构建日期、更新状态和错误 |
| `POST /api/admin/v1/analytics/geo` | 启动免费数据库更新，返回 202；通过 GET 查看结果 |

公开采集接口仍为 `POST /api/v1/analytics`，支持 view、click、event 和 pulse；pulse 携带 viewId、activeMs、scroll、closed，只能更新对应访客、会话、页面的已存在浏览记录。同一事件最多重试一周，重复浏览事件按 id 去重，旧心跳不能覆盖更新的页面状态。旧 events 表的列保持不变，新增 event_context 和 page_activity 表，因此已有迁移脚本和统计记录继续可用。

```powershell
pnpm weava --site E:\Code\WeavaSites\demo analytics report --start 2026-10-01 --end 2026-10-29
pnpm weava --site E:\Code\WeavaSites\demo analytics realtime
pnpm weava --site E:\Code\WeavaSites\demo analytics visitor --id 访客编号 --page 1
pnpm weava --site E:\Code\WeavaSites\demo analytics export --dataset countries --output D:\Tools\cache\weava\countries.csv
pnpm weava --site E:\Code\WeavaSites\demo analytics geo-status
pnpm weava --site E:\Code\WeavaSites\demo analytics geo-update
```

channel 可取 direct-or-unknown、search-referral、ai-referral、social、referral、campaign、paid、email。country 使用 ISO 两位地区码，未知值为“未知”；device 可取 desktop、smartphone、tablet、other、unknown。dataset 可取 pages、daily、sources、countries、browsers、os、devices、models、visitors、links、actions、campaigns、crawlers、lifetime。

## Windows 验证

`tests/analytics.test.ts` 覆盖来源归因、设备解析、跨日会话、时区及夏令时、零访问日期和上期对比、心跳幂等、在线超时、旧库兼容、筛选、分页、导出与地区库错误恢复。既有历史浏览量测试继续确认迁移总数不会伪造明细。

先执行 `pnpm build`，再运行 `node --import tsx scripts/analytics-check.ts`。脚本在 `D:\Tools\cache\weava\analytics-browser-*` 建立隔离示例站，使用真实免费地区库和本机 Chrome 验证采集、跨页重试、停留、点击和成功动作、在线状态、地区解析、禁止存储、Do Not Track、私密页面/爬虫排除、报表筛选、详情、14 类导出、桌面与 390px 窄屏、空数据及浏览器错误。脚本结束后停止自己的服务，不修改用户站点；图表中的示例数据只用于这次隔离验证。

2026-10-29 最终检查：类型检查、正式构建、20 个测试文件共 122 项测试通过，`git diff --check` 通过。最终 Chrome 结果为 `D:\Tools\cache\weava\analytics-browser-1793283970838\results.json`，同目录保留 desktop.png、mobile.png、mobile-top.png、visitor.png、empty.png 和导出样本；结果包含断网跨页重试、本机排除、CLI 和零浏览器错误。另对同一份真实 MMDB 注入 HTTP 503 更新失败，确认原文件 SHA-256 未变、旧库仍能查询且错误可见，记录为 geoFailureKeepsCurrent。没有部署服务器、切换域名或执行跨平台验收。

同日继续复查后，修正单日趋势缺少数据点、图例误将每日独立访客相加、表格重复行标识和后台轮询错误不可见的问题；查询失败时不再展示或导出不匹配的结果。最新正式构建的 Chrome 结果为 `D:\Tools\cache\weava\analytics-browser-1793284663693\results.json`，增加 trendTotalsAndSingleDay、pollingFailureAndRecovery、failedQueryRecovery，地区库失败保留检查已纳入脚本。single-day.png 和 desktop-top.png 记录修正后的实际界面。全仓 122 项测试、类型检查和差异检查再次通过。隔离 10,000 条访问、1,200 位访客的报表对比中，复用时区日期格式器后由 2,739ms 降到 773ms，固定相同时间参数逐项比较完整报表一致；记录为 `D:\Tools\cache\weava\analytics-performance-1793284523009\result.json`，这只是本机样本耗时，不代表服务器指标。
