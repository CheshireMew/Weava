# WP Statistics 迁移工具

工具属于 Weava 的迁移能力，源码在 `packages/core/src/wordpress-statistics.ts` 和 `wordpress-statistics-export.ts`，入口为 Weava CLI。server-ops 只负责 SSH 连接、账号使用与脚本执行，不增加 WordPress 转换逻辑。生成的服务器脚本、响应及本次诊断材料放在 server-ops 自己的 `.runs`；导入归档和备份放在目标站点实例，均不放进框架源码仓库。

本轮只制作并测试工具，没有重新导出真实服务器的访客明细，也没有把真实统计导入用户站点。替换 WordPress 时再取最终快照。

## 导出与校验

`wordpress-statistics-script` 生成可经 SSH 执行的独立只读脚本。脚本从服务器现有 `wp-config.php` 中解析字面量连接设置，直接读取 MySQL；不执行配置文件，不启动 WordPress、插件或 cron，不在服务器上写文件。连接配置使用环境变量或动态 PHP 表达式时明确失败，需要针对该来源另行适配，不能通过执行配置来猜值。

导出使用 InnoDB 只读一致性快照，包含访客、每日页面计数、访客与页面关联、每日汇总、历史累计、事件的编号/名称/关联和时间。原始 IP、WordPress 用户编号、原始 User-Agent 及事件自由文本载荷不导出；浏览器、系统、设备、国家地区、来源分类和首末页面信息保留。referrer 只保留来源主机；页面 URI 保留路径和查询参数。事件载荷中的业务字段不属于本工具的统计迁移合同。

数据库设置、表前缀和表结构来自实际站点。访客、页面及关系表必须存在，缺少每日汇总、历史累计或事件表时明确标记缺失；已存在但无记录的表与缺失表分开表示。缺少可选字段记录在 missingColumns，不伪造字段值。非 InnoDB 或必要字段不匹配时停止，不修改来源以满足工具。

输出为 `weava-wp-statistics-v1` JSON，包含来源 URL、时区、插件版本、采集时间、六类表的存在状态、记录数量及 SHA-256。校验会检查字段、日期、编号重复、关系完整性和每张表的记录数与校验值。没有来源时区名称时保留 WordPress 的固定 UTC 偏移。单份快照或 server-ops 响应限制为 128 MB。

以下是日后替换网站时的操作顺序，当前不执行真实导出或导入。

```powershell
# 1. 生成脚本。server-ops 路径和服务器别名使用本机实际配置。
$serverOpsRoot='E:\Code\Cheshire-skill\server-ops'
$taskRoot=Join-Path $serverOpsRoot ('.runs\wp-statistics-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
scripts/run.ps1 migrate wordpress-statistics-script --wordpress-root /var/www/wordpress --output "$taskRoot\export.sh"

# 2. 正式 SSH 入口执行，只将响应保存在本机；不把全部数据打印到聊天。
$response=& "$serverOpsRoot\server-ops.ps1" exec --server your-server --script "$taskRoot\export.sh" --timeout 90
if ($LASTEXITCODE -ne 0) { throw '服务器导出失败，请查看本次响应。' }
[System.IO.File]::WriteAllText("$taskRoot\response.json",($response -join [Environment]::NewLine),[System.Text.UTF8Encoding]::new($false))

# 3. 检查 SSH 退出码和完整性，提取快照，再查看数据覆盖范围。
scripts/run.ps1 migrate wordpress-statistics-extract --input "$taskRoot\response.json" --output "$taskRoot\snapshot.json"
scripts/run.ps1 migrate wordpress-statistics-inspect --input "$taskRoot\snapshot.json"
```

`extract` 也支持原始导出 JSON；`inspect` 和导入命令均可直接读取 server-ops 响应。服务器退出失败、JSON 截断或表校验失败时拒绝使用。生成脚本、提取快照、保存方案和报告都拒绝覆盖已有同名文件，重跑时使用新的文件名即可。生成器默认输出 shell，也可用 `--php` 输出 PHP 文件；服务器需要 PHP 8+、mysqli 和 tokenizer。

## 预检、导入与重试

先迁移内容、初始化目标统计库，再预检。**不加 `--apply` 就只做预检**；也支持显式 `--dry-run`。预检以只读方式打开已有数据库，不创建站点、归档、备份或来源表。

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wordpress-statistics --input "$taskRoot\snapshot.json" --plan-output "$taskRoot\plan.json"

