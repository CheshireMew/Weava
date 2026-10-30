import { searchDatasetSchema } from './search-data.ts';
import { analyticsReportSchema, analyticsRealtimeSchema, analyticsVisitorDetailSchema, geoStatusSchema } from './analytics.ts';
import * as m from './api-models.ts';
import { z } from 'zod';
const { id,revision,nullableRevision,empty,jsonObject,record,save,page,entrySchema,entryRecord,entrySummaryRecord,typeSchema,settingsSchema,termSchema,layoutSchema,contentViewSchema,creationTemplateSchema,mediaGroupSchema,imagePresetSchema,mediaRecord,jobSchema } = m;
export interface ApiDefinition { method:'GET'|'POST'; path:string; summary:string; params:z.ZodType; query:z.ZodType; body:z.ZodType; response:z.ZodType; status:number; format:'json'|'csv'|'schema' }
const get = <P extends string,R extends z.ZodType,Q extends z.ZodType=typeof empty,A extends z.ZodType=typeof empty>(path:P,summary:string,response:R,query:Q=empty as unknown as Q,params:A=empty as unknown as A) => ({ method:'GET' as const,path,summary,params,query,body:z.undefined(),response,status:200,format:'json' as 'json'|'csv'|'schema' });
const post = <P extends string,B extends z.ZodType,R extends z.ZodType>(path:P,summary:string,body:B,response:R,status=200) => ({ method:'POST' as const,path,summary,params:empty,query:empty,body,response,status,format:'json' as 'json'|'csv'|'schema' });
const byId=z.object({ id }), byVersion=byId.extend({ revision }), pathId=z.object({ id });
const queryPage={ page:z.coerce.number<string|number>().int().min(1).optional(),pageSize:z.coerce.number<string|number>().int().min(1).max(100).optional() };
const optional=z.string().optional();
const contentQuery=z.object({ ...queryPage,limit:z.coerce.number<string|number>().int().min(1).max(100).optional(),kind:z.enum(['content','page','']).optional(),q:optional,type:optional,category:optional,tag:optional,sort:z.enum(['date','oldest','title','-title','publishedAt','-publishedAt','updatedAt','-updatedAt','']).optional(),status:z.enum(['all','published','changed','draft','archived','']).optional(),visibility:z.enum(['all','public','private','']).optional() }).catchall(z.string()).describe('Additional field.KEY parameters filter fields declared filterable by the selected type.');
const analyticsQuery=z.object({ start:optional,end:optional,path:optional,channel:optional,country:optional,browser:optional,os:optional,device:optional,model:optional,page:z.coerce.number<string|number>().int().min(0).optional(),dataset:optional,group:optional,id:optional });
const totals=z.object({ count:z.number(),bytes:z.number() });
const rowList=z.array(jsonObject);
const references=z.object({ working:z.array(z.object({ id,title:z.string(),path:z.string() })),published:z.array(z.object({ id,title:z.string(),path:z.string() })),layouts:z.array(z.object({ id,label:z.string() })),settings:z.boolean(),historicalRevisions:z.number() });
const planRecord=record(m.planValue),scheduleRecord=record(m.scheduleValue);
const mediaMetadata=z.object({ name:z.string(),alt:optional,caption:optional,groupId:z.string().nullable().optional(),focalPoint:m.focalPoint.optional() });
const imageVariant=z.object({ id,revision,presetId:id.optional(),spec:m.imageSpecSchema.optional() }).refine((v)=>!!v.presetId!==!!v.spec,{message:'请选择一种图片规格输入方式。'});
const redirectRecords=z.array(z.object({ id,revision:nullableRevision,updatedAt:z.string(),value:m.redirectSchema }));
const exportSchema=z.object({ version:z.number(),schemas:jsonObject,types:z.array(z.object({ id,revision,definition:typeSchema,schema:jsonObject })),rules:z.record(z.string(),z.string()) });
const schemaResult=z.union([exportSchema,z.looseObject({ openapi:z.literal('3.1.0'),info:jsonObject,servers:z.array(jsonObject),security:z.array(jsonObject),components:jsonObject,paths:jsonObject }),z.string()]);
const archiveContents=z.object({ id,releases:z.array(z.object({ id,createdAt:z.string() })),revisions:z.array(z.object({ revision,id,scope:z.string(),createdAt:z.string(),label:z.string() })) });

/** This registry is consumed by HTTP validation, the typed client, and OpenAPI.
 * Open-ended JSON is limited to extension-defined data, operation-specific job
 * results and dimension/report rows; request envelopes and response structure
 * remain declared. Domain validation still checks content rules and revisions.
 */
