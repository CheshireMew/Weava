import { WeavaError } from '@weava/contracts';
export async function readJsonBody(request: Request, maximum: number) {
  const length = Number(request.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maximum)throw new WeavaError('请求内容超过此操作的大小限制。',413);
  if(!request.body)throw new WeavaError('请求内容为空。');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new WeavaError('请求内容超过此操作的大小限制。',413);}chunks.push(value);}
  } finally {reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new WeavaError('请求需要有效的 JSON 内容。');}
}
