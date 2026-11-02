import { open } from 'node:fs/promises';
import { WeavaError } from '@weava/contracts';
export const LOG_PAGE_BYTES = 20000;
/** Fixed byte pages extend to UTF-8 boundaries. At most one page plus four bytes is read. */
export async function readJobLog(file: string, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new WeavaError('日志位置无效。');
  const handle = await open(file,'r').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!handle) return {text:'',start:0,end:0,total:0,truncated:false,unit:'bytes' as const};
  try {
    const {size:total} = await handle.stat();
    const page = Math.min(Math.floor(offset/LOG_PAGE_BYTES),Math.max(0,Math.ceil(total/LOG_PAGE_BYTES)-1));
    const nominal = page*LOG_PAGE_BYTES, limit = Math.min(total,nominal+LOG_PAGE_BYTES);
    const buffer = Buffer.alloc(Math.min(total-nominal,LOG_PAGE_BYTES+4));
    const {bytesRead} = await handle.read(buffer,0,buffer.length,nominal);
    const continuation = (at:number) => at<bytesRead && (buffer[at]&0xc0)===0x80;
    let from=0,to=limit-nominal;
    while(continuation(from))from++;
    while(continuation(to))to++;
    const start=nominal+from,end=nominal+to;
    return {text:buffer.subarray(from,to).toString('utf8'),start,end,total,truncated:end<total,unit:'bytes' as const};
  } finally { await handle.close(); }
}
