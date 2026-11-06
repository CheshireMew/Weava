/** Source-level performance audit. Creates synthetic instances only; retains all evidence.
 * Run: node --expose-gc --import tsx scripts/performance-audit.ts [section]
 * Sections: content, analytics, editor, jobs, assets, maintenance, all (default).
 * largefiles is an explicit, near-limit WXR run with --max-old-space-size=768.
 * This does not build/select a program, start a browser, or touch real instances.
 */
import { mkdirSync, writeFileSync, readFileSync, statSync, readdirSync,openSync,writeSync,closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { Site } from '../packages/core/src/site.ts';
import { Analytics } from '../packages/core/src/analytics.ts';
import { preparePublication, readPublicationCandidate } from '../packages/core/src/publication.ts';
import { storeRelease } from '../packages/core/src/publication-store.ts';
import { renderDocument } from '../packages/core/src/documents.ts';
import { renderEntryTemplate } from '../packages/core/src/render.ts';
import { queryPublished, queryDrafts } from '../packages/core/src/query.ts';
import { mediaReferences } from '../packages/core/src/media.ts';
import { mediaResponse } from '../packages/core/src/media-response.ts';
import { storageUsage } from '../packages/core/src/maintenance.ts';
import { JobRunner } from '../packages/core/src/job-runner.ts';
import { saveLocalDraft } from '../apps/admin/src/local-drafts.ts';
import { EditSession } from '../apps/admin/src/edit-session.ts';
import { entrySchema, type Release } from '../packages/contracts/src/index.ts';
import { digestFile } from '../packages/core/src/file-io.ts';
import { importWordPressWxr } from '../packages/core/src/wordpress-wxr.ts';
import { prepareReleaseStorage,writeReleaseStorage } from '../packages/core/src/publication-store.ts';

const framework = resolve(import.meta.dirname, '..');
const section = process.argv[2] ?? 'all';
const sections = ['content', 'analytics', 'editor', 'jobs', 'assets', 'maintenance','largefiles'];
if (section !== 'all' && !sections.includes(section)) throw new Error('Unknown audit section');
const root = join('D:/Tools/cache/weava/performance-audit', new Date().toISOString().replace(/[:.]/g, '-') + '-' + section);
mkdirSync(root, { recursive: true });
const report: any = { environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramGiB: totalmem() / 2 ** 30 }, root, sections: {} };
const checkpoint = () => writeFileSync(join(root, 'results.json'), JSON.stringify(report, null, 2));
function measure(action: () => unknown, count = 5, warmup = 1) {
  for (let i = 0; i < warmup; i++) action();
  const samples = Array.from({ length: count }, () => { const start = performance.now(); action(); return performance.now() - start; }).sort((a, b) => a - b);
  return { medianMs: samples[Math.floor(samples.length / 2)], maxMs: samples.at(-1), samplesMs: samples };
}
function fixture(name: string) {
  const site = new Site(join(root, name));
  site.saveType({ id: 'post', label: 'Post', fields: [], pathPrefix: '/posts/', template: 'article' }, null);
  return site;
}
const source = ('A paragraph for the performance audit with common search terms.\n\n').repeat(64);
function entry(i: number) {
  return entrySchema.parse({ id: 'entry-' + i, kind: 'content', type: 'post', title: 'Post ' + String(i).padStart(5, '0'), path: '/posts/' + i + '/', status: 'published',
    publishedAt: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(), document: { version: 1, format: 'markdown', source } });
}

