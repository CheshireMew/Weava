import {RecordRecovery,type EditableRecord,type RecoveryStore} from './record-recovery.ts';
export type {EditableRecord,RecoveryStore} from './record-recovery.ts';
/** Immutable editor updates share their untouched subtrees; compare only changed branches. */
export function sameEditableValue(a:any,b:any):boolean{
  if(Object.is(a,b))return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const left=Object.keys(a).filter(key=>a[key]!==undefined),right=Object.keys(b).filter(key=>b[key]!==undefined);
  return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameEditableValue(a[key],b[key]));
}
/** Apply only edits made after the base snapshot to the latest server value. Arrays are atomic fields. */
export function rebaseEditableValue(base:any,local:any,remote:any):any {
  if (sameEditableValue(base,local)) return remote;
  if (![base,local,remote].every(value=>value&&typeof value==='object'&&!Array.isArray(value))) return local;
  const value={...remote};
  for(const key of new Set([...Object.keys(base),...Object.keys(local)])) {
    if(sameEditableValue(base[key],local[key])) continue;
    if(Object.hasOwn(local,key)) value[key]=rebaseEditableValue(base[key],local[key],remote[key]);
    else delete value[key];
  }
  return value;
}
export class EditSession<R extends EditableRecord> {
  record: R | null;
  recovery: R | null = null;
  notice = '';
  private baselineValue: any;
  private modified = false;
  private baseRecord: R | null;
  private running: Promise<R | null> | null = null;
  private generation = 0;
  private edits = 0;
  private copies?:RecordRecovery<R>;
  private selectedCopy?:NonNullable<ReturnType<RecordRecovery<R>['find']>>;
  private recoveredCopy?:NonNullable<ReturnType<RecordRecovery<R>['find']>>;
  checkpoint() { return { generation: this.generation, edits: this.edits }; }
  unchanged(checkpoint: ReturnType<EditSession<R>['checkpoint']>) { return checkpoint.generation === this.generation && checkpoint.edits === this.edits; }
  constructor(initial: R | null, private write: (record: R) => Promise<R>, private notify: () => void, private storage?: RecoveryStore, private prefix = '', private afterSave?: (row: R, snapshot: R, unchanged: boolean) => void, private externalRecovery?: (row:R)=>Promise<void>) {
    if(storage)this.copies=new RecordRecovery(storage,prefix,sameEditableValue);
    this.record = initial; this.baseRecord = initial ? structuredClone(initial) : null; this.baselineValue = initial?.value; this.findRecovery(true);
  }
  get dirty() { return !!this.record && this.modified; }
  get saving() { return !!this.running; }
  rebind(write:(record:R)=>Promise<R>,notify:()=>void,afterSave?: (row:R,snapshot:R,unchanged:boolean)=>void,externalRecovery?:(row:R)=>Promise<void>){this.write=write;this.notify=notify;this.afterSave=afterSave;this.externalRecovery=externalRecovery;}
  async preserve(){
    if(!this.dirty||!this.record)return;
    if(this.externalRecovery)return this.externalRecovery(structuredClone(this.record));
    if(!this.storage)throw new Error('浏览器无法保留这份修改，请保持页面打开并保存。');
    this.copies!.remember(this.record);
  }
  private changed(){this.modified=!!this.record&&!sameEditableValue(this.record.value,this.baselineValue);}
  private remember() {
    if (!this.record || !this.dirty) return;
    try { this.copies?.remember(this.record); }
    catch { this.notice = '浏览器无法保留副本，请保持页面打开并保存。'; }
  }
  private findRecovery(initial = false) {
    this.recovery = null;
    try {
      this.selectedCopy=this.copies?.find(this.record,initial);
      this.recovery=this.selectedCopy?.record??null;
    }
    catch { this.notice = '浏览器副本无法读取，请保留浏览器数据。'; }
  }
  change = (next: R | null | ((previous: R | null) => R | null)) => {
    const record = typeof next === 'function' ? next(this.record) : next;
    if (!sameEditableValue(this.record?.value, record?.value)) this.edits++;
    this.record = record; this.changed(); this.remember(); this.notify();
  };
  adopt = (row: R | null) => {
    this.generation++;this.recoveredCopy=undefined; this.record = row; this.baseRecord = row ? structuredClone(row) : null; this.baselineValue = row?.value; this.modified=false; this.findRecovery(); this.notify();
  };
  receive(row: R | null, options: {preserveEdits?:boolean} = {}) {
    if(options.preserveEdits&&row&&this.record&&this.record.id===row.id&&this.dirty&&!this.running) {
      const value=rebaseEditableValue(this.baselineValue,this.record.value,row.value);
      this.adopt(row);
      this.change({...row,value});
      return;
    }
    if (!this.dirty && !this.running && !sameEditableValue(this.record,row)) this.adopt(row);
  }
  /** Serialize a server mutation with saves; retain fields edited while it was running. */
  async mutate(write: (snapshot: R | null) => Promise<R | null>): Promise<R | null> {
    await this.save();
    // Another save or mutation can have started while awaiting the previous save.
    if (this.running || this.dirty) return this.mutate(write);
    const snapshot = this.record ? structuredClone(this.record) : null, generation = this.generation;
    this.running = (async () => {
      const row = await write(snapshot);
      if (row && snapshot && row.id === snapshot.id && this.generation === generation) {
        const value = rebaseEditableValue(snapshot.value,this.record!.value,row.value);
        this.record = { ...row, value };
        this.baseRecord = structuredClone(row); this.baselineValue = row.value; this.changed();
        if (this.dirty) this.remember();
        else {
          try { this.copies?.acknowledge(snapshot); this.findRecovery(); }
          catch { this.notice = '网站已保存，但浏览器副本未能更新。'; }
        }
        this.notify();
      }
      return row;
    })();
    try { return await this.running; } finally { this.running = null; }
  }
  recover = () => {
    if (!this.recovery) return;
    // Retain the recovery copy's original revision. A changed server must reject it.
    this.edits++;this.recoveredCopy=this.selectedCopy;
    this.record = this.recovery; this.recovery = null; this.changed();
    try { this.copies?.remember(this.record);if(this.recoveredCopy)this.copies?.discard(this.recoveredCopy);this.recoveredCopy=undefined; }
    catch { this.notice='浏览器无法保留副本，请保持页面打开并保存。'; }
    this.notify();
  };
  discardRecovery = () => {
    try { if(this.selectedCopy)this.copies?.discard(this.selectedCopy);this.findRecovery(true); } catch { this.notice = '无法更新浏览器副本，请保留浏览器数据。'; } this.notify();
  };
  discard = () => {
    this.generation++;
    try { this.copies?.discardOwn(this.record);if(this.recoveredCopy)this.copies?.discard(this.recoveredCopy);this.recoveredCopy=undefined; } catch { this.notice = '无法清除浏览器副本。'; }
    this.record = this.baseRecord ? structuredClone(this.baseRecord) : null;
    this.modified=false; this.recovery = null; this.notify();
  };
  save = async (): Promise<R | null> => {
    if (this.running) { await this.running; return this.save(); }
    if (!this.dirty || !this.record) return this.record;
    const snapshot = structuredClone(this.record), generation = this.generation;
    this.running = (async () => {
      const row = await this.write(snapshot);
      if (this.generation === generation) {
        const unchanged = sameEditableValue(this.record?.value,snapshot.value);
        this.baselineValue = row.value;
        this.baseRecord = structuredClone(row);
        this.record = unchanged ? row : {...row,value:rebaseEditableValue(snapshot.value,this.record!.value,row.value)};
        this.changed();
        if (unchanged) { try { this.copies?.acknowledge(snapshot);if(this.recoveredCopy)this.copies?.discard(this.recoveredCopy);this.recoveredCopy=undefined;this.findRecovery(); } catch { this.notice = '网站已保存，但浏览器副本未能更新。'; } }
        else this.remember();
        this.afterSave?.(row, snapshot, unchanged);
        this.notify();
      }
      return row;
    })();
    let row: R | null;
    try { row = await this.running; } finally { this.running = null; }
    return this.dirty && generation === this.generation ? this.save() : row;
  };
}