export const adminApi = {
  session:get('session','读取登录状态',z.object({ authenticated:z.boolean(),initialized:z.boolean(),version:z.string() })),
  login:post('login','登录',z.object({ password:z.string() }),z.object({ authenticated:z.literal(true) })),
  logout:post('logout','退出登录',empty,z.object({ ok:z.literal(true) })),
  schema:{ ...get('schema','导出实例模型、API 或类型',schemaResult,z.object({ format:z.enum(['json','openapi','types']).optional() })),format:'schema' as const },
  state:get('state','读取后台状态',m.stateSchema,z.object({ summary:z.enum(['0','1']).optional() })),
  entries:get('entries','列出工作稿摘要',z.array(entrySummaryRecord)),
  queryEntries:get('entries/query','查询工作稿摘要',page(entrySummaryRecord),contentQuery),
  createEntry:post('entries/create','新建内容',z.object({ kind:z.enum(['content','page']),type:optional,templateId:optional,title:optional,path:optional }),entryRecord),
  getEntry:get('entry/{id}','读取完整工作稿',entryRecord,empty,pathId),
  saveEntry:post('entry','保存工作稿',save(entrySchema),entryRecord),
  checkEntry:post('entry/check','检查未保存候选',z.object({ value:z.unknown(),required:z.boolean().optional() }),m.entryCheck),
  structureEntry:post('entry/structure','把正文转换为区块',z.object({ value:entrySchema }),z.array(m.blockSchema)),
  previewBulk:post('entries/bulk/preview','预检批量元信息',m.bulkInput,m.bulkPreview),
  applyBulk:post('entries/bulk/apply','保存已预检的批量元信息',m.bulkInput.extend({ review:z.string() }),z.array(entryRecord)),
  queryReferences:get('references/query','查询允许引用的内容',page(entryRecord),z.object({ ...queryPage,types:optional,filters:optional,q:optional })),
  settings:get('settings','读取网站设置',record(settingsSchema)),
  saveSettings:post('settings','保存网站设置',z.object({ value:settingsSchema,revision }),record(settingsSchema)),
  types:get('types','列出内容类型',z.array(record(typeSchema))),
  saveType:post('types','保存内容类型',save(typeSchema),record(typeSchema)),
  terms:get('terms','列出分类和标签',z.array(record(termSchema))),
  saveTerm:post('terms','保存分类或标签',save(termSchema),record(termSchema)),
  layouts:get('layouts','列出模板、组合和共享区域',z.array(m.layoutRecord)),
  saveLayout:post('layouts','保存模板、组合或共享区域',save(layoutSchema),record(layoutSchema)),
  views:get('authoring/views','列出常用筛选',z.array(record(contentViewSchema))),
  saveView:post('authoring/views','保存常用筛选',save(contentViewSchema),record(contentViewSchema)),
  templates:get('authoring/templates','列出新建模板',z.array(record(creationTemplateSchema))),
  saveTemplate:post('authoring/templates','保存新建模板',save(creationTemplateSchema),record(creationTemplateSchema)),
  publication:post('publication','预检冻结的发布内容',m.publishOptions,m.publicationReview),
  publish:post('publish','执行发布任务',m.publishOptions,jobSchema,202),
  withdraw:post('withdraw','撤下内容或归档',byVersion.extend({ archive:z.boolean().optional() }),entryRecord),
  rollback:post('rollback','切换至历史公开版本',byId,m.releaseSchema),
  schedules:get('schedules','列出单篇定时发布',z.array(scheduleRecord)),
  schedule:post('schedule','安排固定修订的定时发布',byVersion.extend({ dueAt:z.string() }),scheduleRecord),
  cancelSchedule:post('schedule/cancel','取消定时发布',byVersion,scheduleRecord),
  retrySchedule:post('schedule/retry','重试定时发布',byVersion,scheduleRecord),
  plans:get('plans','列出组合发布计划',z.array(planRecord)),
  savePlan:post('plans','保存组合发布计划',save(m.planDefinition),planRecord),
  planEntry:get('plans/entry','读取计划可用修订',byVersion.extend({ title:z.string(),publishedRevision:revision.optional() }),byId),
  previewPlan:post('plans/preview','预检组合发布计划',byVersion,z.object({ plan:planRecord,review:m.publicationReview })),
  runPlan:post('plans/run','执行已检查的组合发布计划',byVersion.extend({ options:m.publishOptions }),jobSchema,202),
  cancelPlan:post('plans/cancel','取消组合发布计划',byVersion,planRecord),
  redirects:get('redirects','列出网址别名',redirectRecords),
  previewRedirects:post('redirects/preview','预检别名批次',m.redirectBatch,m.redirectPreview),
  saveRedirects:post('redirects/save','保存已检查的别名批次',m.redirectBatch.extend({ review:z.string() }),redirectRecords),
  history:get('history','列出内容修订',z.array(z.object({ revision,createdAt:z.string(),label:z.string() })),byId),
  revision:get('revision','读取指定历史修订',m.historicalEntry,byId.extend({ version:z.coerce.number<string|number>().int().positive() })),
  compareRevisions:get('revision/compare','比较两份修订',z.object({ before:m.historicalEntry,after:m.historicalEntry,changes:z.array(m.change) }),byId.extend({ from:z.coerce.number<string|number>().int().positive(),to:z.coerce.number<string|number>().int().positive() })),
  mergeEntry:post('entry/merge','比较与合并工作稿',m.mergeInput,m.mergePreview),
  saveMerge:post('entry/merge/save','保存已解决冲突的合并',m.mergeInput.extend({ currentRevision:revision }),entryRecord),
  restore:post('restore','恢复历史修订为新工作稿',byVersion.extend({ version:revision }),entryRecord),
  media:get('media','列出媒体',z.array(mediaRecord)),
  uploadMedia:post('media','上传媒体并生成派生图',z.object({ name:z.string(),base64:z.string() }),jobSchema,202),
  mediaQuery:get('media/query','查询媒体',page(mediaRecord),z.object({ ...queryPage,q:optional,kind:z.enum(['image','video','audio','file','']).optional(),group:optional,archived:z.enum(['true','false']).optional() })),
  mediaInfo:post('media/info','保存媒体说明、分组和焦点',byVersion.extend({ value:mediaMetadata }),mediaRecord),
  mediaReferences:get('media/references','查询媒体引用',references,byId),
  archiveMedia:post('media/archive','归档或恢复媒体',z.object({ items:z.array(m.actionVersion),archived:z.boolean() }),z.array(mediaRecord)),
  cropMedia:post('media/crop','生成裁切副本',byVersion.extend({ crop:z.object({ left:z.number(),top:z.number(),width:z.number(),height:z.number() }) }),jobSchema,202),
  groups:get('media/groups','列出媒体分组',z.array(record(mediaGroupSchema))),
  saveGroup:post('media/groups','保存媒体分组',save(mediaGroupSchema),record(mediaGroupSchema)),
  moveMedia:post('media/move','整批移动媒体分组',z.object({ items:z.array(m.actionVersion),groupId:z.string().nullable().optional() }),z.array(mediaRecord)),
  imagePresets:get('media/presets','列出图片规格',z.array(record(imagePresetSchema))),
  saveImagePreset:post('media/presets','保存图片规格',save(imagePresetSchema),record(imagePresetSchema)),
  variants:get('media/variants','列出已生成图片规格',z.array(m.variantRecord),byId),
  imageVariant:post('media/variant','生成或复用图片规格',imageVariant,jobSchema,202),
  comments:get('comments','查询评论',z.object({ items:z.array(m.commentSchema.extend({ title:z.string(),path:z.string() })),total:z.number(),hasMore:z.boolean() }),z.object({ status:z.enum(['all','visible','hidden','pending']).optional(),page:z.coerce.number<string|number>().int().min(1).optional() })),
  moderateComment:post('comment','审核或隐藏评论',z.object({ id,status:z.enum(['visible','hidden']) }),z.object({ id,status:z.enum(['visible','hidden']) })),
  extensions:get('extensions','列出扩展诊断',z.array(m.extensionDiagnostic)),
  extensionUsage:get('extensions/usage','查询扩展引用',z.array(m.usage),byId),
  toggleExtension:post('extensions/toggle','切换扩展状态',z.object({ id,enabled:z.boolean(),revision:nullableRevision.optional() }),z.array(m.extensionDiagnostic)),
  maintenance:get('maintenance','读取存储使用',z.object({ databaseBytes:z.number(),analyticsBytes:z.number(),versions:totals,releases:totals,publicationObjects:z.array(z.object({ kind:z.string(),count:z.number(),bytes:z.number().nullable() })),media:totals,unreferenced:totals.extend({ files:z.array(z.object({ path:z.string(),bytes:z.number() })) }),backups:z.array(z.object({ path:z.string(),bytes:z.number() })) })),
  previewArchive:post('maintenance/preview','预检历史归档',m.retention,m.archivePreview),
  archiveHistory:post('maintenance/archive','执行已预检的历史归档',z.object({ options:m.retention,review:z.string() }),jobSchema,202),
  restoreArchive:post('maintenance/restore','恢复已归档历史',byId,jobSchema,202),
  archives:get('maintenance/archives','列出历史归档',z.array(m.archiveInfo)),
  archiveContents:get('maintenance/archive','读取归档清单',archiveContents,byId),
  jobs:get('jobs','列出后台任务',z.array(jobSchema)),
  job:get('job/{id}','读取任务进度',jobSchema,empty,pathId),
  logs:get('logs','分段读取任务日志',z.object({ text:z.string(),start:z.number(),end:z.number(),total:z.number(),truncated:z.boolean() }),byId.extend({ offset:z.coerce.number<string|number>().nonnegative().optional() })),
  backup:post('backup','创建完整站点备份',z.object({ path:z.string() }),jobSchema,202),
  verify:post('verify','校验站点备份',z.object({ path:z.string() }),jobSchema,202),
  export:get('export','导出内容交换文件',m.exchange),
  import:post('import','预检或导入内容交换文件',z.object({ value:m.exchange,options:m.importOptions.optional() }),m.importResult),
  importRevisions:get('import/revisions','读取可合并对象的修订',z.record(z.string(),revision)),
  importWxr:post('import/wxr','预检或后台导入 WordPress',z.object({ xml:z.string(),options:m.wxrOptions.optional() }),z.union([m.wxrReport,jobSchema]),202),
  seoAudit:post('seo/audit','检查公开或候选页面',z.object({ target:z.enum(['draft','published']).optional(),http:z.boolean().optional(),options:m.publishOptions.optional() }),m.seoAudit),
  seoAudits:get('seo/audits','列出 SEO 检查报告',z.array(m.seoAudit)),
  seoMetadata:get('seo/metadata','读取最终页面元信息',m.metadata,byId.extend({ path:optional })),
  searchData:get('search-data','读取搜索与观测报告',z.object({ status:z.enum(['available','not-connected']),datasets:rowList,capabilities:z.array(z.string()),notes:z.array(z.string()).optional() })),
  importSearchData:post('search-data/import','导入外部搜索观测数据',searchDatasetSchema,z.object({ id,imported:z.number(),rows:z.number(),unchanged:z.boolean() })),
  analytics:get('analytics','读取访问统计报告',analyticsReportSchema,analyticsQuery),
  realtime:get('analytics/realtime','读取实时访客',analyticsRealtimeSchema,analyticsQuery),
  visitor:get('analytics/visitor','读取访客轨迹',analyticsVisitorDetailSchema,analyticsQuery.extend({ id })),
  geo:get('analytics/geo','读取地区库状态',geoStatusSchema),
  updateGeo:post('analytics/geo','更新地区库',empty,geoStatusSchema,202),
  exportAnalytics:{ ...get('analytics/export','导出访问统计 CSV',z.string(),analyticsQuery),format:'csv' as const },
} as const;
export type AdminApi = typeof adminApi;
export type ApiOperation = keyof AdminApi;
export const idempotentOperations:readonly ApiOperation[]=['publish','runPlan','uploadMedia','cropMedia','imageVariant','backup','verify','importWxr'];
export type ApiInput<K extends ApiOperation> = { params:z.input<AdminApi[K]['params']>;query:z.input<AdminApi[K]['query']>;body:z.input<AdminApi[K]['body']> };
export type ApiOutput<K extends ApiOperation> = z.output<AdminApi[K]['response']>;
export type ContractMatch = { operation:ApiOperation; definition:ApiDefinition; params:Record<string,string> };
export function matchAdminApi(method:string,path:string):ContractMatch | undefined {
  const normalized=path.split('?')[0];
  for (const [operation,definition] of Object.entries(adminApi)) {
    if (definition.method!==method) continue;
    const names:string[]=[];
    const pattern=definition.path.split('/').map((part)=>part.startsWith('{') ? (names.push(part.slice(1,-1)), '([^/]+)') : part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/');
    const matched=new RegExp('^'+pattern+'$').exec(normalized);
    if (matched) return { operation:operation as ApiOperation,definition,params:Object.fromEntries(names.map((name,index)=>[name,decodeURIComponent(matched[index+1])])) };
  }
}
export function validateApiInput(match:ContractMatch,query:URLSearchParams,body:unknown) {
  return { params:match.definition.params.parse(match.params),query:match.definition.query.parse(Object.fromEntries(query)),body:match.definition.body.parse(body) };
}
