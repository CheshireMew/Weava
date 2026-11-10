import {defaultMediaUploadLimits,mediaUploadLimit,WeavaError,type MediaUploadLimits} from '@weava/contracts';
import {mediaUploadLimits} from '../../contracts/src/api-models.ts';
import type {Site} from './site.ts';
import {statfsSync} from 'node:fs';
export function uploadLimits(site:Pick<Site,'settings'>):MediaUploadLimits{return mediaUploadLimits.parse({...defaultMediaUploadLimits,...site.settings().value.mediaUploadLimits});}
export function assertUploadSize(site:Pick<Site,'settings'>,name:string,size:number){const maximum=mediaUploadLimit(name,uploadLimits(site));if(!Number.isSafeInteger(size)||size<1||size>maximum)throw new WeavaError('附件大小需要在 '+(maximum/1048576).toLocaleString('zh-CN')+' MB 以内。',413);return maximum;}
export function assertUploadSpace(root:string,bytes:number){const disk=statfsSync(root);if(disk.bavail*disk.bsize<bytes+64*1024*1024)throw new WeavaError('磁盘空间不足以保存这个文件，请先整理空间。',507);}
