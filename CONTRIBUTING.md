# 参与 Weava 开发

请先阅读 [README](README.md) 完成安装，再根据改动查看[架构与数据](docs/architecture.md)、[API 与 CLI](docs/interfaces.md)或[主题与扩展](docs/extensions.md)。使用问题与缺陷可以在 [Issues](https://github.com/CheshireMew/Weava/issues) 提出；提交缺陷时附上复现步骤、预期结果、实际结果及 Node／pnpm 版本。

## 开发环境

当前验收平台为 Windows，运行时要求 Node.js `>=24.12 <25`，包管理器固定为 `pnpm@12.4.2`。`scripts/setup.ps1` 按锁文件安装依赖，`scripts/run.ps1` 使用同一个 Node 入口运行 CLI；具体路径与覆盖方式见 README。

完成安装后，针对一个独立的开发站点启动：

```powershell
pnpm weava --site E:\WeavaSites\my-site dev
```

站点需要先初始化，方法见 README。请使用示例或自建测试内容，不用真实站点验证破坏性操作，也不要把站点数据、凭据、备份或日志放进源码仓库。

## 目录与职责

| 目录 | 职责 |
| --- | --- |
| `apps/web` | Astro 访客页面、主题和 HTTP 接口 |
| `apps/admin` | React 管理后台和编辑体验 |
| `packages/core` | 内容、存储、修订、发布、任务和维护逻辑 |
| `packages/contracts` | 共享数据结构、接口合同和客户端 |
| `packages/cli` | 命令行入口与诊断工具 |
| `tests`、`scripts` | 自动测试及专项检查 |
| `docs` | 当前使用方法、架构和实施记录 |

修改行为时同步对应接口、文档和真实消费者。保持程序构建与内容发布分离，保留工作稿、公开版本和历史修订各自的职责。管理后台的日常操作与外部 CLI／API 的定制能力边界见[使用与编辑](docs/authoring.md)。

## 验证改动

先选择直接覆盖本次改动的现有检查。TypeScript 检查和指定测试的入口如下，测试文件应替换为实际受影响的文件：

```powershell
pnpm check
pnpm test tests/publication.test.ts
```

需要检查整体程序构建时运行 `pnpm build`。构建会在 `D:/Tools/cache/weava/programs` 生成独立程序版本，通过校验后更新默认版本；它不是安装包。`pnpm test` 不带文件参数会运行整个 Vitest 套件，应按实际影响选择是否需要。

涉及真实浏览器操作时，使用本机 Chrome 运行 `pnpm test:browser`。它调用正式隔离检查入口，从当前源码构建并启动临时站点，不要求预先启动真实站点；报告和截图保存在输出中列出的 `D:/Tools/cache/weava/foundation-*` 目录。运行前查看[运行文档](docs/operations.md)，确认本次需要覆盖的步骤和产物位置。

原有完整隔离检查入口如下，仅在需要覆盖这些范围时运行，不与已经覆盖同一结果的检查重复执行：

```powershell
node --import tsx scripts/foundation-check.ts --production --authoring --extensions --organization --maintenance --five-sites --upgrade
```

专项入口还包括 `scripts/api-check.ts`、`scripts/storage-growth-check.ts` 和 `scripts/schedule-interruption-check.ts`。它们分别检查 API 使用链、存储复用与定时任务中断；运行前读取脚本的参数和前置条件。历史实施与验证证据见[完善计划](docs/completion-plan.md)。

## 提交变更

让一次变更围绕一个明确结果，说明改了什么、为什么改，以及实际运行的验证。界面变化说明受影响的操作和状态；数据或接口变化说明兼容与迁移方式。调整 README 时同步中文、英文和日文的事实、命令与入口，保留有效的第三方声明。

请不要把无关格式化、生成目录、测试媒体或依赖缓存带入变更。共享问题记录或截图前，移除账户凭据、私有内容和本机敏感信息。新增或修改的项目文件沿用 [AGPL-3.0-only](LICENSE)；第三方资源继续保留原许可及来源。
