import Database from 'better-sqlite3';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { canonicalPath as canonical } from './paths.ts';

interface LeaseRow { id: string; pid: number; role: 'writer' | 'maintenance' }
interface Maintenance { root: string; id: string; owner?: string }
const context = new AsyncLocalStorage<Maintenance>();
export interface InstanceWriter { id: string; release(): void }

const coordinatorPath = (root: string) => canonical(root) + '.access.sqlite';
function coordinator(root: string) {
  const path = coordinatorPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('busy_timeout=5000');
  db.exec("CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,pid INTEGER NOT NULL,role TEXT NOT NULL CHECK(role IN ('writer','maintenance')))");
  return db;
}
export function processAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error: any) { return error.code !== 'ESRCH'; }
}
function active(db: Database.Database) {
  const rows = db.prepare('SELECT id,pid,role FROM leases').all() as LeaseRow[];
  return rows.filter((row) => {
    if (processAlive(row.pid)) return true;
    db.prepare('DELETE FROM leases WHERE id=?').run(row.id);
    return false;
  });
}
function release(root: string, id: string) {
  const db = coordinator(root);
  try { db.prepare('DELETE FROM leases WHERE id=? AND pid=?').run(id, process.pid); }
  finally { db.close(); }
}
function delegated(root: string) {
  const current = context.getStore();
  if (current?.root === canonical(root)) return current;
  if (process.env.WEAVA_MAINTENANCE_ROOT === canonical(root) && process.env.WEAVA_MAINTENANCE_TOKEN)
    return { root: canonical(root), id: process.env.WEAVA_MAINTENANCE_TOKEN };
  return undefined;
}
export function acquireInstanceWriter(root: string): InstanceWriter {
  const id = randomUUID(), db = coordinator(root), permit = delegated(root);
  try {
    db.transaction(() => {
      const maintenance = active(db).find((row) => row.role === 'maintenance');
      if (maintenance && maintenance.id !== permit?.id) throw new WeavaError('站点正在离线维护，请等待维护结束后重试。', 409);
      db.prepare("INSERT INTO leases VALUES(?,?,'writer')").run(id, process.pid);
    }).immediate();
  } finally { db.close(); }
  let released = false;
  return { id, release() { if (!released) { release(root, id); released = true; } } };
}

export function assertServiceStopped(root: string) {
  const file = join(root, 'runtime.json');
  if (!existsSync(file)) return;
  const runtime = JSON.parse(readFileSync(file, 'utf8'));
  if (runtime.status !== 'stopped' && processAlive(runtime.pid)) throw new WeavaError('站点服务仍在运行，请先停止服务。', 409);
}
function assertLegacyWorkersStopped(root: string) {
  const file = join(root, 'weava.sqlite');
  if (!existsSync(file)) return;
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='jobs'").get()) return;
    for (const row of db.prepare("SELECT data FROM jobs WHERE status IN ('queued','running')").iterate() as Iterable<{ data: string }>) {
      const job = JSON.parse(row.data);
      if (processAlive(job.workerPid)) throw new WeavaError('站点任务仍在写入，请等待任务结束后进行离线维护。', 409);
    }
  } finally { db.close(); }
}
export function assertMaintenanceAvailable(root: string) {
  assertServiceStopped(root); assertLegacyWorkersStopped(root);
  if (!existsSync(coordinatorPath(root))) return;
  const db = coordinator(root), permit = delegated(root);
  try {
    const busy = db.transaction(() => active(db).some((row) => row.id !== permit?.id && row.id !== permit?.owner)).immediate();
    if (busy) throw new WeavaError('站点仍被写入连接或任务占用，请等待关闭后进行离线维护。', 409);
  } finally { db.close(); }
}

/** Keep the lease across async preparation, validation, replacement and recovery.
 * An existing Storage can explicitly retain its one owned connection for VACUUM.
 * Other writers, including those in the same process, remain excluded. */
export function withInstanceMaintenance<T>(root: string, action: () => T, owner?: InstanceWriter): T {
  const key = canonical(root), existing = context.getStore();
  if (existing?.root === key) return action();
  assertServiceStopped(root); assertLegacyWorkersStopped(root);
  const id = randomUUID(), db = coordinator(root);
  try {
    db.transaction(() => {
      if (active(db).some((row) => row.id !== owner?.id)) throw new WeavaError('站点仍被写入连接或任务占用，不能开始离线维护。', 409);
      db.prepare("INSERT INTO leases VALUES(?,?,'maintenance')").run(id, process.pid);
    }).immediate();
  } finally { db.close(); }
  let result: T;
  try { result = context.run({ root: key, id, owner: owner?.id }, action); }
  catch (error) { release(root, id); throw error; }
  if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function')
    return Promise.resolve(result).finally(() => release(root, id)) as T;
  release(root, id); return result;
}
export function maintenanceEnvironment(root: string) {
  const permit = delegated(root);
  return { WEAVA_MAINTENANCE_ROOT: permit?.root ?? '', WEAVA_MAINTENANCE_TOKEN: permit?.id ?? '' };
}
