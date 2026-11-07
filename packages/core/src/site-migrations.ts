import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BusinessStore} from './site-sdk.ts';
export async function migrateWebsite(root:string,buildId?:string,mode:'open'|'migrate'='migrate'){
 if(!buildId)return;
 if(!/^[\w-]+$/.test(buildId))throw new Error('网站构建编号无效。');
 const builds=process.env.WEAVA_SITE_BUILDS_ROOT??join(root,'site-builds'),folder=join(builds,buildId);
 const manifest=JSON.parse(readFileSync(join(folder,'site-build.json'),'utf8'));
 if(!manifest.migrations)return;
 const module=await import(/* @vite-ignore */ pathToFileURL(join(folder,manifest.migrations)).href);
 if(!Array.isArray(module.default))throw new Error('网站迁移必须默认导出迁移数组。');
 const business=new BusinessStore(root,mode);
 try{
  const groups=new Map<string,any[]>();
  for(const migration of module.default){
   if(typeof migration.id!=='string'||!migration.id||!Number.isSafeInteger(migration.version)||migration.version<1||typeof migration.up!=='function'||migration.up.constructor.name==='AsyncFunction')throw new Error('网站业务迁移声明无效。');
   const items=groups.get(migration.id)??[];if(items.some(item=>item.version===migration.version))throw new Error('网站业务迁移版本重复。');items.push(migration);groups.set(migration.id,items);
  }
  for(const [id,items]of groups){
   items.sort((a,b)=>a.version-b.version);const target=items.at(-1).version,current=business.version(id);
   if(current>target)throw new Error('网站业务数据版本比代码新。');
   if(mode==='open'){if(current!==target)throw new Error('网站业务数据需要显式迁移，请执行 site update。');continue;}
   for(const migration of items)if(migration.version>current)business.migrate(id,migration.version,()=>{
     const result=migration.up({business});
     if(result&&typeof result.then==='function')throw new Error('业务迁移必须同步执行，只操作事务内的业务数据。');
   });
  }
 }finally{business.close();}
}