if (section === 'all' || section === 'content') {
  const rows: any[] = [];
  report.sections.content = rows;
  for (const count of [100, 1000, 3000]) {
    const site = fixture('content-' + count);
    try {
      // Seed through storage/indexing in one transaction; measurement excludes fixture creation.
      site.store.raw.transaction(() => { for (let i = 0; i < count; i++) site.store.put('entry', 'entry-' + i, entry(i), null); })();
      const html = renderDocument(entry(0).document);
      const release: Release = { id: 'audit-release', createdAt: new Date().toISOString(), label: 'Synthetic audit', settings: site.settings().value, types: site.store.list('type').map(row => row.value), terms: [], redirects: {},
        entries: site.store.list('entry').map(row => ({ ...row.value, html, revisionId: row.revision })) };
      site.store.raw.transaction(() => { storeRelease(site.store.raw, release); site.store.setState('release', release.id); })();
      const row: any = { count, sourceBytes: Buffer.byteLength(source), releaseJsonBytes: Buffer.byteLength(JSON.stringify(release)) };
      row.coldRelease = measure(() => { (site.publication as any).releaseCache.clear(); site.release(); }, 3, 0);
      row.visibleRelease = measure(() => site.visibleRelease(), 50);
      row.fiveVisibleReads = measure(() => { for (let i = 0; i < 5; i++) site.visibleRelease(); }, 30);
      row.publicQuery = measure(() => queryPublished(site, { pageSize: 24 }));
      row.commonSearch = measure(() => queryPublished(site, { query: 'common', pageSize: 20 }, true));
      row.draftQuery = measure(() => queryDrafts(site, { kind: 'content', sort: 'title', pageSize: 25 }));
      row.renderArticle = measure(() => renderEntryTemplate(release.entries[0], release));
      row.prepareOneEntry = measure(() => preparePublication(site, { ids: ['entry-0'] }), 3, 0);
      row.reviewAndCandidateReuse = measure(() => { const review = site.previewPublication({ ids: ['entry-0'] }); readPublicationCandidate(site, review.options); }, 3, 0);
      row.prepareStorage=measure(()=>prepareReleaseStorage(site.store.raw,site.release()!),3,0);
      let sequence=0;
      const writeSamples:number[]=[];for(let i=0;i<3;i++){const value=prepareReleaseStorage(site.store.raw,{...site.release()!,id:'write-'+sequence++});const start=performance.now();site.store.raw.transaction(()=>writeReleaseStorage(site.store.raw,value)).immediate();writeSamples.push(performance.now()-start);}writeSamples.sort((a,b)=>a-b);row.publicationWrite={medianMs:writeSamples[1],maxMs:writeSamples.at(-1),samplesMs:writeSamples};
      const runner=new JobRunner(site,{startPaused:false,framework,source:true});
      try{
        let start=performance.now();await runner.query('publication-review',{ids:['entry-0']});row.reviewApiFirstMs=performance.now()-start;
        start=performance.now();await runner.query('publication-review',{ids:['entry-0']});row.reviewApiWarmMs=performance.now()-start;
      }finally{runner.stop();}
      site.store.put('media', 'audit-media', { name: 'audit.txt', url: '/media/audit.txt' }, null);
      row.mediaReferences = measure(() => mediaReferences(site, 'audit-media'), 3);
      row.databaseBytes = statSync(join(site.root, 'weava.sqlite')).size;
      rows.push(row); checkpoint(); console.log(JSON.stringify({ section: 'content', count, mediansMs: Object.fromEntries(Object.entries(row).filter(([, value]) => value && typeof value === 'object' && 'medianMs' in value).map(([key, value]) => [key, (value as any).medianMs])) }));
    } finally { site.close(); }
  }
}

