import { maximumMediaUploadBytes } from './media-rules.ts';
import {contentSorts} from './content-query.ts';
import { searchDatasetSchema } from './search-data.ts';
import { analyticsReportSchema, analyticsRealtimeSchema, analyticsVisitorDetailSchema, geoStatusSchema } from './analytics.ts';
import * as m from './api-models.ts';
import {siteInfoSchema} from './site-info.ts';
import * as z from 'zod';
import {writingSnippetSchema} from './writing.ts';
import { accountProof, sessionResult, loginBody, loginResult, logoutResult,accountAccessBody,accountAccessResult,completeAccountAccessBody,completeAccountAccessResult } from './session-api.ts';
const { id,revision,nullableRevision,empty,jsonObject,record,save,page,entrySchema,entryRecord,entrySummaryRecord,typeSchema,settingsSchema,termSchema,layoutSchema,contentViewSchema,creationTemplateSchema,mediaGroupSchema,imagePresetSchema,mediaRecord,jobSchema } = m;
export interface ApiDefinition { method:'GET'|'POST'; path:string; summary:string; params:z.ZodType; query:z.ZodType; body:z.ZodType; response:z.ZodType; status:number; format:'json'|'csv'|'schema';binary?:boolean;stream?:boolean }
const get = <P extends string,R extends z.ZodType,Q extends z.ZodType=typeof empty,A extends z.ZodType=typeof empty>(path:P,summary:string,response:R,query:Q=empty as unknown as Q,params:A=empty as unknown as A) => ({ method:'GET' as const,path,summary,params,query,body:z.undefined(),response,status:200,format:'json' as 'json'|'csv'|'schema' });
const post = <P extends string,B extends z.ZodType,R extends z.ZodType>(path:P,summary:string,body:B,response:R,status=200) => ({ method:'POST' as const,path,summary,params:empty,query:empty,body,response,status,format:'json' as 'json'|'csv'|'schema' });
const byId=z.object({ id }), byVersion=byId.extend({ revision }), pathId=z.object({ id });
const queryPage={ page:z.coerce.number<string|number>().int().min(1).optional(),pageSize:z.coerce.number<string|number>().int().min(1).max(100).optional() };
const optional=z.string().optional();
const contentQuery=z.object({ ...queryPage,limit:z.coerce.number<string|number>().int().min(1).max(100).optional(),kind:z.enum(['content','page','']).optional(),q:optional,type:optional,author:optional,category:optional,tag:optional,sort:z.enum([...contentSorts,'']).optional(),status:z.enum(['all','published','changed','draft','archived','scheduled','schedule-failed','']).optional(),visibility:z.enum(['all','public','private','']).optional() }).catchall(z.string()).describe('Additional field.KEY parameters filter fields declared filterable by the selected type.');
const analyticsQuery=z.object({ section:z.enum(["all","overview","sources","visitors","devices","actions","filters"]).optional(),start:optional,end:optional,path:optional,channel:optional,country:optional,browser:optional,os:optional,device:optional,model:optional,page:z.coerce.number<string|number>().int().min(0).optional(),dataset:optional,group:optional,id:optional });
const totals=z.object({ count:z.number(),bytes:z.number() });
const rowList=z.array(jsonObject);
const markdownOptions=z.object({type:z.string().optional(),merge:z.boolean().optional(),settings:z.boolean().optional(),review:z.string().optional(),budgetBytes:z.number().int().min(1024).optional()});
const collectionHealth=z.object({collecting:z.boolean(),reason:z.string(),bytes:z.number(),maximumBytes:z.number(),freeBytes:z.number(),minimumFreeBytes:z.number(),dailyEvents:z.number(),dailyLimit:z.number(),resetAt:z.number().nullable(),lastAcceptedAt:z.string().nullable(),archives:z.number(),archivedBefore:z.string().nullable()});
const discovery=z.object({dataset:z.enum(['search','missing']),start:z.string(),end:z.string(),page:z.number(),pageSize:z.number(),pages:z.number(),total:z.number(),items:z.array(z.object({query:z.string(),searches:z.number(),emptyResults:z.number(),clickedSearches:z.number(),clicks:z.number(),lastSeen:z.string()})),missing:z.array(z.object({path:z.string(),referrer:z.string(),requests:z.number(),lastSeen:z.string()}))});
const backupPolicyValue=z.object({enabled:z.boolean(),path:z.string().min(1),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)});
const backupPolicyRecord=z.object({id,revision:nullableRevision,updatedAt:z.string(),value:backupPolicyValue,timezone:z.string()});
const event=z.object({seq:z.number(),id,type:z.string(),createdAt:z.string(),data:jsonObject});
const eventConsumer=z.object({id,cursor:z.number(),types:z.array(z.string()),attempts:z.number(),retryAt:z.number(),leaseUntil:z.number(),error:z.string(),failed:z.boolean()});
const references=z.object({ working:z.array(z.object({ id,title:z.string(),path:z.string() })),published:z.array(z.object({ id,title:z.string(),path:z.string() })),layouts:z.array(z.object({ id,label:z.string() })),settings:z.boolean(),historicalRevisions:z.number() });
const planRecord=record(m.planValue),scheduleRecord=record(m.scheduleValue);
const mediaMetadata=z.object({ name:z.string(),alt:optional,caption:optional,groupId:z.string().nullable().optional(),focalPoint:m.focalPoint.optional() });
const uploadState=z.object({id,name:z.string(),size:z.number(),offset:z.number(),status:z.string(),sha256:z.string().nullable(),expiresAt:z.string(),chunkBytes:z.number(),jobId:id.optional()});
const temporaryCleanup=z.object({review:z.string(),bytes:z.number(),files:z.array(z.object({id,kind:z.enum(['upload','request']),path:z.string(),bytes:z.number()})),skipped:z.array(z.object({path:z.string(),reason:z.string()}))});
const imageVariant=z.object({ id,revision,presetId:id.optional(),spec:m.imageSpecSchema.optional() }).refine((v)=>!!v.presetId!==!!v.spec,{message:'请选择一种图片规格输入方式。'});
const redirectRecords=z.array(z.object({ id,revision:nullableRevision,updatedAt:z.string(),value:m.redirectSchema }));
const exportSchema=z.object({ version:z.number(),schemas:jsonObject,types:z.array(z.object({ id,revision,definition:typeSchema,schema:jsonObject })),rules:z.record(z.string(),z.string()) });
const schemaResult=z.union([exportSchema,z.looseObject({ openapi:z.literal('3.1.0'),info:jsonObject,servers:z.array(jsonObject),security:z.array(jsonObject),components:jsonObject,paths:jsonObject }),z.string()]);
const archiveContents=z.object({ id,page:z.number(),pageSize:z.number(),pages:z.number(),totalReleases:z.number(),totalRevisions:z.number(),releases:z.array(z.object({ id,createdAt:z.string() })),revisions:z.array(z.object({ revision,id,scope:z.string(),createdAt:z.string(),label:z.string() })) });
const account=z.object({ username:z.string(),displayName:z.string(),adminPath:z.string(),twoFactorEnabled:z.boolean(),recoveryCodesRemaining:z.number(),events:z.array(z.object({id:z.number(),createdAt:z.string(),event:z.string(),source:z.string()})),sessions:z.array(z.object({ id:z.string(),createdAt:z.string().nullable(),lastSeen:z.string().nullable(),expiresAt:z.string(),browser:z.string(),os:z.string(),userAgent:z.string(),current:z.boolean() })) });

