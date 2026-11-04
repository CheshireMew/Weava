---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/ContentLibrary.tsx","src/ContentEntries.tsx","src/EntryEditor.tsx","src/AdminNavigation.tsx","src/style.css","src/AnalyticsPanel.css"]
---

# 管理后台优化

范围：管理后台视觉与内容目录；保留现有功能、数据和 API，访客主题不在范围内。

## Direction contract

THESIS：2026-11-04 用户改选以其提供的 Substack 截图为视觉依据，模仿现代出版后台的配色、留白与层次；保留 Weava 现有功能，不强行复制 Substack 的业务结构。

OWN-WORLD：浅灰导航 #FAFAFA、白色工作区、深灰文字 #303030、橙色主操作 #D63D0B、中性导航选中态和细边界。发布状态沿用文字与语义色。

STORY：切换状态、搜索或筛选内容，打开独立文章编辑页，再检查、预览和发布。目录不与编辑区重复出现，标题下不显示摘要。

FIRST VIEWPORT：1440px 桌面260px导航，工作区上方12px留白及左上16px圆角；内容页有30px标题、状态切换与新建、搜索筛选排序、最大1000px居中列表，条目显示真实封面或文件图标、标题、更新时间与状态。900px以下改抽屉导航。写作区最大900px、36px标题，700px以下28px。

FORM：用户所附 codex-clipboard-2f50e84d-fb9d-482c-bd6d-9e9d8e6c60f7.png 是本轮视觉依据，覆盖此前蓝色目录方案。保留简化菜单、已有批量与字段配置能力、保存与发布语义，以及不重复展示文章列表和摘要的后续要求。
