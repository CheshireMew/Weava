import { expect, it } from 'vitest';
import { EditSession } from '../apps/admin/src/edit-session.ts';
const row = {id:'entry',revision:1,value:{name:'Original'}};
it('recognizes an undo to the saved value and reads dirty state without traversing a large document',()=>{
  let reads=0;const document={get source(){reads++;return '正文'.repeat(100000);}};
  const initial={...row,value:{name:'Original',document}};
  const session=new EditSession(initial,async value=>value,()=>{});
  session.change({...initial,value:{...initial.value,name:'Changed'}});expect(session.dirty).toBe(true);
  const before=reads;for(let index=0;index<100;index++)expect(session.dirty).toBe(true);expect(reads).toBe(before);
  session.change({...initial,value:{...initial.value,name:'Original'}});expect(session.dirty).toBe(false);
});
function storage() { const values = new Map<string,string>(); return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}}; }
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
