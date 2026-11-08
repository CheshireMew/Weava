// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {webcrypto,createHash} from 'node:crypto';
import {uploadFile} from '../apps/admin/src/upload-file.ts';
import {api,waitJob} from '../apps/admin/src/api.ts';
vi.mock('../apps/admin/src/api.ts',()=>({api:vi.fn(),waitJob:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();});
it('does not resume different content with the same filename, size and timestamp',async()=>{
  vi.stubGlobal('crypto',webcrypto);let count=0;
  vi.mocked(api).mockImplementation(async(path:string,body?:any):Promise<any>=>{
    if(path==='media/uploads')return {id:'upload-'+(++count),name:body.name,size:body.size,sha256:body.sha256,offset:body.size,status:'receiving',expiresAt:new Date(Date.now()+60000).toISOString(),chunkBytes:1024};
    if(path==='media')return {id:body.uploadId,status:'queued'};
    throw new Error('Should not reuse another file upload');
  });
  vi.mocked(waitJob).mockRejectedValue(new Error('connection interrupted'));
  for(const text of ['AAAA','BBBB'])await expect(uploadFile(new File([text],'same.txt',{lastModified:1}),()=>{})).rejects.toThrow('connection interrupted');
  const begins=vi.mocked(api).mock.calls.filter(call=>call[0]==='media/uploads');expect(begins).toHaveLength(2);
  expect(begins.map(call=>(call[1] as any).sha256)).toEqual(['AAAA','BBBB'].map(text=>createHash('sha256').update(text).digest('hex')));
  expect(sessionStorage.length).toBe(2);
});
