# 主题与扩展

官方主题在 Astro 页面和 core 渲染器中提供。网站设置中的 themeConfig 是运行时数据，包含颜色、字体、版心、圆角和间距。修改设置不需要构建；新增组件或主题实现需要构建。

内置主题包括 Weava 和 Newsletter，可以在后台“外观与导航”中选择并发布。Newsletter 使用白底刊物布局：首页为头条、四篇推荐、热门横栏与九篇文章网格；分类和归档显示文章列表，文章详情使用独立阅读版式。无封面的列表文章可使用正文首图，原文章封面字段不变。RSS、搜索、分类和可见性沿用框架功能。

Newsletter 的顶部五篇始终按发布时间倒序选择：最新一篇为头条，后四篇放在右侧。“最新”网格从第六篇继续显示；“热门文章”、热门网格及归档热门排序统一读取统计库中的累计浏览量（导入历史计数加框架新增浏览），同量时按发布时间倒序。归档页可使用一个包含 content-list 区块的页面，在 `fields.newsletterLayout` 中设置 `archive`；主题据此找到“查看全部文章”的入口。

站点自己的代码放在站点目录的 extensions/index.ts。它导出工厂函数，工厂接收 site、apiVersion、renderDocument、renderBlocks 和 analytics 等服务，返回 API 版本为 1 的扩展声明。源码与编译后的 index.mjs 都属于站点，不放入框架公开仓库。

```ts
export default ({ site }) => ({
  id: 'studio',
  apiVersion: 1,
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
    'studio:notice': (block) => '<aside>工作室公告</aside>',
  },
  schedules: [{ id: 'refresh', intervalMs: 900000, run: async () => {} }],
  route: async (request, release) => null,
  render: async (entry, release) => null,
  start() {},
  stop() {},
});
```

render 返回完整 HTML 时由扩展负责主题展示；返回 null 时继续使用官方主题。route 返回 Response 时接管该请求，返回 null 继续普通路由。panels 自动进入后台外观设置，值保存在 settings.extensions[面板编号]。定时任务防止同一任务重入，服务停止时清理计时器。

themes 声明进入后台主题选择。扩展 render 应按 release.settings.theme 决定是否处理当前页面；切换主题不删除内容或布局。加密网站扩展展示了这一用法。

区块名称必须以扩展编号加冒号开头。renderBlocks 可接收扩展渲染器映射。开发者应通过核心服务保存内容与设置，不直接写数据库内部表。已有内容类型不会被扩展初始化静默覆盖；修改字段需通过 saveType 验证兼容性。

在停止当前站点后，为它构建代码：

```powershell
$env:WEAVA_SITE='E:\Code\WeavaSites\my-site'
powershell -NoProfile -File E:\Code\Weava\scripts\run.ps1 build
```

后台区块搭建器内置区块提供专用表单。自定义代码区块可由外部工具通过 API 配置，再由声明的渲染器输出。首版不提供在线安装代码或插件市场。

加密网站的模板、刷新任务和来源服务是一个站点扩展案例。框架核心不包含交易所名单、邀请码或视频来源记录。迁移器提供适配模板，实际配置和媒体留在私有实例中。
