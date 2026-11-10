// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {usePublication} from '../apps/admin/src/usePublication.ts';
import {api,submitJob,waitJob} from '../apps/admin/src/api.ts';
import {refreshBackgroundTasks} from '../apps/admin/src/background-tasks.ts';
vi.mock('../apps/admin/src/api.ts',async()=>({...await vi.importActual('../apps/admin/src/api.ts'),api:vi.fn(),submitJob:vi.fn(),waitJob:vi.fn()}));
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,model:ReturnType<typeof usePublication>;
const refresh=vi.fn(),error=vi.fn(),notify=vi.fn();
function View(){model=usePublication(refresh,error,notify);return null;}
beforeEach(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;window.dispatchEvent(new Event('weava-session-ended'));sessionStorage.clear();vi.clearAllMocks();refresh.mockResolvedValue(undefined);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<View/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();window.dispatchEvent(new Event('weava-session-ended'));});
it('opens a multi-entry review without refreshing content or issuing a publication',async()=>{
 const review={options:{candidateId:'reviewed'}};vi.mocked(api).mockResolvedValue(review as any);
 await act(async()=>model.task('publish',{ids:['one','two']}));
 expect(model.publication).toBe(review);expect(api).toHaveBeenCalledTimes(1);expect(waitJob).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('reviews one article before publishing its frozen revision only after confirmation',async()=>{
 const review={options:{candidateId:'reviewed-one',ids:['one'],revisions:{one:17}}};
 vi.mocked(api).mockResolvedValue(review as any);
 vi.mocked(submitJob).mockResolvedValue({id:'direct',status:'complete',operation:'publish'});
 await act(async()=>model.task('publish',{ids:['one'],revisions:{one:17}}));
 expect(model.publication).toBe(review);expect(api).toHaveBeenCalledWith('publication',{ids:['one'],revisions:{one:17}});
 expect(submitJob).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
 await act(async()=>model.task('publish',review.options,true));
 expect(vi.mocked(submitJob).mock.calls[0].slice(0,2)).toEqual(['publish',review.options]);expect(notify).toHaveBeenCalledWith('已发布');
});
it('rejects duplicate submissions and releases controls as soon as the job is accepted',async()=>{
 let finish!:(value:any)=>void;vi.mocked(submitJob).mockReturnValue(new Promise(resolve=>finish=resolve));
 refresh.mockReturnValue(new Promise(()=>{}));let task!:Promise<any>;
 await act(async()=>{task=model.task('publish',{ids:['one'],candidateId:'reviewed'},true);await model.task('publish',{ids:['one'],candidateId:'reviewed'},true);});
 expect(submitJob).toHaveBeenCalledTimes(1);expect(model.busy).toBe(true);
 await act(async()=>finish({id:'job',status:'queued',operation:'publish'}));expect(model.busy).toBe(false);expect(model.isPublishing('one')).toBe(true);expect(model.isPublishing('two')).toBe(false);
 vi.mocked(api).mockResolvedValue({id:'job',status:'complete',operation:'publish'} as any);
 await act(async()=>{await refreshBackgroundTasks();expect((await task).status).toBe('complete');});
 expect(model.job).toBeNull();expect(model.publicationPhase('one')).toBeNull();expect(notify).toHaveBeenCalledWith('已发布');expect(refresh).toHaveBeenCalledTimes(1);
});
it('keeps backup progress independent from writing and survives a transient progress error',async()=>{
 vi.mocked(submitJob).mockResolvedValue({id:'backup-job',status:'queued',operation:'backup'});
 let task!:Promise<any>;await act(async()=>{task=model.task('backup');await Promise.resolve();});
 expect(model.busy).toBe(false);expect(model.isPublishing('one')).toBe(false);expect(model.pending('backup')).toBe(true);
 vi.mocked(api).mockRejectedValueOnce(new Error('断线'));await act(async()=>refreshBackgroundTasks());expect(model.pending('backup')).toBe(true);expect(notify).not.toHaveBeenCalled();
 refresh.mockRejectedValue(new Error('离线'));vi.mocked(api).mockResolvedValue({id:'backup-job',status:'complete',operation:'backup'} as any);
 await act(async()=>{await refreshBackgroundTasks();await task;});expect(notify).toHaveBeenCalledWith('备份已创建');expect(error).toHaveBeenCalledWith('操作已完成，刷新页面数据失败：离线');
});
