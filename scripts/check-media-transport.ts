import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';

export async function checkMediaTransport(origin: string, root: string, server: ChildProcess, baseline: boolean) {
  const size = 32 * 1024 * 1024;
  writeFileSync(join(root, 'media', 'range-audit.mp4'), Buffer.alloc(size, 97));
  let sequence = 0;
  const metrics = () => new Promise<any>((resolve, reject) => {
    const id = ++sequence;
    const listener = (message: any) => { if (message?.type === 'media-io' && message.id === id) { clearTimeout(timer); server.off('message', listener); resolve(message); } };
    const timer = setTimeout(() => { server.off('message', listener); reject(new Error('media I/O observer timeout')); }, 3000);
    server.on('message', listener); server.send({ type: 'media-io', id });
  });
  const before = await metrics(), started = performance.now();
  const range = async (value = 'bytes=1048576-1114111') => {
    const response = await fetch(origin + '/media/range-audit.mp4', { headers: { Range: value } });
    assert.equal(response.status, 206);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.length, value === 'bytes=-17' ? 17 : 65536);
    assert(bytes.every((value) => value === 97));
    return response;
  };
  const response = await range();
  assert.equal(response.headers.get('content-range'), `bytes 1048576-1114111/${size}`);
  const after = await metrics(), firstRequestMs = performance.now() - started;
  const parallelStart = performance.now();
  const health = Array.from({ length: 8 }, async () => {
    const started = performance.now(); assert((await fetch(origin + '/__health')).ok); return performance.now() - started;
  });
  await Promise.all(Array.from({ length: 8 }, () => range()));
  const healthMs = await Promise.all(health), parallel = await metrics();
  const result = { size, requestedBytes: 65536, actualSyncBytes: after.syncBytes - before.syncBytes,
    actualStreamBytes: after.streamBytes - before.streamBytes, firstRequestMs,
    parallelRequests: 8, parallelRequestedBytes: 8 * 65536, parallelReadBytes: parallel.syncBytes + parallel.streamBytes - after.syncBytes - after.streamBytes,
    parallelMs: performance.now() - parallelStart, healthMaxMs: Math.max(...healthMs), rssBefore: before.memory.rss, rssAfter: parallel.memory.rss,
    bounded: after.syncBytes - before.syncBytes === 0 && after.streamBytes - before.streamBytes === 65536 };
  if (!baseline) {
    assert(result.bounded, JSON.stringify(result));
    assert.equal(result.parallelReadBytes, result.parallelRequestedBytes);
    await range('bytes=-17');
    for (const value of ['bytes=999999999-', 'bytes=-0', 'bytes=3-1', 'bytes=1-2,4-5']) {
      const invalid = await fetch(origin + '/media/range-audit.mp4', { headers: { Range: value } });
      assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), `bytes */${size}`);
      await invalid.arrayBuffer();
    }
    const beforeHead = await metrics();
    const head = await fetch(origin + '/media/range-audit.mp4', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(size));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const afterHead = await metrics();
    assert.equal(afterHead.syncBytes + afterHead.streamBytes, beforeHead.syncBytes + beforeHead.streamBytes);
    const full = await fetch(origin + '/media/range-audit.mp4');
    assert.equal((await full.arrayBuffer()).byteLength, size);
    const controller = new AbortController();
    const cancelled = await fetch(origin + '/media/range-audit.mp4', { signal: controller.signal });
    await cancelled.body!.getReader().read(); controller.abort();
    for (let i = 0; i < 20 && (await metrics()).streams; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await metrics()).streams, 0, 'cancelled response must close its file stream');
  }
  return result;
}
