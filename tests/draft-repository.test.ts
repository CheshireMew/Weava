import { expect,it } from 'vitest';
import { entrySchema } from '@weava/contracts';
import { DraftRepository,type DraftDatabase,type DraftRow,type DraftMeta,type DraftChange } from '../apps/admin/src/draft-repository.ts';
class Database implements DraftDatabase{
  rows=new Map<string,DraftRow>();fail=false;writes:string[]=[];
  async read(id:string){return structuredClone(this.rows.get(id));}
  async readAll(){return structuredClone([...this.rows.values()]);}
  async transact(id:string,change:(row:DraftRow|undefined,metadata:DraftMeta[])=>DraftChange){
    const row=structuredClone(this.rows.get(id)),meta=[...this.rows.values()].map(({copies,...item})=>item),result=change(row,meta);
    if(this.fail)throw new Error('quota');
    for(const key of result.remove??[])this.rows.delete(key);
    if(result.row){this.rows.set(id,structuredClone(result.row));this.writes.push(id);}
    return structuredClone(result.row?.copies??((result.remove??[]).includes(id)?[]:row?.copies??[]));
  }
}
const record=(id:string,title:string)=>({id,revision:1,updatedAt:'',value:entrySchema.parse({id,title,kind:'page',path:'/'+id+'/'})});
it('enumerates forty unchanged drafts with one readonly batch and no writes',async()=>{
  const db=new Database(),repository=new DraftRepository(db);
  for(let index=0;index<40;index++)await repository.save(record('draft-'+index,'正文'),index+1);
  const written=db.writes.length;let reads=0;
  const all=db.readAll.bind(db);db.readAll=async()=>{reads++;return all();};
  expect(await repository.list()).toHaveLength(40);expect(reads).toBe(1);expect(db.writes).toHaveLength(written);
  await repository.read('draft-0');expect(db.writes).toHaveLength(written);
});
it('keeps independent window copies, enumerates local-only records and acknowledges only the matching session',async()=>{
  const db=new Database(),one=new DraftRepository(db,undefined,'window-one'),two=new DraftRepository(db,undefined,'window-two');
  const draft={...record('note','first window'),revision:0};
  await one.save(draft,100);await two.save({...draft,value:{...draft.value,title:'second window'}},200);
  expect((await one.list()).map(copy=>copy.record.value.title)).toEqual(['second window','first window']);
  await two.acknowledge({...draft,value:{...draft.value,title:'second window'}});
  expect((await one.read('note')).map(copy=>copy.record.value.title)).toEqual(['first window']);
  await two.forget('note');expect(await one.read('note')).toHaveLength(1);
  const selected=(await one.read('note'))[0];await one.save({...draft,value:{...draft.value,title:'newer first window'}},300);
  await two.discard(selected);expect((await two.read('note'))[0].record.value.title).toBe('newer first window');
});
it('overwrites one pending draft per article and clears it after saving without touching other articles',async()=>{
  const db=new Database(),repository=new DraftRepository(db);
  await repository.save(record('one','first'),1000);await repository.save(record('two','other'),1000);
  await repository.save(record('one','typing'),2000);await repository.save(record('one','second'),17000);
  expect((await repository.read('one')).map(copy=>copy.record.value.title)).toEqual(['second']);
  expect(db.writes.filter(id=>id==='two')).toHaveLength(1);
  await repository.acknowledge(record('one','typing'));expect((await repository.read('one'))[0].record.value.title).toBe('second');
  await repository.acknowledge({...record('one','second'),revision:2});expect(await repository.read('one')).toEqual([]);
  await repository.forget('one');expect(await repository.read('one')).toEqual([]);expect((await repository.read('two'))[0].record.value.title).toBe('other');
});
it('migrates only the newest pending draft and respects a newer close-time write with the same draft id',async()=>{
  const values=new Map<string,string>(),legacy={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const db=new Database(),repository=new DraftRepository(db,legacy,'legacy');
  await repository.save(record('one','older'),1000);
  legacy.setItem('weava-drafts:v2',JSON.stringify({version:2,entries:{one:[{id:'one',updatedAt:2000,capturedAt:2000,pending:true,record:record('one','latest at close')}]}}));
  expect((await repository.read('one')).map(copy=>copy.record.value.title)).toEqual(['latest at close']);
  expect(JSON.parse(legacy.getItem('weava-drafts:v2')!).entries.one).toBeUndefined();
  await repository.save(record('one','new typing'),3000);
  await repository.acknowledge(record('one','latest at close'));
  expect((await repository.read('one'))[0].record.value.title).toBe('new typing');
});
it('migrates recovery only after commit, keeps failed copies, and bounds article count and individual size',async()=>{
  const values=new Map<string,string>(),legacy={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  legacy.setItem('weava-draft:one',JSON.stringify(record('one','legacy')));
  const db=new Database(),repository=new DraftRepository(db,legacy);db.fail=true;
  await expect(repository.read('one')).rejects.toThrow('quota');expect(legacy.getItem('weava-draft:one')).not.toBeNull();
  db.fail=false;expect((await repository.read('one'))[0].record.value.title).toBe('legacy');expect(legacy.getItem('weava-draft:one')).toBeNull();
  for(let index=0;index<39;index++)await repository.save(record('item-'+index,'draft'),index+2000);
  await expect(repository.save(record('overflow','draft'))).rejects.toThrow(/容量上限/);
  expect(db.rows.size).toBe(40);expect((await repository.read('one'))[0].record.value.title).toBe('legacy');
  const large=record('large','large');large.value.document={version:1,format:'markdown',source:'x'.repeat(2000000)};
  await expect(repository.save(large)).rejects.toThrow(/过大/);expect(db.rows.has('large')).toBe(false);
});
