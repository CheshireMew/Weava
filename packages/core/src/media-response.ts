import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

/** The caller owns media access checks and resolves the path inside the media root. */
export async function mediaResponse(file: string, request: Request, headers: Record<string, string>) {
  const info = await stat(file).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!info?.isFile()) return new Response('Not found', { status: 404 });
  const size = info.size;
  let start = 0, end = size - 1, status = 200;
  const range = request.method === 'HEAD' ? null : request.headers.get('range');
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    if (!match || (!match[1] && !match[2])) return invalid();
    const first = Number(match[1]), last = Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return invalid();
    if (match[1]) {
      start = first;
      end = match[2] ? Math.min(last, size - 1) : size - 1;
    } else {
      if (last === 0) return invalid();
      start = Math.max(0, size - last);
    }
    if (start > end || start >= size) return invalid();
    status = 206;
  }
  const responseHeaders = { ...headers, 'Content-Length': String(Math.max(0, end - start + 1)),
    ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) };
  if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers: responseHeaders });
  const stream = createReadStream(file, { start, end, signal: request.signal });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers: responseHeaders });
}
