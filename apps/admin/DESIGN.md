---
name: Weava 管理后台
description: 参考用户提供的 Substack 截图，以中性灰、白色工作区、橙色操作和舒展内容列表组织现有管理功能。
colors:
  canvas: "#fafafa"
  surface: "#ffffff"
  surface-soft: "#fafafa"
  surface-secondary: "#f2f2f2"
  line: "#e6e6e6"
  control-line: "#dedede"
  ink: "#303030"
  ink-secondary: "#555555"
  ink-muted: "#747474"
  accent: "#d63d0b"
  accent-hover: "#bd3307"
  accent-soft: "#fff1eb"
  focus: "#d63d0b"
  on-accent: "#ffffff"
  error-ink: "#a03530"
  error-surface: "#fdf0ee"
  success-ink: "#386b51"
  success-surface: "#edf6f0"
  warning-ink: "#805d29"
  warning-surface: "#faf2e2"
  entry-published-ink: "#3c5633"
  entry-published-surface: "#dfead7"
  entry-changed-ink: "#78531c"
  entry-changed-surface: "#f4dfb4"
  entry-draft-ink: "#666666"
  entry-draft-surface: "#f0f0f0"
  nav-ink: "#555555"
  nav-hover: "#f2f2f2"
  nav-hover-ink: "#303030"
  nav-active: "#ededed"
  nav-active-ink: "#303030"
  nav-divider: "#e6e6e6"
  analytics-purple: "#6b7195"
  analytics-green: "#428478"
  analytics-orange: "#9b7638"
typography:
  brand:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 16px
    fontWeight: 700
    lineHeight: 24px
    letterSpacing: normal
  navigation:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 20px
  navigation-active:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 15px
    fontWeight: 700
    lineHeight: 20px
  entry-state:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  headline:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 30px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: -0.03em
  section:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  directory-title:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 16px
    fontWeight: 650
    lineHeight: 1.5
  editor-title:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: -0.025em
  editor-body:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.95
  metric:
    fontFamily: "'Segoe UI', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"
    fontSize: 30px
    fontWeight: 550
    lineHeight: 1.5
    letterSpacing: -0.04em
rounded:
  status: 3px
  control: 8px
  navigation: 9px
  brand: 6px
  group: 8px
  analytics-card: 10px
  panel: 12px
  dialog: 14px
  content-list: 11px
  workspace: 16px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 36px
components:
  sidebar:
    backgroundColor: "{colors.canvas}"
    padding: 24px 18px 20px
    width: 260px
  topbar:
    backgroundColor: "{colors.surface}"
    padding: 0 20px
    height: 56px
  brand-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.brand}"
    height: 30px
    width: 30px
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: 10px 16px
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    padding: 10px 16px
  button-secondary-hover:
    backgroundColor: "{colors.surface-secondary}"
  button-icon-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "0"
    height: 42px
    width: 42px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 9px 11px
    width: 100%
  nav-item:
    textColor: "{colors.nav-ink}"
    typography: "{typography.navigation}"
    rounded: "{rounded.navigation}"
    padding: 12px 16px
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
    typography: "{typography.navigation-active}"
  entry-state-published:
    backgroundColor: "{colors.entry-published-surface}"
    textColor: "{colors.entry-published-ink}"
    typography: "{typography.entry-state}"
    rounded: "{rounded.status}"
    padding: 4px 8px
  entry-state-changed:
    backgroundColor: "{colors.entry-changed-surface}"
    textColor: "{colors.entry-changed-ink}"
    typography: "{typography.entry-state}"
    rounded: "{rounded.status}"
    padding: 4px 8px
  entry-state-draft:
    backgroundColor: "{colors.entry-draft-surface}"
    textColor: "{colors.entry-draft-ink}"
    typography: "{typography.entry-state}"
    rounded: "{rounded.status}"
    padding: 4px 8px
  filter-tag:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.metadata}"
    rounded: "{rounded.control}"
    padding: 4px 8px
  analytics-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.analytics-card}"
    padding: 18px
  directory-title:
    textColor: "{colors.ink}"
    typography: "{typography.directory-title}"
  writing:
    backgroundColor: "{colors.surface}"
    padding: 48px 64px 64px
    width: 100%
  publication-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: 24px
    height: 116px
---

# Design System: Weava 管理后台

## Overview

参考用户提供的 Substack 后台截图，采用浅灰导航、白色工作区、深灰正文和橙色主操作。模仿视觉与排版，不照搬 Substack 的业务入口。保留 Weava 当前菜单、真实数据与全部现有编辑、管理和发布功能。

本规范仅覆盖 apps/admin。访客网站继续使用根规范和各主题的字体、颜色与布局。用户此前要求移除文章编辑页的重复列表和标题下摘要，此要求继续有效。

## Colors

前置 colors 是实际共享色值。主操作、焦点与选中文本使用橙色；导航选中使用中性浅灰。内容列表通过顶部状态切换分类，不在条目中重复显示发布状态标签；编辑页保留当前内容的状态提示。统计图表保留既有分类色，不将其用作默认按钮色。

## Typography

