import {Site} from './site.ts';
import {Analytics} from './analytics.ts';
import {withInstanceMaintenance,maintenanceEnvironment} from './instance-access.ts';
import {seedStarter,type Starter} from './starters.ts';
import {siteFeatures} from './site-features.ts';
import {BusinessStore} from './site-sdk.ts';
const [operation,root,theme,domain]=process.argv.slice(2);
try{
 await withInstanceMaintenance(root,async()=>{
  if(operation==='lease'){
   process.send?.({type:'lease',environment:maintenanceEnvironment(root)});
   await new Promise<void>(resolve=>{process.once('message',()=>resolve());process.once('disconnect',()=>resolve());});
   if(process.connected)process.disconnect();
   return;
  }
  const site=new Site(root,{mode:'migrate'});
  try{
   if(operation==='init'){
    const {readFileSync}=await import('node:fs'),{join}=await import('node:path');
    const config=JSON.parse(readFileSync(join(root,'site.json'),'utf8'));
    if(domain){const row=site.settings();site.saveSettings({...row.value,domain},row.revision);}
    seedStarter(site,config.template as Starter,theme);
   }
   if(siteFeatures(root).includes('analytics')){const a=new Analytics(root,{mode:'migrate'});a.close();}
   const business=new BusinessStore(root,'migrate');business.close();
   console.log(JSON.stringify({ok:true,operation,root}));
  }finally{site.close();}
 });
}catch(error:any){console.error(error.stack??error.message);process.exitCode=1;}

