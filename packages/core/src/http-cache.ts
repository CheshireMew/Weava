export function fileEtag(size:number,mtimeMs:number){return '"'+size.toString(16)+'-'+mtimeMs.toString(16)+'"';}
export function etagMatches(value:string,etag:string){return value.split(',').some(tag=>tag.trim()==='*'||tag.trim().replace(/^W\//,'')===etag.replace(/^W\//,''));}
export function notModified(request:Request,etag:string,mtimeMs:number){
  const match=request.headers.get('if-none-match');
  if(match!==null)return etagMatches(match,etag);
  const since=request.headers.get('if-modified-since');
  return !!since&&Number.isFinite(Date.parse(since))&&Math.floor(mtimeMs/1000)<=Math.floor(Date.parse(since)/1000);
}
export function acceptsGzip(request:Request){
  const values=(request.headers.get('accept-encoding')??'').split(',').map(item=>{const[name,...parts]=item.trim().split(';');const quality=parts.find(part=>/^\s*q=/.test(part));return{name:name.toLowerCase(),q:quality?Number(quality.split('=')[1]):1};});
  const gzip=values.find(value=>value.name==='gzip')??values.find(value=>value.name==='*');return !!gzip&&gzip.q>0;
}
