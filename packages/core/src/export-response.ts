import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { Site } from './site.ts';

/** A separate WAL read snapshot stays consistent while the editor keeps saving. */
export function exportResponse(site: Site, attachment = false) {
  const db = new Database(join(site.root, 'weava.sqlite'), { readonly: true, fileMustExist: true });
  db.exec('BEGIN');
  // Establish the snapshot before handing the asynchronous body to the HTTP server.
  db.prepare('SELECT COUNT(*) FROM records').get();
  function* json(): Generator<string> {
    yield '{"version":1';
    const settings = db.prepare("SELECT data FROM records WHERE scope='settings' AND id='site'").get() as { data: string } | undefined;
    if (settings) yield ',"settings":' + settings.data;
    for (const [key, scope] of [['types','type'],['entries','entry'],['terms','term'],['layouts','layout'],['contentViews','content-view'],['creationTemplates','creation-template'],['writingSnippets','writing-snippet']] as const) {
      yield ',"' + key + '":[';
      let first = true;
      for (const row of db.prepare('SELECT data FROM records WHERE scope=? ORDER BY rowid').iterate(scope) as Iterable<{data:string}>) {
        if (!first) yield ','; first = false; yield row.data;
      }
      yield ']';
    }
    yield ',"redirects":{';
    let first = true;
    for (const row of db.prepare("SELECT id,data FROM records WHERE scope='redirect' ORDER BY rowid").iterate() as Iterable<{id:string;data:string}>) {
      if (!first) yield ','; first = false; yield JSON.stringify(row.id) + ':' + row.data;
    }
    yield '}}';
  }
  const fragments = json(), encoder = new TextEncoder();
  let remainder = '', closed = false;
  const close = () => { if (!closed) { closed = true; fragments.return(undefined); db.close(); } };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      try {
        while (remainder.length < 32768) { const next = fragments.next(); if (next.done) break; remainder += next.value; }
        if (!remainder) { close(); controller.close(); return; }
        // Avoid cutting a UTF-16 surrogate pair between UTF-8 chunks.
        let end = Math.min(32768, remainder.length);
        if (end < remainder.length && /[\uD800-\uDBFF]/.test(remainder[end - 1])) end--;
        controller.enqueue(encoder.encode(remainder.slice(0, end))); remainder = remainder.slice(end);
      } catch (error) { close(); controller.error(error); }
    },
    cancel() { close(); },
  });
  return new Response(body, { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
    ...(attachment ? { 'Content-Disposition': 'attachment; filename="weava-site.json"' } : {}),
    'X-Weava-Stream': '1',
  } });
}
