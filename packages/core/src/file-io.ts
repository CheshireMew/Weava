import { openSync, closeSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
/** File size does not determine the memory used to verify it. */
export function digestFile(file:string){
  const fd=openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024),hash=createHash('sha256');
  try{for(;;){const size=readSync(fd,buffer,0,buffer.length,null);if(!size)break;hash.update(buffer.subarray(0,size));}return hash.digest('hex');}
  finally{closeSync(fd);}
}
/** Keep at most one JSONL record, including split UTF-8 characters, in memory. */
export function* jsonLines(file:string):Generator<any>{
  const fd=openSync(file,'r'),buffer=Buffer.allocUnsafe(65536),decoder=new StringDecoder('utf8');let parts:string[]=[];
  try{
    for(;;){
      const size=readSync(fd,buffer,0,buffer.length,null);if(!size)break;
      const text=decoder.write(buffer.subarray(0,size));let start=0,end:number;
      while((end=text.indexOf('\n',start))>=0){
        const line=parts.length?[...parts,text.slice(start,end)].join(''):text.slice(start,end);parts=[];
        if(line.trim())yield JSON.parse(line);start=end+1;
      }
      if(start<text.length)parts.push(text.slice(start));
    }
    parts.push(decoder.end());const line=parts.join('');if(line.trim())yield JSON.parse(line);
  }finally{closeSync(fd);}
}
