import { isUploadFormat, mediaUploadMaxBytes } from '@weava/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { WeavaError } from '../../contracts/src/errors.ts';
import { inside } from '../../runtime-common/src/paths.ts';
import { digestFileAsync } from './file-io.ts';
import type { JobRunner } from './job-runner.ts';
import { prepareMedia, queueMediaOptimization } from './media.ts';
import { validateMediaFormat } from './media-format.ts';
import type { Site } from './site.ts';
import { closeStagedRequest, expireUploads, registerStagedRequest, temporaryPath } from './temporary-files.ts';

/** Normal uploads stream once; only explicit resumable clients need upload sessions. */
export async function receiveMediaFile(site: Site, request: Request, options: { name: string; groupId?: string }) {
  if (!options.name || options.name.length > 300 || !isUploadFormat(options.name)) throw new WeavaError('不支持这个附件格式。');
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/octet-stream') throw new WeavaError('上传需要二进制内容。', 415);
  if (!request.body || Number(request.headers.get('content-length')) > mediaUploadMaxBytes) throw new WeavaError('附件大小需要在 32 MB 以内。', 413);
  if (options.groupId) {
    const group = site.store.get('media-group', options.groupId);
    if (!group || group.value.archived) throw new WeavaError('媒体分组不存在或已归档。');
  }
  const path = 'uploads/' + randomUUID() + '.bin',
    stagedId = registerStagedRequest(site, path, 'media-file', Number(request.headers.get('content-length')) || mediaUploadMaxBytes),
    staging = temporaryPath(site, path),
    reader = request.body.getReader(), hash = createHash('sha256'),
    ext = extname(options.name).toLowerCase(), text = ['.txt', '.csv', '.srt', '.vtt'].includes(ext);
  let bytes = 0, header = Buffer.alloc(0), file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(join(site.root, 'uploads'), { recursive: true });
    file = await open(staging, 'wx');
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > mediaUploadMaxBytes) { await reader.cancel(); throw new WeavaError('附件大小需要在 32 MB 以内。', 413); }
      const part = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (header.length < 32) header = Buffer.concat([header, part.subarray(0, 32 - header.length)]);
      if (text) validateMediaFormat(part, ext);
      hash.update(part);
      await file.writeFile(part);
    }
    if (!bytes) throw new WeavaError('上传文件为空。');
    validateMediaFormat(header, ext);
    await file.sync();
    await file.close(); file = undefined;
    const prepared = await prepareMedia(site, staging, options.name, { hash: hash.digest('hex'), validatedSize: bytes, move: true, optimize: false });
    const row = site.store.raw.transaction(() => {
      const existing = site.store.get('media', prepared.id);
      const value = { ...(existing?.value ?? prepared.value), ...(options.groupId ? { groupId: options.groupId } : {}) };
      const saved = existing && (!options.groupId || existing.value.groupId === options.groupId)
        ? existing : site.store.put('media', prepared.id, value, existing?.revision ?? null, '上传');
      queueMediaOptimization(site, saved.id);
      return saved;
    }).immediate();
    // Duplicate uploads may leave a staging file; its cleanup cannot fail an accepted upload.
    void unlink(staging).then(() => {
      if (site.store.raw.open) site.store.raw.prepare('DELETE FROM staged_requests WHERE id=?').run(stagedId);
    }, (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && site.store.raw.open) site.store.raw.prepare('DELETE FROM staged_requests WHERE id=?').run(stagedId);
    });
    return row;
  } finally {
    reader.releaseLock(); await file?.close();
    closeStagedRequest(site, stagedId, bytes);
    site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(stagedId);
  }
}
interface Upload {
  id: string;
  name: string;
  size: number;
  offset: number;
  status: string;
  path: string;
  expires: number;
  lease: string | null;
  lease_until: number;
  job_id: string | null;
  sha256: string | null;
  verified: number;
}
export const uploadChunkBytes = 1024 * 1024;
const wire = (row: Upload) => ({
  id: row.id,
  name: row.name,
  size: row.size,
  offset: row.offset,
  status: row.status,
  sha256: row.sha256,
  expiresAt: new Date(row.expires).toISOString(),
  chunkBytes: uploadChunkBytes,
  ...(row.job_id ? { jobId: row.job_id } : {}),
});
function find(site: Site, id: string) {
  const row = site.store.raw.prepare('SELECT * FROM media_uploads WHERE id=?').get(id) as
    Upload | undefined;
  if (!row) throw new WeavaError('上传不存在。', 404);
  return row;
}
export function beginMediaUpload(
  site: Site,
  name: string,
  size: number,
  key?: string,
  sha256?: string,
) {
  if (!Number.isSafeInteger(size) || size < 1 || size > mediaUploadMaxBytes)
    throw new WeavaError('附件大小需要在 32 MB 以内。');
  if (!name || name.length > 300 || !isUploadFormat(name))
    throw new WeavaError('不支持这个附件格式。');
  if (!sha256 || !/^([a-f0-9]{64})$/.test(sha256))
    throw new WeavaError('上传需要文件的 SHA-256 校验值，请更新客户端后重试。');
  return site.store.raw
    .transaction(() => {
      if (key) {
        const old = site.store.raw
          .prepare('SELECT * FROM media_uploads WHERE idempotency=?')
          .get(key) as Upload | undefined;
        if (old) {
          if (old.name !== name || old.size !== size || old.sha256 !== sha256)
            throw new WeavaError('相同上传标识不能用于不同文件。', 409);
          return wire(old);
        }
      }
      const pending = site.store.raw
        .prepare(
          "SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM media_uploads WHERE status NOT IN ('complete','purged')",
        )
        .get() as { count: number; bytes: number };
      if (pending.count >= 128 || pending.bytes + size > 256 * 1024 * 1024)
        throw new WeavaError(
          '未完成上传已达到容量上限，请在维护页面检查并清理不再需要的上传。',
          429,
        );
      const id = randomUUID();
      site.store.raw
        .prepare(
          "INSERT INTO media_uploads(id,name,size,offset,status,path,expires,idempotency,sha256) VALUES(?,?,?,0,'receiving',?,?,?,?)",
        )
        .run(
          id,
          name,
          size,
          'uploads/' + id + '.bin',
          Date.now() + 24 * 3600000,
          key ?? null,
          sha256,
        );
      return wire(find(site, id));
    })
    .immediate();
}
export function mediaUploadStatus(site: Site, id: string) {
  expireUploads(site);
  return wire(find(site, id));
}
/** A short lease protects concurrent chunks; the database write lock is never held across network I/O. */
export async function receiveMediaChunk(site: Site, id: string, offset: number, request: Request) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new WeavaError('上传位置无效。');
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/octet-stream')
    throw new WeavaError('上传分块需要二进制内容。', 415);
  const lease = randomUUID(),
    row = site.store.raw
      .transaction(() => {
        const row = find(site, id);
        if (row.status !== 'receiving' || row.expires < Date.now())
          throw new WeavaError('上传已结束或过期，请重新上传。', 409);
        if (row.offset !== offset)
          throw new WeavaError('上传位置已变化，请读取上传状态后继续。', 409, {
            offset: row.offset,
          });
        if (row.lease && row.lease_until > Date.now())
          throw new WeavaError('另一份分块正在上传。', 409);
        site.store.raw
          .prepare('UPDATE media_uploads SET lease=?,lease_until=? WHERE id=?')
          .run(lease, Date.now() + 120000, id);
        return row;
      })
      .immediate();
  let file: Awaited<ReturnType<typeof open>> | undefined,
    leaseUntil = Date.now() + 120000;
  const maximum = Math.min(uploadChunkBytes, row.size - offset);
  let bytes = 0;
  try {
    if (!request.body || maximum < 1 || Number(request.headers.get('content-length')) > maximum)
      throw new WeavaError('上传分块大小无效。', 413);
    await mkdir(join(site.root, 'uploads'), { recursive: true });
    const path = temporaryPath(site, row.path);
    file = await open(path, offset === 0 ? 'w' : 'r+');
    await file.truncate(offset);
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximum) {
          await reader.cancel();
          throw new WeavaError('上传分块超过大小限制。', 413);
        }
        if (Date.now() + 60000 >= leaseUntil) {
          leaseUntil = Date.now() + 120000;
          const renewed = site.store.raw
            .prepare('UPDATE media_uploads SET lease_until=? WHERE id=? AND lease=? AND offset=?')
            .run(leaseUntil, id, lease, offset);
          if (!renewed.changes) {
            await reader.cancel();
            throw new WeavaError('上传分块已由另一请求接管，请重新读取上传状态。', 409);
          }
        }
        let written = 0;
        while (written < value.length) {
          const result = await file.write(
            value,
            written,
            value.length - written,
            offset + bytes - value.length + written,
          );
          written += result.bytesWritten;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (!bytes) throw new WeavaError('上传分块为空。');
    await file.close();
    file = undefined;
    const updated = site.store.raw
      .prepare(
        'UPDATE media_uploads SET offset=offset+?,lease=NULL,lease_until=0,expires=? WHERE id=? AND lease=? AND offset=?',
      )
      .run(bytes, Date.now() + 24 * 3600000, id, lease, offset);
    if (updated.changes !== 1) throw new WeavaError('上传状态已变化，请重试。', 409);
    return wire(find(site, id));
  } finally {
    await file?.close();
    site.store.raw
      .prepare('UPDATE media_uploads SET lease=NULL,lease_until=0 WHERE id=? AND lease=?')
      .run(id, lease);
  }
}
export function finishMediaUpload(site: Site, jobs: Pick<JobRunner, 'enqueue'>, id: string) {
  return site.store.raw
    .transaction(() => {
      const row = find(site, id),
        old = row.job_id ? site.job(row.job_id) : undefined;
      if (old && ['queued', 'running', 'complete'].includes(old.status)) return old;
      if (!['receiving', 'processing'].includes(row.status))
        throw new WeavaError('上传已取消或清理，请重新上传。', 409);
      if (
        row.offset !== row.size ||
        (row.lease && row.lease_until > Date.now()) ||
        row.expires < Date.now()
      )
        throw new WeavaError('文件还没有完整上传，请继续上传。', 409);
      const job = jobs.enqueue(
        'media',
        { path: row.path, name: row.name, uploadId: id, size: row.size },
        'media-upload:' + id + (old ? ':' + old.id : ''),
      );
      site.store.raw
        .prepare("UPDATE media_uploads SET status='processing',job_id=? WHERE id=?")
        .run(job.id, id);
      return job;
    })
    .immediate();
}

