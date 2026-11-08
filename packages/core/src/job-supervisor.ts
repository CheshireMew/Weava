import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {Site} from './site.ts';

/** The execution thread cannot block its deadline/cancellation supervisor.
 * Both die together if this process exits, so recovery never leaves an orphan writer. */
export async function superviseJob(root:string,id:string){
  const site=new Site(root);let timer:ReturnType<typeof setInterval>|undefined;
  try{
    const job=site.job(id);if(!['queued','running'].includes(job.status))return;
    const deadline=job.deadlineAt??Date.now()+1800000;
    site.updateJob(id,{status:'running',workerPid:process.pid,deadlineAt:deadline,heartbeatAt:Date.now()});
    const entry=pathToFileURL(resolve(process.argv[1])).href,source=entry.endsWith('.ts');
    const loader=source?pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href:'';
    const bootstrap=`import {workerData} from 'node:worker_threads';if(workerData.loader){const {tsImport}=await import(workerData.loader);await tsImport(workerData.entry,workerData.entry);}else await import(workerData.entry);`;
    const thread=new Worker(new URL('data:text/javascript,'+encodeURIComponent(bootstrap)),{
      workerData:{entry,loader},argv:[entry,root,id],env:{...process.env,WEAVA_JOB_ID:id,WEAVA_JOB_ROOT:resolve(root)},resourceLimits:{maxOldGenerationSizeMb:768},
    });
    let errorText='',stopping=false,cancelled=false,lastBeat=Date.now();
    const tick=()=>{
      if(stopping)return;
      try{
        const current=site.job(id),clock=Date.now();
        if(current.status==='complete'){
          if(clock>=deadline){stopping=true;void thread.terminate().catch(error=>console.error(error));}
          return;
        }
        if(current.cancelRequestedAt||clock>=deadline){
          cancelled=!!current.cancelRequestedAt;errorText=cancelled?'任务已取消。':'任务超过执行期限，已停止；可检查结果后重试。';
          stopping=true;void thread.terminate().catch(error=>console.error(error));return;
        }
        if(clock-lastBeat>=1000){site.updateJob(id,{heartbeatAt:clock});lastBeat=clock;}
      }catch(error:any){if(!['SQLITE_BUSY','SQLITE_LOCKED'].includes(error.code))console.error('任务监督检查失败：',error);}
    };
    timer=setInterval(tick,100);
    thread.on('error',error=>{errorText=error.message;console.error(error.stack??error.message);});
    const code=await new Promise<number>(resolve=>thread.once('exit',resolve));
    clearInterval(timer);timer=undefined;
    const current=site.job(id);
    if(current.status!=='complete'&&(current.cancelRequestedAt||stopping||['queued','running'].includes(current.status))){
      cancelled ||= !!current.cancelRequestedAt;
      site.updateJob(id,{status:cancelled?'cancelled':'failed',message:cancelled?'任务已取消。':errorText||'任务执行进程意外退出：'+code,errorStatus:stopping&&!cancelled?408:400});
    }
  }finally{if(timer)clearInterval(timer);site.close();}
}