# 日后明确执行迁移时，停止目标 Weava 服务后应用方案；工具本身不会停止服务。
scripts/run.ps1 --site E:\WeavaSites\my-blog migrate wordpress-statistics --input "$taskRoot\snapshot.json" --apply --review "$taskRoot\plan.json"
```

预检展示来源记录数量、日期范围、各层计数、内容映射、未匹配网址、已有 Weava 事件及独立累计计数器。映射优先使用同一 WordPress 来源的原文章编号，也支持 WXR 命名空间编号；其它页面按路径匹配。未匹配页面、404、旧分类和带查询参数的网址保留为历史来源数据，不丢弃、不创建新内容。预检后来源快照、活动来源版本或相关页面映射变化，会要求重新预检。

导入发生在目标 `analytics.sqlite` 中独立的 `wp_statistics_*` 表。每次变动前先通过 SQLite 在线备份接口保存整份统计库；再把来源归档，在单个事务内登记来源版本、六类原始统计及页面映射，成功后保存回执。

- 相同来源数据重复导入返回 changed=false，不追加记录，也不再创建备份；重新导出但内容未变时也不会重新累计，活动快照的采集时间仍保留原值。
- 较新的数据作为同一来源的新版本切换，旧版本和原始快照保留；不是把新旧快照相加。较旧且不同的数据、同一采集时间但内容冲突的数据会被拒绝。
- 导入事务失败不会留下部分统计记录。原始快照和导入前备份继续保留，修复原因后重新预检并重试。成功提交后若写回执失败，再次预检会识别已有版本，先运行 verify 确认数据状态，不重复累计。
- 不修改文章、站点设置、公开版本、Weava 原生事件及 Puock 历史计数，也不让历史访客进入当前在线人数。源码内没有服务器连接账号和站点实际数据。

恢复资料位于 `imports/wp-statistics/<fingerprint>/`：`snapshot.json` 为完整来源快照，`before-<uuid>.sqlite` 为导入前统计库，`receipt-<uuid>.json` 为此次回执。需要恢复时，先用 verify 核实状态并停用目标服务，确认待恢复版本与之后新采集的数据后再执行恢复；工具不会擅自覆盖统计库或删除备份。

## 独立历史报告与验证

```powershell
scripts/run.ps1 --site E:\WeavaSites\my-blog analytics wordpress-sources
scripts/run.ps1 --site E:\WeavaSites\my-blog analytics wordpress-verify
scripts/run.ps1 --site E:\WeavaSites\my-blog analytics wordpress-report --start 2026-05-01 --end 2026-10-29 --output D:\Data\wp-history.json
scripts/run.ps1 --site E:\WeavaSites\my-blog analytics wordpress-report --visitor 123 --page 1
```

`wordpress-verify` 将每张已导入表逐行与归档快照核对，并检查活动来源登记、内容哈希和页面映射完整性，可用 `--source` 限定来源。`wordpress-report` 支持 source、start、end、path、visitor、page；多来源时必须选择 source。访客和访问记录每页 50 条，报告中的时间保持来源时区，历史行保留来源编号，便于核查。

报告可查看每日数据、页面排行、地区、设备、浏览器和系统、来源、访客、首末页面与访问关联。它是独立的 WP Statistics 历史来源报告，通过 CLI 查看或导出 JSON，**不会自动混入原生后台统计面板**。这样既能完整保留旧统计，也不把不同系统的计数误加。

每日汇总在已有日期上优先使用原汇总；只有页面计数的日期展示页面计数，并注明 basis，两个层级不相加。跨日去重访客、会话、可见停留时间明确为 null；访客维度按“访客记录”计数，不能当成原生访客去重人数。历史累计独立返回，不加到已有每日汇总上。首末访问时间差不会被当作停留时间。WP Statistics 原本把 ChatGPT 划入 search 时，originalChannel 保留原分类，避免篡改历史证据。

## 验证范围

`tests/wordpress-statistics.test.ts` 覆盖完整性校验、预检不写数据、实际导入与备份、重复去重、新旧快照、过期预检、页面映射、目标运行检测、中途失败回退、来源分离和数据库改动检测。

`scripts/wordpress-statistics-check.ts` 在 D 盘建立隔离 WordPress 夹具和 Weava 目标，用真实 PHP CLI 执行生成脚本；mysqli 使用本地只读测试替身，不连接服务器数据库。验证配置不执行、字段脱敏、跨 PHP/JS 校验和、server-ops 响应、CLI 预检与导入、备份、重复导入、报告与核验。`--production` 使用正式构建的 CLI；通过 WEAVA_TEST_PHP 指定测试用 PHP。Weava 日常运行不依赖 PHP。

```powershell
pnpm check
pnpm test
pnpm build
$env:WEAVA_TEST_PHP='D:\Tools\php\php.exe'
node --import tsx scripts/wordpress-statistics-check.ts --production
```

这些检查证明当前 Windows 本机工具链和夹具流程，不等同于正式切换时的服务器导出或真实数据迁移。正式迁移时仍需核对最终快照总数、时区、日期覆盖和来源页面映射。

2026-10-29 验证结果：21 个测试文件共 132 项测试、类型检查、正式构建和 `git diff --check` 通过。正式构建的完整 CLI/PHP 夹具结果为 `D:\Tools\cache\weava\wp-statistics-tools-1793286713635\results.json`，其中 realServerExported=false、realSiteImported=false。另只读核对真实本地博客：未创建 wp_statistics_* 来源表及 imports/wp-statistics 目录，原有 2 条浏览事件和 133 篇文章的 88,717 次 Puock 累计计数保持原值。