if (section === 'all' || section === 'analytics') {
  const rows: any[] = []; report.sections.analytics = rows;
  for (const count of [10000, 100000]) {
    const site = fixture('analytics-' + count), analytics = new Analytics(site.root);
    try {
      const insert = analytics.raw.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      const context = analytics.raw.prepare('INSERT INTO event_context VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const activity = analytics.raw.prepare('INSERT INTO page_activity VALUES(?,?,0,0,1)');
      analytics.raw.transaction(() => { for (let i = 0; i < count; i++) {
        const id = 'event-' + i, at = new Date(Date.UTC(2026, 9, 1) + i % 60 * 86400000 + Math.floor(i / 60) * 1000).toISOString();
        insert.run(id, 'view', at, '/posts/' + i % 100 + '/', 'visitor-' + Math.floor(i / 3), 'session-' + Math.floor(i / 3), '', '', 'body', '', 'audit');
        context.run(id, 'CN', 'Chrome', 'Windows', 'desktop', 'PC', 'zh', 'direct', '', '', '', '', 1); activity.run(id, at);
      } })();
      const before = process.memoryUsage();
      const row: any = { count };
      row.report = measure(() => { const data = analytics.report(new URLSearchParams({ start: '2026-10-31', end: '2026-11-29' }), 'Asia/Shanghai'); if (data.lifetime.views !== count) throw new Error('Analytics fixture count mismatch'); }, 3, 0);
      row.singleDayReport = measure(() => analytics.report(new URLSearchParams({ start: '2026-11-02', end: '2026-11-02' }), 'Asia/Shanghai'), 3, 0);
      row.memoryBeforeMiB = { rss: before.rss / 2 ** 20, heapUsed: before.heapUsed / 2 ** 20 };
      const after = process.memoryUsage(); row.memoryAfterMiB = { rss: after.rss / 2 ** 20, heapUsed: after.heapUsed / 2 ** 20 };
      row.note = 'Memory is process snapshot after calls, not peak and not isolated-worker memory.';
      rows.push(row); checkpoint(); console.log(JSON.stringify({ section: 'analytics', ...row }));
    } finally { analytics.close(); site.close(); }
  }
}

if (section === 'all' || section === 'maintenance') {
  const rows: any[] = []; report.sections.maintenance = rows;
  for (const count of [1000, 10000]) {
    const site = fixture('history-' + count);
    try {
      const value = entry(0);
      site.store.put('entry', value.id, value, null);
      site.store.put('media', 'audit-media', { name: 'audit.txt', url: '/media/audit.txt' }, null);
      const insert = site.store.raw.prepare('INSERT INTO revisions(scope,id,data,created_at,label) VALUES(?,?,?,?,?)');
      site.store.raw.transaction(() => { for (let i = 1; i < count; i++) insert.run('entry', value.id, JSON.stringify({ ...value, title: 'Revision ' + i }), new Date().toISOString(), 'Audit revision'); })();
      const row = { revisions: count, mediaReferences: measure(() => mediaReferences(site, 'audit-media'), 3), storageUsage: measure(() => storageUsage(site), 3) };
      rows.push(row); checkpoint(); console.log(JSON.stringify({ section: 'maintenance', ...row }));
    } finally { site.close(); }
  }
}

if (section === 'all' || section === 'editor') {
  const rows: any[] = []; report.sections.editor = rows;
  for (const chars of [10000, 100000, 500000]) {
    const values = new Map<string, string>();
    let writtenChars = 0, writes = 0;
    // Isolate cloning/JSON costs; Map deliberately excludes actual browser localStorage latency.
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); writtenChars += value.length; writes++; }, removeItem: (key: string) => { values.delete(key); } };
    const record = { id: 'draft', revision: 1, updatedAt: '', value: { ...entry(0), document: { version: 1 as const, format: 'markdown' as const, source: 'x'.repeat(chars) } } };
    const session = new EditSession(record, async row => row, () => {});
    let clock = Date.now();
    const row = { chars, keystrokeCore: measure(() => {
      const next = { ...record, value: { ...record.value, title: String(clock++) } };
      session.change(next); if (!session.dirty) throw new Error('Expected modified draft');
    },30),legacyKeystrokeWithLocalArchive:measure(() => {
      const next = { ...record, value: { ...record.value, title: String(clock++) } };
      session.change(next); if (!session.dirty) throw new Error('Expected modified draft'); saveLocalDraft(next, storage, clock);
    }, 30), legacyWrites:writes, legacyWrittenChars:writtenChars, storedChars: values.get('weava-drafts:v2')?.length, synchronousDraftWritesPerKeystroke:0,note:'Core cost only; async IndexedDB commits are debounced. This is not a browser input-latency measurement.' };
    rows.push(row); console.log(JSON.stringify({ section: 'editor', ...row }));
  }
  const file = join(root, 'audit-media.txt'); writeFileSync(file, 'conditional-cache-audit');
  const response = await mediaResponse(file, new Request('http://localhost/media/audit.txt', { headers: { 'If-None-Match': '*', 'If-Modified-Since': new Date(Date.now() + 60000).toUTCString() } }), { 'Content-Type': 'text/plain' });
  report.sections.mediaConditionalRequest = { status: response.status, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), returnedBytes: (await response.arrayBuffer()).byteLength };
  checkpoint();
}

