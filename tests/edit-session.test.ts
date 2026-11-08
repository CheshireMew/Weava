import { expect, it } from 'vitest';
import { EditSession } from '../apps/admin/src/edit-session.ts';
const row = {id:'entry',revision:1,value:{name:'Original'}};
it('rebases edits made during a server mutation and serializes autosave with its returned revision',async()=>{
  const initial={...row,value:{name:'Original',groupId:'first',archived:false}}, writes:any[]=[],local=storage();
  const session=new EditSession(initial,async value=>{writes.push(value);return {...value,revision:value.revision+1};},()=>{},local,'media');
  let finish!:(row:typeof initial)=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve);
  const operation=session.mutate(async snapshot=>{expect(snapshot).toEqual(initial);entered();return new Promise(resolve=>finish=resolve);});
  await started;
  session.change({...initial,value:{...initial.value,name:'New input'}});
  const saving=session.save();
  expect(writes).toHaveLength(0);
  finish({...initial,revision:2,value:{...initial.value,groupId:'second',archived:true}});
  await Promise.all([operation,saving]);
  expect(writes).toMatchObject([{revision:2,value:{name:'New input',groupId:'second',archived:true}}]);
  expect(session.record).toMatchObject({revision:3,value:{name:'New input',groupId:'second',archived:true}});
  expect(session.dirty).toBe(false);expect(local.length).toBe(0);
});
it('keeps edits and recovery on mutation failure and never overwrites another selected record',async()=>{
  const local=storage(),session=new EditSession(row,async value=>value,()=>{},local,'media');
  let fail!:(error:Error)=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve);
  const operation=session.mutate(async()=>{entered();return new Promise((_resolve,reject)=>fail=reject);});
  const rejected=expect(operation).rejects.toThrow('Offline');await started;
  session.change({...row,value:{name:'Retained'}});fail(new Error('Offline'));await rejected;
  expect(session.record?.value.name).toBe('Retained');expect(session.dirty).toBe(true);expect(local.length).toBe(1);
  session.discard();
  await session.mutate(async snapshot=>{session.adopt({...row,id:'another'});return {...snapshot!,revision:2};});
  expect(session.record?.id).toBe('another');
});
it('recognizes an undo to the saved value and reads dirty state without traversing a large document',()=>{
  let reads=0;const document={get source(){reads++;return '正文'.repeat(100000);}};
  const initial={...row,value:{name:'Original',document}};
  const session=new EditSession(initial,async value=>value,()=>{});
  session.change({...initial,value:{...initial.value,name:'Changed'}});expect(session.dirty).toBe(true);
  const before=reads;for(let index=0;index<100;index++)expect(session.dirty).toBe(true);expect(reads).toBe(before);
  session.change({...initial,value:{...initial.value,name:'Original'}});expect(session.dirty).toBe(false);
});
function storage() { const values = new Map<string,string>(); return {get length(){return values.size;},key:(index:number)=>[...values.keys()][index]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}}; }
it('keeps independent recovery copies when another window saves or continues editing',async()=>{
  const local=storage(),write=async(value:typeof row)=>({...value,revision:2});
  const a=new EditSession(row,write,()=>{},local,'settings'),b=new EditSession(row,write,()=>{},local,'settings');
  a.change({...row,value:{name:'Window A'}});b.change({...row,value:{name:'Window B'}});await b.save();
  const reopened=new EditSession(row,write,()=>{},local,'settings');
  expect(reopened.recovery?.value.name).toBe('Window A');reopened.recover();
  a.change({...row,value:{name:'Window A continued'}});await reopened.save();
  expect(new EditSession(row,write,()=>{},local,'settings').recovery?.value.name).toBe('Window A continued');
});
it('ARC-04 keeps revision and value together on clean refresh and preserves the old base for dirty edits',()=>{
  const session = new EditSession(row,async value=>value,()=>{});
  session.receive({...row,revision:2,value:{name:'Remote'}});
  expect(session.record).toMatchObject({revision:2,value:{name:'Remote'}});
  session.change({...session.record!,value:{name:'Local'}});
  session.receive({...row,revision:3,value:{name:'New remote'}});
  expect(session.record).toMatchObject({revision:2,value:{name:'Local'}});
});
it('ARC-06 serializes saves and drains edits made while the first snapshot was in flight',async()=>{
  let finish:()=>void; const gate = new Promise<void>(resolve=>finish=resolve), writes:any[]=[];
  const session = new EditSession(row,async snapshot=>{writes.push(structuredClone(snapshot));if(writes.length===1)await gate;return {...snapshot,revision:snapshot.revision!+1};},()=>{});
  session.change({...row,value:{name:'First'}}); const saving = session.save();
  session.change({...row,value:{name:'Second'}}); const next = session.save();
  finish!(); await Promise.all([saving,next]);
  expect(writes.map(item=>[item.revision,item.value.name])).toEqual([[1,'First'],[2,'Second']]);
  expect(session.record).toMatchObject({revision:3,value:{name:'Second'}}); expect(session.dirty).toBe(false);
});
it('ARC-08 retains failed edits across remount and recovers with their original conflict base',async()=>{
  const local=storage(),session=new EditSession(row,async()=>{throw new Error('Offline');},()=>{},local,'settings');
  session.change({...row,value:{name:'Unsaved'}}); await expect(session.save()).rejects.toThrow('Offline');
  const reopened=new EditSession({...row,revision:2,value:{name:'Remote update'}},async value=>value,()=>{},local,'settings');
  expect(reopened.recovery).toMatchObject({revision:1,value:{name:'Unsaved'}});
  reopened.recover(); expect(reopened.record?.revision).toBe(1); expect(reopened.dirty).toBe(true);
  reopened.discard(); expect(reopened.record).toMatchObject({revision:2,value:{name:'Remote update'}});
});
it('ARC-08 discovers a new form and an unselected record after reopening',()=>{
  const local=storage(),initial={id:'new-plan',revision:null,value:{id:'new-plan',name:''}};
  const first=new EditSession(initial,async value=>value,()=>{},local,'plans');
  first.change({...initial,value:{...initial.value,name:'Unsaved plan'}});
  const reopened=new EditSession({...initial,id:'another-plan',value:{id:'another-plan',name:''}},async value=>value,()=>{},local,'plans');
  expect(reopened.recovery?.value.name).toBe('Unsaved plan');reopened.recover();expect(reopened.record?.id).toBe('new-plan');expect(reopened.dirty).toBe(true);
  const unselected=new EditSession(null,async value=>value,()=>{},local,'plans');
  expect(unselected.recovery).not.toBeNull();unselected.discardRecovery();
  expect(new EditSession(null,async value=>value,()=>{},local,'plans').recovery).toBeNull();
});
