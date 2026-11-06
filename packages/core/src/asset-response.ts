import { readFile, stat } from 'node:fs/promises';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { BoundedCache } from './cache.ts';
import { acceptsGzip, fileEtag, notModified } from './http-cache.ts';
const compress=promisify(gzip);
const cache=new BoundedCache<string,{stamp:string;bytes:Buffer;gzip?:Promise<Buffer>}>(128,16*1024*1024);
/** Only for public, versioned program files. Admin HTML remains outside this cache. */
export async function assetResponse(file:string,request:Request,type:string,immutable=true){
  const info=await stat(file).catch(error=>{if(error.code==='ENOENT'||error.code==='ENOTDIR')return null;throw error;});
  if(!info?.isFile())return new Response('Not found',{status:404});
  const stamp=info.size+':'+info.mtimeMs;
  const zipped=info.size>=1024&&acceptsGzip(request)&&/(^text\/|javascript|json|svg)/.test(type);
  const etag=fileEtag(info.size,info.mtimeMs).replace(/"$/,(zipped?'-gzip':'')+'"');
  const headers=new Headers({'Content-Type':type,'Cache-Control':immutable?'public, max-age=31536000, immutable':'public, no-cache','ETag':etag,'Last-Modified':info.mtime.toUTCString(),'Vary':'Accept-Encoding'});
  if(notModified(request,etag,info.mtimeMs))return new Response(null,{status:304,headers});
  let item=cache.get(file);
  if(!item||item.stamp!==stamp){item={stamp,bytes:await readFile(file)};cache.set(file,item,item.bytes.length*2+256);}
  const bytes=zipped?await(item.gzip??=(compress(item.bytes))):item.bytes;
  if(zipped)headers.set('Content-Encoding','gzip');headers.set('Content-Length',String(bytes.length));
  return new Response(request.method==='HEAD'?null:new Uint8Array(bytes.buffer as ArrayBuffer,bytes.byteOffset,bytes.byteLength),{headers});
}
