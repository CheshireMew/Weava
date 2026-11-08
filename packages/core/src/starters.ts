import { entrySchema,type ContentType } from '@weava/contracts';
import { allFeatures,type FeatureId } from '../../contracts/src/installation.ts';
import type { Site } from './site.ts';
import { seedDemo } from './demo.ts';
import {existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
export const starters = ['blog','company','portfolio','documentation','resource','blank','demo'] as const;
export type Starter = typeof starters[number];
export function starterFeatures(template:Starter):FeatureId[]{
  return template==='blank'?[]:template==='blog'||template==='demo'?[...allFeatures]:['content','media','analytics'];
}
export function seedStarter(site:Site,template:Starter,theme='weava'){
  if(site.store.list('entry').length)throw new Error('模板只可应用于空网站，不覆盖已有内容。');
  if(template==='demo'){const media=join(site.root,'media/demo-landscape.svg');mkdirSync(join(site.root,'media'),{recursive:true});if(!existsSync(media))writeFileSync(media,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#315c4c"/></svg>');seedDemo(site);return;}
  const type:ContentType=template==='portfolio'?{id:'project',label:'作品',pathPrefix:'/work/',template:'portfolio',fields:[{key:'year',label:'年份',type:'number'},{key:'client',label:'客户',type:'text'}]}:
    template==='documentation'?{id:'doc',label:'文档',pathPrefix:'/docs/',template:'documentation',fields:[]}:
    template==='resource'?{id:'resource',label:'资源',pathPrefix:'/resources/',template:'resource',fields:[{key:'url',label:'网址',type:'text'},{key:'platform',label:'平台',type:'select',options:['Windows','Linux','Web'],filterable:true}]}:
    {id:'post',label:template==='company'?'服务':'文章',pathPrefix:template==='company'?'/services/':'/posts/',template:'article',fields:[]};
  if(template!=='blank')site.saveType(type,null);
  if(template==='blog')site.saveType({id:'note',label:'笔记',format:'note',pathPrefix:'/notes/',template:'note',fields:[]},null);
  const settings=site.settings();
  site.saveSettings({...settings.value,theme,description:'请填写你的网站介绍。',...(template==='blog'?{extensions:{...settings.value.extensions,notes:{path:'/notes/'}}}:{}),navigation:template==='blank'?[]:[{label:'首页',url:'/'},{label:type.label,url:type.pathPrefix},...(template==='blog'?[{label:'随笔',url:'/notes/'}]:[])]},settings.revision);
  if(template==='blank')return;
  const item=entrySchema.parse({id:'welcome',kind:'content',type:type.id,title:template==='company'?'服务介绍示例':'开始使用',path:type.pathPrefix+'welcome/',status:'published',fields:template==='portfolio'?{year:2026}:template==='resource'?{url:'https://example.com',platform:'Web'}:{},document:{version:1,format:'markdown',source:'## 欢迎\n\n这是一份可替换的示例内容，请在后台填写自己的内容。'}});
  site.saveEntry(item,null);
  const blocks=[{id:'intro',type:'hero',props:{title:template==='company'?'介绍你的公司':template==='portfolio'?'作品与项目':template==='documentation'?'使用文档':template==='resource'?'资源目录':'记录与分享',description:'请替换为自己的网站介绍。'}},{id:'list',type:theme==='library'?'collection':'content-list',props:{contentType:type.id,limit:12,...(theme==='library'?{presentation:'cards',pagination:false}:{}),...(template==='resource'?{filters:'show'}:{})}}];
  site.saveEntry(entrySchema.parse({id:'home',kind:'page',title:'首页',path:'/',status:'published',...(theme==='newsletter'?{template:'newsletter-home'}:{}),blocks}),null);
  site.saveEntry(entrySchema.parse({id:'index',kind:'page',title:type.label,path:type.pathPrefix,status:'published',blocks:[theme==='library'?{...blocks[1],props:{...blocks[1].props,presentation:'catalog',pagination:true,basePath:type.pathPrefix,filters:'show'}}:blocks[1]]}),null);
  if(template==='blog')site.saveEntry(entrySchema.parse({id:'notes',kind:'page',title:'随笔',path:'/notes/',template:'notes-feed',status:'published'}),null);
  if(template==='company')site.saveEntry(entrySchema.parse({id:'company-about',kind:'page',title:'关于我们',path:'/about/',status:'published',document:{version:1,format:'markdown',source:'请填写公司介绍及联系方式。'}}),null);
  if(theme==='newsletter')site.saveEntry(entrySchema.parse({id:'archive',kind:'page',title:'文章归档',path:'/archive/',template:'newsletter-archive',status:'published'}),null);
  site.publish({label:'网站模板初始化'});
}

