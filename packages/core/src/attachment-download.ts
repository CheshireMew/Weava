import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { WeavaError } from '@weava/contracts';

export function publicAddress(address:string) {
  if(isIP(address)===4){
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  if(isIP(address)!==6)return false;
  const normalized=address.toLowerCase(),first=parseInt(normalized.split(':')[0],16);
  const second=parseInt(normalized.split(':')[1]||'0',16);
  return first>=0x2000&&first<=0x3fff && !(first===0x2001&&(second===0||second===0xdb8)) && first!==0x2002;
}
export async function publicAttachmentTarget(input:string,resolver=lookup) {
  const url=new URL(input);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new WeavaError('附件只允许无账户信息的 HTTP(S) 网址。');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(hostname.toLowerCase()==='localhost'||hostname.toLowerCase().endsWith('.localhost'))throw new WeavaError('附件地址不能指向本机或内网。');
  const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolver(hostname,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new WeavaError('附件地址不能指向本机、内网或保留地址。');
  return {url,addresses};
}
/** Every redirect is resolved and checked again; lookup is pinned to that verified answer. */
export async function downloadPublicAttachment(input:string) {
  const signal=AbortSignal.timeout(30000);
  let target=input;
  for(let redirect=0;redirect<=5;redirect++){
    const {url,addresses}=await Promise.race([publicAttachmentTarget(target),new Promise<never>((_,reject)=>{
      if(signal.aborted)reject(new WeavaError('附件下载超时。'));
      else signal.addEventListener('abort',()=>reject(new WeavaError('附件下载超时。')),{once:true});
    })]);
    const result=await new Promise<{location?:string;bytes?:Buffer}>((resolve,reject)=>{
      const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{
        signal,headers:{'Accept-Encoding':'identity','User-Agent':'Weava/1.0'},
        lookup:((_host:string,options:any,callback:any)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family)) as any,
      },response=>{
        if([301,302,303,307,308].includes(response.statusCode??0)&&response.headers.location){response.destroy();try{resolve({location:new URL(response.headers.location,url).href});}catch{reject(new WeavaError('附件重定向网址无效。'));}return;}
        if((response.statusCode??0)<200||(response.statusCode??0)>=300){response.destroy();reject(new WeavaError('附件下载失败。'));return;}
        const chunks:Buffer[]=[];let size=0;
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32*1024*1024){response.destroy(new WeavaError('附件超过 32 MB。'));return;}chunks.push(chunk);});
        response.on('end',()=>resolve({bytes:Buffer.concat(chunks)}));response.on('error',reject);
      });request.on('error',reject);request.end();
    });
    if(result.bytes)return result.bytes;
    target=result.location!;
  }
  throw new WeavaError('附件重定向次数过多。');
}
