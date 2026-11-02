import { WeavaError } from '@weava/contracts';
export function validateMediaFormat(data:Buffer,ext:string) {
  const starts=(hex:string)=>data.subarray(0,hex.length/2).toString('hex')===hex;
  const ascii=(start:number,end:number)=>data.subarray(start,end).toString('ascii');
  const valid=ext==='.png'?starts('89504e470d0a1a0a'):
    ['.jpg','.jpeg'].includes(ext)?starts('ffd8ff'):
    ext==='.gif'?['GIF87a','GIF89a'].includes(ascii(0,6)):
    ext==='.webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':
    ext==='.avif'?ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,32)):
    ext==='.pdf'?ascii(0,5)==='%PDF-':
    ext==='.mp4'?ascii(4,8)==='ftyp':
    ext==='.webm'?starts('1a45dfa3'):
    ext==='.mp3'?ascii(0,3)==='ID3'||data[0]===255&&(data[1]&224)===224:
    ['.txt','.csv','.srt','.vtt'].includes(ext)?!data.includes(0):false;
  if(!valid)throw new WeavaError('附件内容与文件格式不符。');
}
