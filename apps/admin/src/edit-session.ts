export interface EditableRecord { id?: string; revision: number | null; value: any; [key: string]: any }
export interface RecoveryStore { getItem(key: string): string | null; setItem(key: string,value: string): void; removeItem(key: string): void }
/** Immutable editor updates share their untouched subtrees; compare only changed branches. */
export function sameEditableValue(a:any,b:any):boolean{
  if(Object.is(a,b))return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const left=Object.keys(a).filter(key=>a[key]!==undefined),right=Object.keys(b).filter(key=>b[key]!==undefined);
  return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameEditableValue(a[key],b[key]));
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
  checkpoint() { return { generation: this.generation, edits: this.edits }; }
  unchanged(checkpoint: ReturnType<EditSession<R>['checkpoint']>) { return checkpoint.generation === this.generation && checkpoint.edits === this.edits; }
  constructor(initial: R | null, private write: (record: R) => Promise<R>, private notify: () => void, private storage?: RecoveryStore, private prefix = '', private afterSave?: (row: R, snapshot: R, unchanged: boolean) => void, private externalRecovery?: (row:R)=>Promise<void>) {
    this.record = initial; this.baseRecord = initial ? structuredClone(initial) : null; this.baselineValue = initial?.value; this.findRecovery(true);
  }
  get dirty() { return !!this.record && this.modified; }
  get saving() { return !!this.running; }
  rebind(write:(record:R)=>Promise<R>,notify:()=>void,afterSave?: (row:R,snapshot:R,unchanged:boolean)=>void,externalRecovery?:(row:R)=>Promise<void>){this.write=write;this.notify=notify;this.afterSave=afterSave;this.externalRecovery=externalRecovery;}
  async preserve(){
    if(!this.dirty||!this.record)return;
    if(this.externalRecovery)return this.externalRecovery(structuredClone(this.record));
    if(!this.storage)throw new Error('浏览器无法保留这份修改，请保持页面打开并保存。');
    this.storage.setItem(this.key(),JSON.stringify(this.record));this.storage.setItem(this.prefix+':last',this.key());
  }
  private changed(){this.modified=!!this.record&&!sameEditableValue(this.record.value,this.baselineValue);}
  private key(row = this.record) { return this.prefix + ':' + (row?.id ?? row?.value.id ?? 'new'); }
  private remember() {
    if (!this.record || !this.dirty) return;
    try { this.storage?.setItem(this.key(),JSON.stringify(this.record)); this.storage?.setItem(this.prefix+':last',this.key()); }
    catch { this.notice = '浏览器无法保留副本，请保持页面打开并保存。'; }
  }
  private findRecovery(initial = false) {
    this.recovery = null;
    try {
      const pending=initial?this.storage?.getItem(this.prefix+':last'):null;
      const raw = (this.record?this.storage?.getItem(this.key()):null) || (pending?this.storage?.getItem(pending):null);
      if (raw) { const row = JSON.parse(raw); if (row?.value && !sameEditableValue(row.value,this.baselineValue)) this.recovery = row; }
    }
    catch { this.notice = '浏览器副本无法读取，请保留浏览器数据。'; }
  }
  change = (next: R | null | ((previous: R | null) => R | null)) => {
    const record = typeof next === 'function' ? next(this.record) : next;
    if (!sameEditableValue(this.record?.value, record?.value)) this.edits++;
    this.record = record; this.changed(); this.remember(); this.notify();
  };
  adopt = (row: R | null) => {
    this.generation++; this.record = row; this.baseRecord = row ? structuredClone(row) : null; this.baselineValue = row?.value; this.modified=false; this.findRecovery(); this.notify();
  };
  receive(row: R | null) {
    if (!this.dirty && !this.running && !sameEditableValue(this.record,row)) this.adopt(row);
  }
  recover = () => {
    if (!this.recovery) return;
    // Retain the recovery copy's original revision. A changed server must reject it.
    this.record = this.recovery; this.recovery = null; this.changed(); this.remember(); this.notify();
  };
  discardRecovery = () => {
    try { this.storage?.removeItem(this.key(this.recovery)); this.recovery = null; } catch { this.notice = '无法更新浏览器副本，请保留浏览器数据。'; } this.notify();
  };
  discard = () => {
    try { this.storage?.removeItem(this.key()); } catch { this.notice = '无法清除浏览器副本。'; }
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
        this.record = unchanged ? row : {...row,value:this.record!.value};
        this.changed();
        if (unchanged) { try { this.storage?.removeItem(this.key()); } catch { this.notice = '网站已保存，但浏览器副本未能更新。'; } this.recovery = null; }
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
