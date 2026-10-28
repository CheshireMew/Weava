# 主题与扩展

官方主题在 Astro 页面和 core 渲染器中提供。网站设置中的 themeConfig 是运行时数据，包含颜色、字体、版心、圆角和间距。修改设置不需要构建；新增组件或主题实现需要构建。

内置主题包括 Weava 和 Newsletter，可以在后台“外观与导航”中选择并发布。Newsletter 使用白底刊物布局：首页为头条、四篇推荐、热门横栏与九篇文章网格；分类和归档显示文章列表，文章详情使用独立阅读版式。无封面的列表文章可使用正文首图，原文章封面字段不变。RSS、搜索、分类和可见性沿用框架功能。

选择“刊物首页”模板时，顶部五篇按发布时间倒序选择：最新一篇为头条，后四篇放在右侧。“最新”网格从第六篇继续显示；热门排序读取累计浏览量，同量时按发布时间倒序。归档页面选择“刊物归档”模板；主题以此找到“查看全部文章”的入口，兼容旧来源 `fields.newsletterLayout=archive` 入口。普通页面继续显示其自身区块，不因换主题改成固定首页。

站点代码放在实例的 extensions 目录。多个扩展由 `manifest.json` 声明，编译目标必须为该目录内的 `.mjs`；旁边同名 `.ts` 在构建时编译。仍兼容没有清单时的 `extensions/index.ts` 和 `index.mjs` 单扩展入口。所有源码和编译结果属于实例。

```json
{"version":1,"extensions":[{"id":"studio","file":"studio.mjs","enabled":true}]}
```

工厂接收 site、apiVersion、frameworkVersion、renderDocument、renderBlocks、z（Zod）和 analytics 等服务。返回的 version 使用三段数字版本；dependencies 支持最低版本。启动依赖先于使用它的扩展，停止顺序相反。缺失、版本不符、循环和载入错误在后台“运行与备份”中显示，独立扩展仍能运行。

```ts
export default ({ site, z }) => ({
  id: 'studio',
  apiVersion: 1,
  version: '1.0.0',
  dependencies: [],
  themes: [{ id: 'studio', label: '工作室' }],
  contentTypes: [{
    id: 'project', label: '项目', pathPrefix: '/work/', template: 'article',
    fields: [{ key: 'year', label: '年份', type: 'number' }],
  }],
  panels: [{
    id: 'studio', label: '工作室设置',
    fields: [{ key: 'contact', label: '联系地址', type: 'text' }],
  }],
  blocks: {
    'studio:notice': (block) => '<aside>' + block.props.text + '</aside>',
  },
  blockDefinitions: {
    'studio:notice': { label: '工作室公告', fields: [{ key: 'text', label: '正文', control: 'textarea', required: true }], schema: z.object({ text: z.string().optional() }) },
  },
  schedules: [{ id: 'refresh', intervalMs: 900000, run: async () => {} }],
  route: async (request, release) => null,
  render: async (entry, release) => null,
  start() {},
  stop() {},
});
```

render 返回完整 HTML 时由扩展负责主题展示；返回 null 时继续使用官方主题。route 返回 Response 时接管该请求，返回 null 继续普通路由。panels 自动进入后台外观设置，值保存在 settings.extensions[面板编号]。定时任务防止同一任务重入，服务停止时清理计时器。

定时任务与 start/stop 只在站点服务中运行，发布任务和升级检查使用 worker 模式，仅注册声明与渲染器。异步停止等待正在运行的任务结束，错误会提供诊断。工厂应只返回声明，把外部服务初始化放在 start 中，迁移只使用同步事务内的数据操作。

扩展数据可声明 schemaVersion 和 migrations: `[{version:1,up:({site})=>{...}}]`，版本逐个连续迁移。升级前保存 SQLite 副本于 `archives/extension-upgrades`，全部迁移和安装版本在同一事务中提交；失败回退，较旧数据代码不能读取新版数据。start 失败时恢复原启停设置，已经成功的数据迁移记录保留。数据库副本和完整实例备份用于回退。

后台可以启停已配置的扩展，CLI 提供 extensions list/usage/enable/disable。启停需要当前 configRevision；仍有内容类型、区块、主题或其他启用扩展依赖时，停用会列出引用并拒绝。历史公开版本需要的区块或主题未启用时，回退会拒绝切换。归档或改稿不会删除扩展代码和旧数据。

themes 声明进入后台主题选择。扩展 render 应按 release.settings.theme 决定是否处理当前页面；切换主题不删除内容或布局。加密网站扩展展示了这一用法。

区块名称必须以扩展编号加冒号开头。renderBlocks 可接收扩展渲染器映射。开发者应通过核心服务保存内容与设置，不直接写数据库内部表。已有内容类型不会被扩展初始化静默覆盖；修改字段需通过 saveType 验证兼容性。

在停止当前站点后，为它构建代码：

```powershell
$env:WEAVA_SITE='E:\Code\WeavaSites\my-site'
powershell -NoProfile -File E:\Code\Weava\scripts\run.ps1 build
```

区块定义的 label、fields 和 schema 共用于后台表单、保存类型检查和发布必填检查；未声明表单的旧扩展仍能通过 CLI/API 配置。扩展渲染器负责转义自己的文本输出。产品不提供在线代码安装或插件市场。

加密网站的模板、刷新任务和来源服务是一个站点扩展案例。框架核心不包含交易所名单、邀请码或视频来源记录。迁移器提供适配模板，实际配置和媒体留在私有实例中。
