export interface QuerySnapshot<T = any> {
  data?: T;
  error: string;
  pending: boolean;
  invalidation: number;
}
interface Entry {
  snapshot: QuerySnapshot;
  expires: number;
  bytes: number;
  epoch: number;
  request?: Promise<any>;
}

/** Session-local display data only. Editors, credentials and job polling never use this cache. */
export class QueryCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private epoch = 0;
  private suspended = false;
  private writes = new Set<{matches:(key:string)=>boolean;done:Promise<void>}>();
  constructor(private maximum = 80, private maximumBytes = 16 * 1024 * 1024, private clock = () => Date.now()) {}
  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { snapshot: { error: '', pending: false, invalidation: this.epoch }, expires: 0, bytes: 0, epoch: this.epoch };
      this.entries.set(key, entry);
    }
    return entry;
  }
  snapshot = (key: string): QuerySnapshot => this.entry(key).snapshot;
  subscribe = (key: string, listener: () => void) => {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  };
  private notify(key: string) { this.listeners.get(key)?.forEach(listener => listener()); }
  private trim() {
    let bytes = [...this.entries.values()].reduce((total, entry) => total + entry.bytes, 0);
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maximum && bytes <= this.maximumBytes) break;
      if (entry.request || this.listeners.has(key)) continue;
      bytes -= entry.bytes; this.entries.delete(key);
    }
  }
  read<T>(key: string, load: () => Promise<T>, force = false, ttl = 30000): Promise<T> {
    if (this.suspended) return Promise.reject(new Error('请重新登录后继续。'));
    const writes=[...this.writes].filter(write=>write.matches(key));
    if(writes.length)return Promise.all(writes.map(write=>write.done)).then(()=>this.read(key,load,force,ttl));
    const entry = this.entry(key);
    if (entry.request) return entry.request;
    if (!force && entry.snapshot.data !== undefined && entry.expires > this.clock()) return Promise.resolve(entry.snapshot.data);
    const epoch = entry.epoch;
    entry.snapshot = { ...entry.snapshot, pending: true, error: '' };
    const request = Promise.resolve().then(load).then(data => {
      // A write or a new login may have overtaken this request. Never repopulate with its old result.
      if (entry.epoch !== epoch || this.entries.get(key) !== entry) return this.read(key, load, false, ttl);
      entry.snapshot = { ...entry.snapshot, data, pending: false, error: '' };
      entry.expires = this.clock() + ttl;
      entry.bytes = (JSON.stringify(data)?.length ?? 0) * 2;
      this.entries.delete(key); this.entries.set(key, entry);
      return data;
    }, error => {
      if (entry.epoch === epoch && this.entries.get(key) === entry)
        entry.snapshot = { ...entry.snapshot, pending: false, error: error.message };
      throw error;
    }).finally(() => {
      if (entry.request !== request) return;
      entry.request = undefined; this.notify(key); this.trim();
    });
    entry.request = request; this.notify(key); return request;
  }
  beginWrite(matches:(key:string)=>boolean) {
    let finish!:()=>void;
    const write={matches,done:new Promise<void>(resolve=>{finish=resolve;})};
    this.writes.add(write);
    // Fence old responses immediately; subscribers revalidate once, after commit.
    this.epoch++;
    for(const [key,entry]of this.entries)if(matches(key)){entry.epoch=this.epoch;entry.expires=0;entry.request=undefined;}
    let ended=false;
    return ()=>{if(ended)return;ended=true;this.writes.delete(write);this.invalidate(false,matches);finish();};
  }
  invalidate(clear = false, matches:(key:string)=>boolean = ()=>true) {
    this.epoch++;
    for (const [key, entry] of this.entries) {
      if(!matches(key))continue;
      entry.epoch = this.epoch; entry.expires = 0; entry.request = undefined;
      entry.snapshot = { ...(!clear ? { data: entry.snapshot.data } : {}), pending: false, error: '', invalidation: this.epoch };
      if (clear) entry.bytes = 0;
      this.notify(key);
    }
    this.trim();
  }
  suspend() { this.suspended = true; this.invalidate(true); }
  resume() { this.suspended = false; this.invalidate(true); }
}
export const adminQueries = new QueryCache();
