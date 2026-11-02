import {expect,it,vi,beforeEach} from 'vitest';
import {EventEmitter} from 'node:events';
const wire=vi.hoisted(()=>({request:vi.fn(),lookup:vi.fn()}));
vi.mock('node:http',()=>({request:wire.request}));
vi.mock('node:https',()=>({request:wire.request}));
vi.mock('node:dns/promises',()=>({lookup:wire.lookup}));
import {downloadPublicAttachment} from '../packages/core/src/attachment-download.ts';
beforeEach(()=>{wire.request.mockReset();wire.lookup.mockReset();});
function responses(values:{status?:number;location?:string;size?:number;bytes?:Buffer}[]){
  let index=0;
  wire.request.mockImplementation((url,options,receive)=>{
    const request=new EventEmitter() as any;
    request.end=()=>{
      const value=values[index++];if(!value)throw new Error('Unexpected request');
      const response=new EventEmitter() as any;let destroyed=false;
      response.statusCode=value.status??200;response.headers={location:value.location};
      response.destroy=(error?:Error)=>{destroyed=true;if(error)queueMicrotask(()=>response.emit('error',error));};
      receive(response);
      queueMicrotask(()=>{if(destroyed)return;response.emit('data',value.size?{length:value.size}:value.bytes??Buffer.from('download'));if(!destroyed)response.emit('end');});
    };return request;
  });
}
it('checks a redirect destination before issuing another request and pins approved DNS answers',async()=>{
  wire.lookup.mockImplementation(async(host)=>[{address:host==='evil.example'?'127.0.0.1':'8.8.8.8',family:4}]);
  responses([{status:302,location:'http://evil.example/private'}]);
  await expect(downloadPublicAttachment('https://public.example/file')).rejects.toThrow('内网');
  expect(wire.request).toHaveBeenCalledTimes(1);
  const options=wire.request.mock.calls[0][1];
  options.lookup('public.example',{all:true},(error:any,addresses:any)=>{expect(error).toBeNull();expect(addresses).toEqual([{address:'8.8.8.8',family:4}]);});
});
it('follows public redirects but limits payloads and redirect count',async()=>{
  wire.lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);
  responses([{status:302,location:'https://second.example/file'},{bytes:Buffer.from('verified')}]);
  expect((await downloadPublicAttachment('https://first.example/file')).toString()).toBe('verified');expect(wire.lookup).toHaveBeenCalledTimes(2);
  responses([{size:32*1024*1024+1}]);await expect(downloadPublicAttachment('https://first.example/large')).rejects.toThrow('32 MB');
  responses(Array.from({length:6},()=>({status:302,location:'https://loop.example/again'})));
  await expect(downloadPublicAttachment('https://loop.example/again')).rejects.toThrow('重定向次数');
});
it('rejects malformed redirect URLs and non-HTTP schemes without crashing the server',async()=>{
  wire.lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);responses([{status:302,location:'http://['}]);
  await expect(downloadPublicAttachment('https://first.example/')).rejects.toThrow('重定向网址');
  responses([{status:302,location:'file:///private'}]);await expect(downloadPublicAttachment('https://first.example/')).rejects.toThrow('HTTP');
});