/** Commit the library record only after the durable file and upload state agree. */
export async function completeMediaUpload(site: Site, id: string, jobId: string) {
  const upload = find(site, id);
  if (upload.job_id !== jobId) throw new WeavaError('上传任务已变化，请重新读取上传状态。', 409);
  const staging = temporaryPath(site, 'uploads/' + upload.id + '.bin');
  const selected = inside(site.root, upload.path);
  try {
    if (!upload.verified) {
      const file = await open(staging, 'r+');
      try { await file.sync(); } finally { await file.close(); }
      if (!upload.sha256 || await digestFileAsync(staging) !== upload.sha256)
        throw new WeavaError('文件校验失败，上传内容与选择的文件不同，请重新上传。', 409);
      site.store.raw
        .prepare('UPDATE media_uploads SET verified=1 WHERE id=? AND job_id=?')
        .run(id, jobId);
    }
    const prepared = await prepareMedia(
      site,
      existsSync(selected) ? selected : staging,
      upload.name,
      { hash: upload.sha256!, move: true, optimize: false },
    );
    const destination = prepared.value.url.slice(1);
    // Persist a readable recovery location before releasing the owned staging
    // file. A retry can resume here even if the database commit is interrupted.
    const recorded = site.store.raw
      .prepare('UPDATE media_uploads SET path=? WHERE id=? AND job_id=?')
      .run(destination, id, jobId);
    if (recorded.changes !== 1) throw new WeavaError('上传任务已变化，请重新读取上传状态。', 409);
    const record = site.store.raw
      .transaction(() => {
        if (find(site, id).job_id !== jobId)
          throw new WeavaError('上传任务已变化，请重新读取上传状态。', 409);
        const existing = site.store.get('media', prepared.id);
        const record =
          existing ?? site.store.put('media', prepared.id, prepared.value, null, '上传');
        site.store.raw
          .prepare("UPDATE media_uploads SET status='complete',path=? WHERE id=?")
          .run(destination, id);
        queueMediaOptimization(site, record.id);
        return record;
      })
      .immediate();
    void unlink(staging).catch(() => {});
    return record;
  } catch (error: any) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code))
      throw new WeavaError('文件暂时被占用，请稍后重试上传，已传送的文件会继续保留。', 409);
    if (error.code === 'ENOENT')
      throw new WeavaError('上传文件已不存在，请重新选择文件上传。', 410);
    throw error;
  }
}
