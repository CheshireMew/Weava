import type {Site} from './site.ts';
import type {ExtensionManager} from './extension-manager.ts';
import {schedulePublication} from './schedules.ts';
import {savePublicationPlan} from './publication-plans.ts';
import {deleteContent} from './entry-actions.ts';
import {readPublicationCandidate} from './publication.ts';
import {WeavaError} from '@weava/contracts';
export async function executeContentMutation(site:Site,manager:ExtensionManager,operation:string,payload:any,jobId:string){
  const commit=(action:()=>unknown)=>site.store.raw.transaction(()=>{site.store.assertTask();const result=action();site.updateJob(jobId,{status:'complete',message:'已完成。',result});return result;}).immediate();
  if(operation==='schedule-create')return commit(()=>schedulePublication(site,payload.id,payload.revision,payload.dueAt));
  if(operation==='plan-save')return commit(()=>savePublicationPlan(site,payload.value,payload.revision??null));
  if(operation==='withdraw'||operation==='entry-delete'){
    const options=site.withdrawalOptions(payload.id,payload.revision);
    if(options)await manager.validateRelease(readPublicationCandidate(site,options).release);
    site.store.assertTask();
    return commit(()=>operation==='entry-delete'?deleteContent(site,payload.id,payload.revision,options):site.withdraw(payload.id,payload.revision,!!payload.archive,options));
  }
  throw new WeavaError('未知内容操作：'+operation);
}