/** This registry is consumed by HTTP validation, the typed client, and OpenAPI.
 * Open-ended JSON is limited to extension-defined data, operation-specific job
 * results and dimension/report rows; request envelopes and response structure
 * remain declared. Domain validation still checks content rules and revisions.
 */
export const adminApi = {
  previewAnalyticsArchive:post('analytics/archive/preview','预检 UTC 截止日期之前的统计明细；保留汇总和可恢复文件',z.object({before:z.string()}),z.object({before:z.string(),cutoff:z.string(),review:z.string(),events:z.number(),context:z.number(),activity:z.number(),views:z.number(),clicks:z.number(),estimatedBytes:z.number()})),
  archiveAnalytics:post('analytics/archive','执行已检查的统计明细归档，最多默认新增 1 GiB',z.object({before:z.string(),review:z.string(),budgetBytes:z.number().int().min(1024).optional()}),jobSchema,202),
  analyticsArchives:get('analytics/archives','列出统计归档及恢复状态',z.array(z.object({id,path:z.string(),createdAt:z.string(),before:z.string(),bytes:z.number(),events:z.number(),views:z.number(),clicks:z.number(),restoredAt:z.string().nullable()}))),
  analyticsArchiveDays:get('analytics/archive/days','读取 UTC 每日每页的归档汇总，独立于在线明细报告',z.object({start:z.string(),end:z.string(),page:z.number(),pages:z.number(),total:z.number(),items:z.array(z.object({day:z.string(),path:z.string(),views:z.number(),clicks:z.number(),visitors:z.number(),sessions:z.number()}))}),z.object({start:z.string(),end:z.string(),page:z.coerce.number<string|number>().int().min(1).optional()})),
  restoreAnalyticsArchive:post('analytics/archive/restore','校验并恢复统计明细归档',z.object({id}),jobSchema,202),
  markdownExport:post('export/markdown','导出 Markdown 目录、元数据和本地媒体；不压缩，不覆盖已有资料',z.object({path:z.string().min(1),budgetBytes:z.number().int().min(1024).optional()}),jobSchema,202),
  markdownPreview:post('import/markdown/preview','预检 Markdown 文件夹和媒体，返回冻结检查凭据',z.object({path:z.string().min(1),options:markdownOptions.optional()}),jobSchema,202),
  markdownImport:post('import/markdown','按预检凭据导入 Markdown 目录，修订变化时拒绝',z.object({path:z.string().min(1),options:markdownOptions.extend({review:z.string().min(1)})}),jobSchema,202),
  analyticsHealth:get('analytics/health','统计采集状态、最近接收时间、容量及今日预算',collectionHealth),
  analyticsDiscovery:get('analytics/discovery','按站点时区查看站内搜索词、无结果、后续点击或访客 404',discovery,z.object({start:z.string().optional(),end:z.string().optional(),page:z.coerce.number<string|number>().int().min(1).optional(),dataset:z.enum(['search','missing']).optional()})),
  backupPolicy:get('backup/policy','读取每日备份时间和保存位置',backupPolicyRecord),
  saveBackupPolicy:post('backup/policy','保存每日备份计划；停机后补最近一次',z.object({value:backupPolicyValue,revision:nullableRevision}),backupPolicyRecord),
  backupInventory:get('backup/inventory','读取备份清单、校验记录和最近任务',z.object({path:z.string(),items:z.array(z.object({id,path:z.string(),createdAt:z.string(),label:z.string(),files:z.number(),verifiedAt:z.string().nullable(),error:z.string()})),jobs:z.array(jobSchema)}),z.object({path:z.string().optional()})),
  events:get('events','按稳定序号读取事件；重试返回相同事件编号',z.array(event),z.object({after:z.coerce.number<string|number>().int().min(0).optional(),limit:z.coerce.number<string|number>().int().min(1).max(100).optional(),types:z.string().optional()})),
  eventConsumers:get('events/consumers','查看事件消费方、租约和失败状态',z.array(eventConsumer)),
  registerEventConsumer:post('events/consumers','登记外部消费方及起始序号',z.object({id,after:z.number().int().min(0),types:z.array(z.string().min(1)).max(30).optional()}),z.object({id,cursor:z.number()})),
  claimEvents:post('events/claim','取得两分钟事件租约；重复投递沿用事件编号',z.object({id}),z.object({token:z.string().nullable(),leaseUntil:z.number(),events:z.array(event),cursor:z.number()})),
  finishEvents:post('events/finish','确认成功推进游标，或报告失败等待退避重试',z.object({id,token:z.string().min(1),error:z.string().max(2000).optional()}),z.object({id,cursor:z.number()})),
  retryEvents:post('events/retry','检查后显式重试失败批次；不抢占有效租约',z.object({id}),z.object({id,cursor:z.number()})),
  session:get('session','读取登录状态',sessionResult),
  login:post('login','登录',loginBody,loginResult),
  logout:post('logout','退出登录',empty,logoutResult),
  accountAccess:post('account-access','检查本机发放的一次性账户设置链接',accountAccessBody,accountAccessResult),
  completeAccountAccess:post('account-access/complete','使用一次性链接设置账户，然后正常登录',completeAccountAccessBody,completeAccountAccessResult),
  account:get('account','读取站主资料和登录会话',account),
  saveAccount:post('account','更新站主资料；更改账户名或密码时验证身份',accountProof.partial({password:true}).extend({username:z.string().min(3).max(64),displayName:z.string().min(1).max(80),newPassword:z.string().max(1024).optional()}),z.object({ok:z.literal(true),loginRequired:z.boolean()})),
  revokeSession:post('account/sessions/revoke','撤销登录会话',accountProof.extend({id:z.string().regex(/^(others|[a-f0-9]{64})$/)}),z.object({ok:z.literal(true)})),
  beginTwoFactor:post('account/two-factor/begin','准备两步验证',accountProof,z.object({secret:z.string(),uri:z.string()})),
  confirmTwoFactor:post('account/two-factor/confirm','确认两步验证并取得一次性恢复码',accountProof.extend({code:z.string().regex(/^\d{6}$/)}),z.object({recoveryCodes:z.array(z.string())})),
  disableTwoFactor:post('account/two-factor/disable','关闭两步验证',accountProof.extend({code:z.string().min(1).max(100)}),z.object({ok:z.literal(true)})),
  renewRecoveryCodes:post('account/two-factor/recovery-codes','重新生成恢复码并撤销全部网页登录',accountProof.extend({code:z.string().min(1).max(100)}),z.object({recoveryCodes:z.array(z.string())})),
  changeAdminPath:post('account/admin-path','更改私有后台入口',accountProof.extend({path:z.string().max(81)}),z.object({adminPath:z.string()})),
  rotateCliToken:post('account/cli-token','轮换 CLI 令牌，可同时撤销全部网页登录',accountProof.extend({revokeSessions:z.boolean()}),z.object({updated:z.literal(true),loginRequired:z.boolean()})),
  schema:{ ...get('schema','导出实例模型、API 或类型',schemaResult,z.object({ format:z.enum(['json','openapi','types']).optional() })),format:'schema' as const },
  state:get('state','读取后台状态',m.stateSchema,z.object({ summary:z.enum(['0','1']).optional(),panel:z.string().optional(),entryId:z.string().optional() })),
  entries:get('entries','列出工作稿摘要',z.array(entrySummaryRecord)),
  queryEntries:get('entries/query','查询工作稿摘要',page(entrySummaryRecord),contentQuery.extend({format:z.enum(['article','note']).optional(),group:z.enum(['published','scheduled','draft']).optional()})),
  createEntry:post('entries/create','新建内容',z.object({ kind:z.enum(['content','page']),type:optional,templateId:optional,title:optional,path:optional }),entryRecord),
  duplicateEntry:post('entries/duplicate','复制为独立草稿',byVersion,entryRecord),
  deleteEntry:post('entries/delete','移入回收站并撤下公开页面，保留历史快照和共享媒体',byVersion,jobSchema,202),
  trash:get('entries/trash','分页读取回收站',page(z.object({id,revision,title:z.string(),path:z.string(),kind:z.enum(['content','page']),type:z.string(),deletedAt:z.string()})),z.object({...queryPage,q:z.string().optional(),kind:z.enum(['content','page']).optional()})),
  restoreTrash:post('entries/trash/restore','恢复回收站内容为草稿',byVersion,entryRecord),
  purgeTrash:post('entries/trash/purge','明确确认后永久移出回收站；历史快照按独立策略保留',byVersion.extend({confirmation:z.literal('永久删除')}),z.object({id})),
  getEntry:get('entry/{id}','读取完整工作稿',entryRecord,empty,pathId),
  saveEntry:post('entry','保存工作稿',save(entrySchema),entryRecord),
  checkEntry:post('entry/check','检查未保存候选',z.object({ value:z.unknown(),required:z.boolean().optional() }),m.entryCheck),
  structureEntry:post('entry/structure','把正文转换为区块',z.object({ value:entrySchema }),z.array(m.blockSchema)),
  previewBulk:post('entries/bulk/preview','预检批量元信息',m.bulkInput,m.bulkPreview),
  applyBulk:post('entries/bulk/apply','保存已预检的批量元信息',m.bulkInput.extend({ review:z.string() }),z.array(entryRecord)),
  queryReferences:get('references/query','查询允许引用的内容摘要',page(m.referenceRecord),z.object({ ...queryPage,types:optional,filters:optional,q:optional })),
  settings:get('settings','读取网站设置',record(settingsSchema)),
  siteInfo:get('settings/site-info','按需读取已配置或旧页面中的网站介绍和友链',siteInfoSchema),
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
  snippets:get('authoring/snippets','列出常用内容',z.array(record(writingSnippetSchema))),
  saveSnippet:post('authoring/snippets','保存或归档常用内容',save(writingSnippetSchema),record(writingSnippetSchema)),
  publication:post('publication','预检冻结的发布内容',m.publishOptions,m.publicationReview),
  publish:post('publish','执行发布任务',m.publishOptions,jobSchema,202),
  withdraw:post('withdraw','撤下内容或归档',byVersion.extend({ archive:z.boolean().optional() }),jobSchema,202),
  previewRollback:post('rollback/preview','查看历史公开版本恢复差异',byId,m.rollbackReview),
  rollback:post('rollback','切换至历史公开版本',byId.extend({baseReleaseId:id.nullable().optional(),review:z.string().optional()}),z.object({ releaseId:id })),
  schedules:get('schedules','列出单篇定时发布',z.array(scheduleRecord),z.object({entryId:z.string().optional()})),
  schedule:post('schedule','安排固定修订的定时发布',byVersion.extend({ dueAt:z.string() }),jobSchema,202),
  cancelSchedule:post('schedule/cancel','取消定时发布',byVersion,scheduleRecord),
  retrySchedule:post('schedule/retry','重试定时发布',byVersion,scheduleRecord),
  plans:get('plans','列出组合发布计划',z.array(planRecord)),
  savePlan:post('plans','保存组合发布计划',save(m.planDefinition),jobSchema,202),
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
  uploadMediaFile:{...post('media/file','流式上传原文件并立即返回可用媒体；图片优化在后台执行',z.unknown(),mediaRecord),query:z.object({name:z.string().min(1).max(300),groupId:id.optional()}),binary:true},
  optimizeMedia:post('media/optimize','重试后台图片优化，原图保持可用',byId,jobSchema.nullable(),202),
  uploadMedia:post('media','处理完整上传，兼容旧版 base64 上传',z.union([z.object({uploadId:id}),z.object({ name:z.string(),base64:z.string() })]),jobSchema,202),
  beginUpload:post('media/uploads','创建经过内容校验的可续传上传',z.object({name:z.string().min(1).max(300),size:z.number().int().min(1).max(maximumMediaUploadBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)}),uploadState),
  uploadStatus:get('media/uploads/{id}','读取上传位置和处理任务',uploadState,empty,pathId),
  cancelUpload:post('media/uploads/cancel','取消尚未处理完成的上传，暂存文件等待预检清理',byId,z.object({id,status:z.string()})),
  uploadChunk:{...post('media/uploads/{id}','追加一份二进制分块（最多 1 MiB）',z.unknown(),uploadState),params:pathId,query:z.object({offset:z.coerce.number<string|number>().int().min(0)}),binary:true},
  mediaQuery:get('media/query','查询媒体',page(mediaRecord),z.object({ ...queryPage,q:optional,kind:z.enum(['image','video','audio','file','']).optional(),group:optional,archived:z.enum(['true','false']).optional() })),
  mediaInfo:post('media/info','保存媒体说明、分组和焦点',byVersion.extend({ value:mediaMetadata }),mediaRecord),
  mediaReferences:get('media/references','查询媒体引用',references,byId),
  mediaLimits:get('media/limits','读取按媒体类型配置的上传及总暂存容量',m.mediaUploadLimits),
  previewMediaReplacement:post('media/replace/preview','预检当前工作稿中的媒体引用替换',z.object({fromId:id,toId:id,ids:z.array(id).min(1).max(200).optional()}),z.object({review:z.string(),from:z.string(),to:z.string(),items:z.array(z.object({id,revision,title:z.string(),path:z.string(),count:z.number()}))})),
  applyMediaReplacement:post('media/replace/apply','保存已预检的媒体引用替换；当前公开版本保持不变',z.object({fromId:id,toId:id,ids:z.array(id).min(1).max(200).optional(),review:z.string()}),z.object({items:z.array(z.object({id,revision,title:z.string()}))})),
  archiveMedia:post('media/archive','归档或恢复媒体',z.object({ items:z.array(m.actionVersion),archived:z.boolean() }),z.array(mediaRecord)),
  previewMediaDeletion:get('media/delete/preview','检查媒体能否删除',z.object({blocked:z.string().nullable()}),byId),
  deleteMedia:post('media/delete','永久删除未被引用的媒体及其独有文件',byVersion.extend({confirmation:z.literal('永久删除')}),z.object({id,cleanupPending:z.boolean()})),
  cropMedia:post('media/crop','生成裁切副本',byVersion.extend({ crop:z.object({ left:z.number(),top:z.number(),width:z.number(),height:z.number() }) }),jobSchema,202),
  groups:get('media/groups','列出媒体分组',z.array(record(mediaGroupSchema))),
  saveGroup:post('media/groups','保存媒体分组',save(mediaGroupSchema),record(mediaGroupSchema)),
  moveMedia:post('media/move','整批移动媒体分组',z.object({ items:z.array(m.actionVersion),groupId:z.string().nullable().optional() }),z.array(mediaRecord)),
  imagePresets:get('media/presets','列出图片规格',z.array(record(imagePresetSchema))),
  saveImagePreset:post('media/presets','保存图片规格',save(imagePresetSchema),record(imagePresetSchema)),
  variants:get('media/variants','列出已生成图片规格',z.array(m.variantRecord),byId),
  imageVariant:post('media/variant','生成或复用图片规格',imageVariant,jobSchema,202),
  comments:get('comments','查询评论',z.object({ items:z.array(m.commentSchema.extend({ title:z.string(),path:z.string() })),total:z.number(),hasMore:z.boolean() }),z.object({ status:z.enum(['all','visible','hidden','pending']).optional(),page:z.coerce.number<string|number>().int().min(1).optional(),q:z.string().max(500).optional(),author:z.string().max(40).optional(),entryId:id.optional(),path:z.string().optional(),start:z.string().optional(),end:z.string().optional() })),
  moderateComment:post('comment','审核或隐藏评论',z.object({ id,status:z.enum(['visible','hidden']) }),z.object({ id,status:z.enum(['visible','hidden']) })),
  replyComment:post('comment/reply','以站主身份回复公开评论',z.object({parentId:id,body:z.string().min(1).max(4000),clientId:z.string().min(10).max(100)}),m.commentSchema),
  moderateComments:post('comments/moderate','批量审核已选评论；状态变化时整批拒绝',z.object({items:z.array(z.object({id,expectedStatus:z.enum(['visible','hidden','pending'])})).min(1).max(200),status:z.enum(['visible','hidden'])}),z.array(z.object({id,status:z.enum(['visible','hidden'])}))),
  extensions:get('extensions','列出扩展诊断',z.array(m.extensionDiagnostic)),
  extensionUsage:get('extensions/usage','查询扩展引用',z.array(m.usage),byId),
  toggleExtension:post('extensions/toggle','切换扩展状态',z.object({ id,enabled:z.boolean(),revision:nullableRevision.optional() }),z.array(m.extensionDiagnostic)),
  maintenance:get('maintenance','读取存储使用',z.object({ databaseBytes:z.number(),analyticsBytes:z.number(),businessBytes:z.number(),uploadsBytes:z.number(),logsBytes:z.number(),importsBytes:z.number(),temporary:temporaryCleanup,pendingUploads:z.array(z.object({id,name:z.string(),size:z.number(),offset:z.number(),status:z.string()})),versions:totals,releases:totals,publicationObjects:z.array(z.object({ kind:z.string(),count:z.number(),bytes:z.number().nullable() })),media:totals,unreferenced:totals.extend({ files:z.array(z.object({ path:z.string(),bytes:z.number() })) }),backups:z.array(z.object({ path:z.string(),bytes:z.number() })),scan:z.object({checkedAt:z.string().nullable()}).optional() })),
  scanStorage:post('maintenance/scan','在后台扫描文件占用和历史媒体引用',empty,jobSchema,202),
  previewTemporaryCleanup:get('maintenance/temporary','预检已结束或过期的暂存文件',temporaryCleanup),
  cleanupTemporaryFiles:post('maintenance/temporary/cleanup','确认删除预检列出的暂存文件',z.object({review:z.string(),confirm:z.literal(true)}),z.object({files:z.number(),bytes:z.number()})),
  previewArchive:post('maintenance/preview','预检历史归档',m.retention,m.archivePreview),
  archiveHistory:post('maintenance/archive','执行已预检的历史归档',z.object({ options:m.retention,review:z.string() }),jobSchema,202),
  restoreArchive:post('maintenance/restore','恢复已归档历史',byId,jobSchema,202),
  archives:get('maintenance/archives','列出历史归档',z.array(m.archiveInfo)),
  archiveContents:get('maintenance/archive','分页读取归档目录',archiveContents,byId.extend(queryPage)),
  jobs:get('jobs','列出后台任务',z.array(jobSchema)),
  job:get('job/{id}','读取任务进度',jobSchema,empty,pathId),
  cancelJob:post('jobs/cancel','取消等待或正在执行的任务',byId,jobSchema),
  logs:get('logs','按 UTF-8 字节页读取任务日志',z.object({ text:z.string(),start:z.number(),end:z.number(),total:z.number(),truncated:z.boolean(),unit:z.literal('bytes') }),byId.extend({ offset:z.coerce.number<string|number>().int().nonnegative().optional() })),
  backup:post('backup','创建完整站点备份',z.object({ path:z.string() }),jobSchema,202),
  verify:post('verify','校验站点备份',z.object({ path:z.string() }),jobSchema,202),
  export:{...get('export','流式导出内容交换文件',m.exchange),stream:true},
  exportFile:{...get('export/file','直接下载内容交换文件',m.exchange),stream:true},
  stageImportSource:{...post('import/file','上传 Weava JSON、WordPress XML 或 Markdown，预检和导入复用来源编号',z.unknown(),z.object({id,name:z.string(),format:z.enum(['json','wxr','markdown']),bytes:z.number(),path:z.string(),sha256:z.string(),expiresAt:z.string()})),query:z.object({name:z.string().min(1).max(300)}),binary:true},
  import:post('import','后台预检或导入内容交换文件',m.importRequestSchema,jobSchema,202),
  runImportSource:post('import/source','后台预检或导入已上传来源。确认导入 Markdown 时提交预检返回的 markdownReview',z.object({sourceId:id,options:m.wxrOptions.extend({markdownReview:z.string().optional()}).optional()}),jobSchema,202),
  importRevisions:get('import/revisions','读取可合并对象的修订',z.record(z.string(),revision)),
  importWxr:post('import/wxr','后台预检或导入 WordPress，返回任务编号',z.union([z.object({xml:z.string(),options:m.wxrOptions.optional()}),z.object({sourceId:id,options:m.wxrOptions.optional()})]),jobSchema,202),
  seoAudit:post('seo/audit','创建公开或候选页面检查任务；支持分批 HTTP 续查',z.object({ target:z.enum(['draft','published']).optional(),http:z.boolean().optional(),maxPages:z.number().int().min(1).max(1000).optional(),resume:id.optional(),options:m.publishOptions.optional() }),jobSchema,202),
  seoAudits:get('seo/audits','列出 SEO 检查报告',z.array(m.seoAudit)),
  seoInsights:get('seo/insights','按窗口分析搜索数据并列出内容复核建议',m.jsonObject,z.object({start:z.string().optional(),end:z.string().optional()})),
  seoPreview:post('seo/preview','预览工作稿或网站模板的搜索与分享输出',z.object({entry:entrySchema.optional(),settings:settingsSchema.pick({domain:true,name:true,description:true,seo:true}).optional(),type:optional}),m.metadataPreview),
  internalLinkSuggestions:get('seo/internal-links','根据正文选区查找已公开内容',z.array(z.object({id,title:z.string(),path:z.string(),description:z.string(),reason:z.string()})),z.object({id,context:z.string().max(500).default('')})),
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
export const idempotentOperations:readonly ApiOperation[]=['publish','runPlan','uploadMedia','beginUpload','cropMedia','imageVariant','backup','verify','importWxr','runImportSource','archiveHistory','restoreArchive','deleteEntry','withdraw','schedule','savePlan','import','seoAudit','markdownExport','markdownPreview','markdownImport','archiveAnalytics','restoreAnalyticsArchive'];
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
