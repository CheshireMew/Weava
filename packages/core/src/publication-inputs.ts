import type Database from 'better-sqlite3';
export interface PublicationInput {scope:string;ids?:string[];rows:{id:string;revision:number}[]}
export function publicationInput(db:Database.Database,scope:string,ids?:string[]):PublicationInput {
  const rows=ids?.length===0?[]:db.prepare(`SELECT id,revision FROM records WHERE scope=?${ids?' AND id IN ('+ids.map(()=>'?').join(',')+')':''} ORDER BY id`).all(scope,...(ids??[])) as {id:string;revision:number}[];
  return {scope,ids,rows};
}
export function publicationInputsCurrent(db:Database.Database,inputs:PublicationInput[]){
  return inputs.every(input=>JSON.stringify(publicationInput(db,input.scope,input.ids).rows)===JSON.stringify(input.rows));
}
