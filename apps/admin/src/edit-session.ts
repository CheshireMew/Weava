export interface EditableRecord { id?: string; revision: number | null; value: any; [key: string]: any }
export interface RecoveryStore { getItem(key: string): string | null; setItem(key: string,value: string): void; removeItem(key: string): void }
const valueKey = (row: EditableRecord | null) => row ? JSON.stringify(row.value) : '';
export class EditSession<R extends EditableRecord> {
  record: R | null;
  recovery: R | null = null;
  notice = '';
  private baseline: string;
  private baseRecord: R | null;
  private running: Promise<R | null> | null = null;
  private generation = 0;
  constructor(initial: R | null, private write: (record: R) => Promise<R>, private notify: () => void, private storage?: RecoveryStore, private prefix = '', private afterSave?: (row: R, snapshot: R, unchanged: boolean) => void) {
    this.record = initial; this.baseRecord = initial ? structuredClone(initial) : null; this.baseline = valueKey(initial); this.findRecovery(true);
  }
  get dirty() { return !!this.record && valueKey(this.record) !== this.baseline; }
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
      if (raw) { const row = JSON.parse(raw); if (row?.value && valueKey(row) !== this.baseline) this.recovery = row; }
    }
    catch { this.notice = '浏览器副本无法读取，请保留浏览器数据。'; }
  }
  change = (next: R | null | ((previous: R | null) => R | null)) => {
    this.record = typeof next === 'function' ? next(this.record) : next; this.remember(); this.notify();
  };
  adopt = (row: R | null) => {
    this.generation++; this.record = row; this.baseRecord = row ? structuredClone(row) : null; this.baseline = valueKey(row); this.findRecovery(); this.notify();
  };
  receive(row: R | null) {
    if (!this.dirty && !this.running && JSON.stringify(this.record) !== JSON.stringify(row)) this.adopt(row);
  }
  recover = () => {
    if (!this.recovery) return;
    // Retain the recovery copy's original revision. A changed server must reject it.
    this.record = this.recovery; this.recovery = null; this.remember(); this.notify();
  };
  discardRecovery = () => {
    try { this.storage?.removeItem(this.key(this.recovery)); this.recovery = null; } catch { this.notice = '无法更新浏览器副本，请保留浏览器数据。'; } this.notify();
  };
  discard = () => {
    try { this.storage?.removeItem(this.key()); } catch { this.notice = '无法清除浏览器副本。'; }
    this.record = this.baseRecord ? structuredClone(this.baseRecord) : null;
    this.recovery = null; this.notify();
  };
  save = async (): Promise<R | null> => {
    if (this.running) { await this.running; return this.save(); }
    if (!this.dirty || !this.record) return this.record;
    const snapshot = structuredClone(this.record), generation = this.generation;
    this.running = (async () => {
      const row = await this.write(snapshot);
      if (this.generation === generation) {
        const unchanged = valueKey(this.record) === valueKey(snapshot);
        this.baseline = valueKey(row);
        this.baseRecord = structuredClone(row);
        this.record = unchanged ? row : {...row,value:this.record!.value};
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
