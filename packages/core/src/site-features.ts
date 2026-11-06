import { existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allFeatures,siteDescriptorSchema,type FeatureId } from '../../contracts/src/installation.ts';
export function siteFeatures(root:string):FeatureId[]{
  const file=join(root,'site.json');
  if(!existsSync(file))return [...allFeatures];
  const config=JSON.parse(readFileSync(file,'utf8'));
  return config.version===2?siteDescriptorSchema.parse(config).features:[...allFeatures];
}
export function requiredFeature(path:string):FeatureId|undefined{
  if(path.startsWith('/media/')||/^\/api\/admin\/v1\/media(?:\/|$)/.test(path))return 'media';
  if(/^\/api\/(?:admin\/v1\/analytics|v1\/analytics)(?:\/|$)/.test(path))return 'analytics';
  if(/^\/api\/(?:admin\/v1\/comments?|v1\/(?:engagement|like|comment|comment-like|comment-captcha))(?:\/|$)/.test(path))return 'engagement';
  if(/^\/api\/admin\/v1\/(?:entries|entry|references|authoring|types|terms|layouts|history|revision|restore|publication|publish|withdraw|rollback|schedule|schedules|bulk|plans|redirects|import|export|seo|search-data)(?:\/|$)/.test(path)||
     /^\/api\/admin\/v1\/maintenance\/(?:preview|archive|archives|restore)(?:\/|$)/.test(path)||
     /^\/api\/v1\/(?:content|search)(?:\/|$)/.test(path)||['/rss.xml','/search/','/sitemap.xml'].includes(path)||path.startsWith('/__preview/'))return 'content';
}
export function operationFeature(operation:string):FeatureId|undefined{
 if(operation.startsWith('analytics-'))return 'analytics';
 if(['media','media-edit','media-variant','media-references','legacy-media-stage'].includes(operation))return 'media';
 if(['publish','archive-history','restore-history','import-wxr','preflight-wxr','publication-review','publication-plan-review','schedule-create','plan-save','withdraw','entry-delete','archive-plan','archive-contents'].includes(operation))return 'content';
}