管理界面使用 Windows 本地 Segoe UI 与微软雅黑。界面正文 15px，标签 14px，辅助文字 13px。页面标题 30px，内容条目标题 16px/650。文章写作使用 Times New Roman 与本地宋体衬线字体，标题 40px/700，正文 20px/1.65；窄屏标题 32px，正文 18px。一级有序条目上下留白 1.2em，连续条目与被说明段落分开的条目保持相同间距；子列表按实际层级缩进。正文分割线为 1px 浅灰色，上下各留白 1.8em。输入字段至少 16px，既有代码编辑保持等宽字体。

## Layout

桌面导航宽 260px，1100px 以下收紧至 228px。主工作区距离窗口上沿 12px，左上角 16px 圆角，以细边界区分导航与工作区。900px 及以下采用 56px 顶栏与菜单抽屉，主工作区恢复占满窗口。

内容页标题下是状态切换和新建操作，随后是搜索、筛选与排序。列表和工具区最大宽 1000px，居中排列。内容条目采用连续分隔行，约 116px 一行；有封面时展示真实封面，无封面时使用文件图标。标题下只显示更新时间、类型及已配置字段，不自动添加正文摘录或发布状态标签。右侧省略号菜单只放编辑、复制、删除三个操作，删除项使用红色并先确认。类型及自定义字段仍遵循现有内容类型配置，分页继续使用真实查询结果。

文章编辑参考用户提供的 Substack 编辑页：进入文章后收起管理导航，白色工作区占满窗口。顶部固定返回、保存状态、预览与发布，其下依次是文章设置栏和格式工具栏。文章设置栏常驻分类、标签、封面、发布选项、更多设置五个入口，按需就地展开；公开/私密和评论使用开关。正文保持居中，版心最大宽 816px，内边距 40px 28px 140px，标题和正文之间留 38px，不附带文章目录、摘要或状态徽标。文章不再使用右侧设置栏或右下角设置按钮。作者、网址、摘要、搜索分享和高级操作集中到“更多设置”的分类弹窗；规范地址、页面类型和来源核验不占常用界面。编辑页不显示收录勾选项，新内容默认允许抓取，既有文章的收录设置不被自动改写。检查、历史版本、本地草稿和发布状态仍在左下角“更多”。窄屏设置栏和格式栏分别在自身区域内横向滚动，不使整页溢出。

## Elevation & Depth

普通界面通过白色、浅灰和 1px 边界分区。列表只有一个外边框，条目之间使用分隔线；不把每篇文章套成独立悬浮卡片。弹窗保留原生 dialog 和遮罩行为。

## Shapes

控件使用 8px 圆角，导航 9px，内容列表 11px，工作区左上角 16px。图标使用既有 Lucide 线性图标。主操作保留橙底白字，其余操作采用白色或透明底。

## Components

多类型列表以“内容”作为导航与列表标题，条目显示类型；筛选到单一类型后，标题使用类型名称，条目省略重复类型。使用“新建内容”菜单明确选择类型；已有类型筛选时，新建按钮显示该类型名称。创建内容不改写列表的查询条件或页码。筛选面板收起后，额外生效条件与清除入口留在列表工具区下方。列表工具区保留“批量选择”入口，选择后显示批量编辑数量；取消选择与保存完成均清除已选项。700px 及以下将标题与新建操作放在同一行，状态切换独占下一行。媒体详情由容器统一控制字段间距，标签不叠加外边距。停用广告默认收起表单，编辑与启用相互独立。图片裁切同时支持拖动和键盘调整，并保留重置入口与选区反馈。

内容检查中的可编辑错误能直接定位字段：弹窗外字段先关闭设置弹窗，复杂重复字段先打开对应编辑框，设置内字段切换到所属页签，随后滚动并聚焦。没有人工编辑入口的检查错误以文本呈现，不显示无效跳转按钮。

站点名称与 W 标记组成顶部站点卡，网站入口保留外链图标。常用管理功能直接显示，较少使用的功能继续在“更多管理”中展开；不新增 Substack 独有的播客、收入或聊天入口。

状态切换对应原有全部、已发布、草稿、有未发布修改及已归档查询，不显示虚构数量。筛选保留类型、可见性与自定义字段；排序默认最近修改，仍可切换原有排序方式。内容条目保留打开、自定义字段显示与批量选择能力。统计、设置、媒体、页面设计等功能继续使用各自已有布局与控件，并继承共享配色、字体与圆角。

格式工具栏保留既有段落格式、加粗、斜体、列表、代码、链接、媒体、撤销、重做及来源格式切换。保存、发布、加载和错误保持独立反馈。

文章设置与预览、发布共用桌面顶栏，窄屏时设置行换行并在区域内滚动。封面按高度限制等比缩小，完整保留图片。代码块使用块级布局，复制按钮位于编辑区之外，避免写入正文。正文修改默认保存为 Markdown，媒体和嵌入转为 Markdown 图片或链接；代码中的缩进、空行与列表内的代码围栏保持完整。已有笔记打开时从开头显示。

## Do's and Don'ts

- 以用户提供的 Substack 截图为当前视觉依据，替代旧蓝灰后台方案。
- 让真实内容、标题和操作形成层级，避免多余副标签和解释性装饰。
- 保留原有功能与 API，不为外观增加虚假的菜单、数字或操作。
- 通过控件换行、抽屉导航和区域内滚动适配窄窗口。
- 编辑页不恢复重复文章列表，不在标题下展示自动截取的摘要。
