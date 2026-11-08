// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {usePublication} from '../apps/admin/src/usePublication.ts';
import {api,waitJob} from '../apps/admin/src/api.ts';
vi.mock('../apps/admin/src/api.ts',()=>({api:vi.fn(),waitJob:vi.fn()}));
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,model:ReturnType<typeof usePublication>;
const refresh=vi.fn(),error=vi.fn(),notify=vi.fn();
function View(){model=usePublication(refresh,error,notify);return null;}
beforeEach(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();refresh.mockResolvedValue(undefined);
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<View/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('opens a review without refreshing content or issuing a publication',async()=>{
 const review={options:{candidateId:'reviewed'}};vi.mocked(api).mockResolvedValue(review as any);
 await act(async()=>model.task('publish',{ids:['one']}));
 expect(model.publication).toBe(review);expect(api).toHaveBeenCalledTimes(1);expect(waitJob).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('rejects duplicate clicks and completes immediately after commit while data refresh continues',async()=>{
 let finish!:(value:any)=>void;vi.mocked(api).mockReturnValue(new Promise(resolve=>finish=resolve) as any);
 const complete={id:'job',status:'complete',operation:'publish'};vi.mocked(waitJob).mockResolvedValue(complete);
 refresh.mockReturnValue(new Promise(()=>{}));let task!:Promise<any>;
 await act(async()=>{task=model.task('publish',{candidateId:'reviewed'},true);await model.task('publish',{candidateId:'reviewed'},true);});
 expect(api).toHaveBeenCalledTimes(1);expect(model.busy).toBe(true);
 await act(async()=>{finish(complete);expect(await task).toBe(complete);});
 expect(model.busy).toBe(false);expect(model.job).toBeNull();expect(notify).toHaveBeenCalledWith('已发布');expect(refresh).toHaveBeenCalledTimes(1);
});
it('keeps failures retryable and distinguishes a committed operation from a display refresh failure',async()=>{
 vi.mocked(api).mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue({id:'job'} as any);
 await act(async()=>model.task('backup'));expect(error).toHaveBeenCalledWith('连接失败');expect(model.busy).toBe(false);expect(notify).not.toHaveBeenCalled();
 vi.mocked(waitJob).mockResolvedValue({status:'complete'});refresh.mockRejectedValue(new Error('离线'));
 await act(async()=>model.task('backup'));expect(notify).toHaveBeenCalledWith('备份已创建');expect(error).toHaveBeenCalledWith('操作已完成，刷新页面数据失败：离线');
});