if (section === 'all' || section === 'jobs') {
  const rows: any[] = []; report.sections.jobs = rows;
  for (const count of [100, 10000, 100000]) {
    const site = fixture('jobs-' + count);
    try {
      const insert = site.store.raw.prepare('INSERT INTO jobs VALUES(?,?,?,?,NULL)');
      site.store.raw.transaction(() => { for (let i = 0; i < count; i++) insert.run('job-' + i, 'analytics-realtime', 'complete', JSON.stringify({ id: 'job-' + i, status: 'complete', result: { count: 0 } })); })();
      const runner = new JobRunner(site,{startPaused:false, framework, source: true });
      try {
        const row: any = { count, pump: measure(() => runner.pump(), 50), activeJobs: measure(() => site.activeJobs(), 30), plan: site.store.raw.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM jobs WHERE status='running'").all() };
        if (count === 100) {
          const before=(site.store.raw.prepare('SELECT COUNT(*) n FROM jobs').get() as any).n;
          let start = performance.now();await runner.query('analytics-realtime',{query:''});row.sourceWorkerRoundTripMs=performance.now()-start;
          start=performance.now();for(let i=0;i<10;i++)await runner.query('analytics-realtime',{query:''});row.warmQueryAverageMs=(performance.now()-start)/10;
          row.queryDurableJobsAdded=(site.store.raw.prepare('SELECT COUNT(*) n FROM jobs').get() as any).n-before;
        }
        rows.push(row); console.log(JSON.stringify({ section: 'jobs', ...row })); checkpoint();
      } finally { runner.stop(); }
    } finally { site.close(); }
  }
}

if (section === 'all' || section === 'assets') {
  // Analyze compilation entirely in memory. This is a dependency graph estimate, not Vite production output.
  const bundle = await build({ entryPoints: [join(framework, 'apps/admin/src/main.tsx')], outdir: join(root, 'virtual-output'), bundle: true, splitting: true, format: 'esm', platform: 'browser', minify: true, metafile: true, write: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' } });
  const outputs = bundle.metafile!.outputs;
  const main = Object.entries(outputs).find(([, value]) => value.entryPoint?.endsWith('src/main.tsx'))!;
  const reachable = new Set<string>();
  const visit = (path: string) => { if (reachable.has(path)) return; reachable.add(path); for (const item of outputs[path]?.imports ?? []) if (item.kind !== 'dynamic-import') visit(item.path); };
  visit(main[0]);
  const initial = bundle.outputFiles!.filter(file => [...reachable].some(path => resolve(framework, path) === file.path));
  const contributions = new Map<string, number>();
  for (const path of reachable) for (const [input, value] of Object.entries(outputs[path]?.inputs ?? {})) contributions.set(input, (contributions.get(input) ?? 0) + value.bytesInOutput);
  report.sections.assets = { method: 'esbuild in-memory, eager static dependency closure, no Vite build or program selection', totalJsBytes: bundle.outputFiles!.filter(file => file.path.endsWith('.js')).reduce((sum, file) => sum + file.contents.length, 0), initialJsBytes: initial.filter(file => file.path.endsWith('.js')).reduce((sum, file) => sum + file.contents.length, 0), initialJsGzipBytes: initial.filter(file => file.path.endsWith('.js')).reduce((sum, file) => sum + gzipSync(file.contents).length, 0), initialInputs: [...contributions.keys()], initialInputContributions: [...contributions].map(([input, bytes]) => ({ input, bytes })).sort((a, b) => b.bytes - a.bytes), chunks: bundle.outputFiles!.map(file => ({ file: file.path.split(/[\\/]/).at(-1), bytes: file.contents.length, gzipBytes: gzipSync(file.contents).length })) };
  const selected = JSON.parse(readFileSync(join(framework, 'dist/current.json'), 'utf8'));
  report.sections.selectedExistingAssets = { root: selected.root, note: 'Existing selected build; may predate current working tree. Read-only size inventory.', files: readdirSync(join(selected.root, 'admin/assets')).map(name => { const file = join(selected.root, 'admin/assets', name), bytes = readFileSync(file); return { name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length }; }).sort((a, b) => b.bytes - a.bytes).slice(0, 12) };
  checkpoint(); console.log(JSON.stringify({ section: 'assets', ...report.sections.assets, initialInputs: undefined, initialInputContributions: undefined, chunks: undefined }));
}
if(section==='largefiles'){
  const site=fixture('large-wxr'),file=join(root,'large.xml'),fd=openSync(file,'w'),count=1000,body='<p>'+('Streaming source text '.repeat(6000))+'</p>';
  try{writeSync(fd,'<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Large fixture</title><link>https://example.com/</link><wp:wxr_version>1.2</wp:wxr_version>');
    for(let i=0;i<count;i++)writeSync(fd,`<item><title>Post ${i}</title><link>https://example.com/posts/${i}/</link><wp:post_id>${i+1}</wp:post_id><wp:post_type>post</wp:post_type><wp:post_name>${i}</wp:post_name><wp:status>publish</wp:status><content:encoded><![CDATA[${body}]]></content:encoded></item>`);
    writeSync(fd,'</channel></rss>');
  }finally{closeSync(fd);}
  try{const before=process.memoryUsage(),start=performance.now(),result=await importWordPressWxr(site,{file},{dryRun:true});
    if(result.entries!==count)throw new Error('WXR fixture count mismatch');
    report.sections.largefiles={entries:result.entries,inputBytes:statSync(file).size,preflightMs:performance.now()-start,heapLimitNote:'Run this section alone with --max-old-space-size=768; completion validates that heap cap.',memoryBefore:before,memoryAfter:process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS,hash:measure(()=>digestFile(file),3,0),workspaceFiles:readdirSync(join(site.root,'cache','wxr')).map(name=>({name,bytes:statSync(join(site.root,'cache','wxr',name)).size}))};checkpoint();console.log(JSON.stringify({section:'largefiles',...report.sections.largefiles}));
  }finally{site.close();}
}
checkpoint(); console.log('Evidence: ' + join(root, 'results.json'));
