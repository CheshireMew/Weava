export const schemaTypeLabels: Record<string, string> = {
  Article: '文章', TechArticle: '技术文章', WebPage: '普通页面', CollectionPage: '内容列表',
  AboutPage: '关于页面', ProfilePage: '个人介绍', Product: '产品',
  SoftwareApplication: '软件应用', CreativeWork: '创作作品',
};
export const operationLabels: Record<string, string> = {
  publish: '发布网站', backup: '创建备份', verify: '检查备份', import: '导入内容',
  'import-wxr': '导入 WordPress', 'maintenance-archive': '归档历史', 'maintenance-restore': '恢复历史',
  'archive-history': '归档历史', 'restore-history': '恢复历史', 'preflight-wxr': '检查 WordPress 导入',
  media: '上传媒体', 'media-edit': '裁切图片', 'media-variant': '生成图片规格',
};
export const jobStatusLabels: Record<string, string> = {
  queued: '等待处理', running: '处理中', complete: '已完成', failed: '失败', cancelled: '已取消',
};
export const datasetLabels: Record<string, string> = {
  'search-performance': '搜索表现', 'ai-observations': 'AI 回答记录',
  'keyword-rank': '关键词排名', 'web-analytics': '网站访问数据',
};
