# 资料库主题

`library` 是 Weava 内置主题，适用于学习资料、教程、视频、图解和资源目录。主题读取当前公开版本，可以独立使用，不需要 Crypto 扩展或旧站 HTML。

新建资源站：

```powershell
E:\WeavaRuntime\weava.cmd site create my-library --template resource --theme library --port 4330
```

已有网站在后台“外观与导航”选择“资料库”。颜色、字体、版心、圆角和间距使用通用设置；品牌名称、署名、图标和页脚链接在资料库设置中编辑。实际文章、分类、媒体和配置属于站点实例。

| 归属 | 负责什么 |
| --- | --- |
| Weava | 内容与媒体、发布版本、集合查询与分页、搜索、推荐、评论与点赞、SEO、RSS、共享区域、扩展和任务接口 |
| 资料库主题 | 页面布局、栏目与卡片外观、导航、筛选表单、文章目录、响应式与视觉样式 |
| Crypto 扩展 | 交易所公告、股票目录、邀请入口与邀请码、视频临时地址、来源刷新和业务设置 |
| 站点实例 | 品牌、内容、栏目查询、课程顺序、导航链接、业务账号配置和来源快照 |

发布或撤回内容后，栏目、数量、搜索和相关推荐读取新的公开版本。主题不保存另一份文章目录，业务扩展也不接管整页渲染。

## 内容集合

`collection` 区块声明栏目查询。`contentType`、`category`、`tag`、`author`、`query`、`fields` 与通用内容模型共用。字段需要声明 `filterable: true`；选择字段可用 `optionLabels` 为保存值提供可读名称。跨类型集合只查询声明了相应筛选字段的类型。

```json
{"id":"resources","type":"collection","props":{"title":"资料库","contentType":"resource","presentation":"catalog","basePath":"/resources/","limit":36,"filters":"show"}}
```

`presentation` 支持 `cards`、`list`、`catalog`。首页展示区可设置 `pagination: false`。系列课程用 `ids` 保存有序引用，渲染时读取当前标题和网址；撤回或私密内容会从公开集合消失。推荐沿用 Weava 的相关推荐规则和手动推荐设置。

栏目支持关键词、字段筛选、排序和分页。分页地址使用 `/resources/page/2/`，内容增多后自动解析新分页，无需预先创建页面。原有分页记录继续兼容。`link-list` 保存链接目录；`topics`、`tiles` 按目标栏目的当前查询计算数量，`steps` 保留作者编排的学习顺序。

文章使用通用正文、目录、媒体、来源核验、点赞、评论、广告和共享区域。搜索、RSS、普通及视频站点地图由 Weava 生成。小型站点静态资源放在实例 `public` 目录，通过 `/site-assets/` 访问，不依赖业务扩展。

## Crypto 扩展与迁移

`packages/crypto-extension` 负责公告、股票目录、邀请链接和临时视频地址，声明业务区块、接口、设置面板及定时任务，不声明主题。部署结果位于站点 `extensions` 中，业务配置、快照和刷新状态属于站点实例。

`packages/crypto-migration` 是来源适配器，原有 core 入口仅保留兼容转发。转换工具将栏目变成查询、课程变成引用、静态说明变成正文区块，保留内容 ID、正文、网址、分类、来源及发布时间。旧版本和历史修订保留。

目标站使用支持资料库主题的程序后，停止站点执行转换：

```powershell
E:\WeavaRuntime\weava.cmd site stop crypto-blacknico
E:\WeavaRuntime\weava.cmd --site crypto-blacknico migrate library --dry-run
E:\WeavaRuntime\weava.cmd --site crypto-blacknico migrate library
E:\WeavaRuntime\weava.cmd site start crypto-blacknico
```

保存和公开发布在同一事务中完成。转换前保存数据库及扩展入口；失败会回滚数据事务并恢复扩展入口。已转换站点再次执行返回 `unchanged: true`。程序升级沿用管理器检查和恢复点。

开发演练可运行 `scripts/convert-crypto-library.ts 来源目录 目标目录 --apply`。运行演练站时设置 `WEAVA_RESOURCE_ROOT` 指向来源以复用媒体；正式站不需要设置。
