import { existsSync, readFileSync } from 'node:fs';
import { WeavaError } from '@weava/contracts';
import { importFileBytes, isMarkdownImportFile, markdownImportFileBytes } from '../../contracts/src/import-limits.ts';
import type { Site } from './site.ts';
import { spoolRequest, temporaryPath } from './temporary-files.ts';
import type { JobRunner } from './job-runner.ts';
import { EntryWorkspace, StagedEntries } from './staged-entries.ts';
import { parseWxrSource } from './wordpress-wxr-conversion.ts';
import { importPreparedWordPress, type PreparedWxr } from './wordpress-wxr.ts';
import { importSite, type SiteExchange } from './exchange.ts';
import { exchange, entrySchema, settingsSchema } from '../../contracts/src/api-models.ts';
import type { WxrOptions } from './wordpress-wxr-options.ts';
import { digest } from '../../runtime-common/src/identity.ts';

export interface ImportSource { id: string; name: string; format: 'json' | 'wxr' | 'markdown'; bytes: number; path: string; sha256: string; expiresAt: string }
type SourceOptions = WxrOptions & { markdownReview?: string };
const key = (id: string) => 'import-source:' + id;
export async function stageImportSource(site: Site, request: Request, name: string) {
  const format=isMarkdownImportFile(name)?'markdown':/\.xml$/i.test(name)?'wxr':/\.json$/i.test(name)?'json':null;
  if (!format || name.length > 300 || /[\\/:\u0000-\u001f]/.test(name)) throw new WeavaError('请选择 Weava JSON、WordPress XML 或 Markdown 文件。');
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/octet-stream') throw new WeavaError('导入文件需要二进制内容。', 415);
  const staged = await spoolRequest(site, request, 'import-source', format==='markdown'?markdownImportFileBytes:importFileBytes);
  const row = site.store.raw.prepare('SELECT bytes,expires FROM staged_requests WHERE id=?').get(staged.id) as {bytes:number;expires:number};
  if (!row.bytes) { site.store.raw.prepare('UPDATE staged_requests SET expires=0 WHERE id=?').run(staged.id); throw new WeavaError('导入文件为空。'); }
  const source: ImportSource = { ...staged, name, format, bytes: row.bytes, expiresAt: new Date(row.expires).toISOString() };
  site.store.setState(key(staged.id), JSON.stringify(source));
  return source;
}
export function importSource(site: Site, id: string): ImportSource {
  const encoded = site.store.state(key(id));
  const row = site.store.raw.prepare("SELECT * FROM staged_requests WHERE id=? AND kind='import-source'").get(id) as {path:string;expires:number} | undefined;
  if (!encoded || !row || row.expires <= Date.now() || !existsSync(temporaryPath(site, row.path))) throw new WeavaError('导入文件已过期或被清理，请重新选择。', 410);
  return JSON.parse(encoded);
}
export function renewImportSource(site: Site, id: string) {
  const source = importSource(site, id);
  const expires = Date.now() + 86400000;
  site.store.raw.prepare('UPDATE staged_requests SET expires=? WHERE id=?').run(expires, id);
  source.expiresAt = new Date(expires).toISOString(); site.store.setState(key(id), JSON.stringify(source));
  return source;
}

export function queueImportSource(site: Site, jobs: Pick<JobRunner,'enqueue'>, sourceId: string, options: SourceOptions, idempotency?: string) {
  const source = renewImportSource(site, sourceId);
  const operation = source.format === 'wxr' ? options.dryRun ? 'preflight-wxr' : 'import-wxr' : 'import-source';
  return jobs.enqueue(operation, { sourceId, options }, idempotency);
}
interface PreparedSource {
  id: string; root: string; workspace: EntryWorkspace;
  wxr?: PreparedWxr; value?: SiteExchange; basis?: string;
}
let prepared: PreparedSource | undefined;
export function closePreparedImports() { prepared?.workspace.close(); prepared = undefined; }
function preparedSource(site: Site, source: ImportSource) {
  if (prepared?.id === source.id && prepared.root === site.root) return prepared;
  closePreparedImports();
  const workspace = new EntryWorkspace(site.root);
  try {
    const next: PreparedSource = { id: source.id, root: site.root, workspace };
    const file = temporaryPath(site, source.path);
    if (source.format === 'wxr') next.wxr = { workspace, parsed: parseWxrSource({file,sha256:source.sha256},workspace) };
    else {
      let raw: any;
      try { raw = JSON.parse(readFileSync(file,'utf8').replace(/^\ufeff/,'')); }
      catch { throw new WeavaError('这个文件不是有效的 JSON。请选择 Weava 导出的内容文件。'); }
      const metadata = exchange.omit({entries:true,settings:true}).safeParse(raw);
      if (!metadata.success || raw.entries !== undefined && !Array.isArray(raw.entries))
        throw new WeavaError('导出文件中的内容格式不正确。',400,metadata.success?undefined:metadata.error.issues);
      const entries = new StagedEntries(workspace);
      for (let index=0;index<(raw.entries?.length??0);index++) {
        const parsed = entrySchema.safeParse(raw.entries[index]);
        if (!parsed.success) throw new WeavaError('导出文件中的内容格式不正确。',400,parsed.error.issues.map(issue=>({...issue,path:['entries',index,...issue.path]})));
        entries.append(parsed.data); raw.entries[index] = null;
      }
      next.value = {...metadata.data,entries,...(raw.settings!==undefined?{settings:raw.settings}:{})}; raw=undefined;
    }
    prepared = next; return next;
  } catch (error) { workspace.close(); throw error; }
}
/** Reuse the parsed source between preview and commit; current-state domain checks remain. */
export async function executeImportSource(site: Site, sourceId: string, options: SourceOptions, progress: (message:string)=>void=()=>{}, committed?:(result:any)=>void) {
  const source = importSource(site, sourceId);
  progress(options.dryRun?'正在预检已上传的内容…':'正在导入已上传的内容…');
  if (source.format==='markdown') {
    const {importSelectedMarkdown}=await import('./markdown-folder.ts');
    const describe=(result:object)=>({...result,format:'markdown' as const,sourceId});
    const selected={name:source.name,file:temporaryPath(site,source.path)};
    return {...importSelectedMarkdown(site,selected,options,result=>committed?.(describe(result))),format:'markdown' as const,sourceId};
  }
  const cached = preparedSource(site,source);
  if (cached.wxr) {
    const basis = digest({ options:{...options,dryRun:undefined,review:undefined},revision:site.store.raw.prepare('SELECT MAX(revision) n FROM revisions').get(),release:site.store.state('release') });
    if (cached.basis !== basis) { cached.workspace.reset('entry'); cached.wxr.converted=undefined;cached.wxr.preview=undefined; cached.basis=basis; }
    const result = await importPreparedWordPress(site,{file:temporaryPath(site,source.path),sha256:source.sha256},options,progress,cached.wxr,result=>committed?.({...result,format:'wxr',sourceId}));
    if (!options.dryRun) { cached.wxr.converted=undefined;cached.wxr.preview=undefined;cached.basis=undefined; }
    return {...result,format:'wxr' as const,sourceId};
  }
  if(options.settings&&cached.value?.settings!==undefined){
    const settings=settingsSchema.safeParse(cached.value.settings);
    if(!settings.success)throw new WeavaError('导出文件中的网站设置格式不正确。',400,settings.error.issues.map(issue=>({...issue,path:['settings',...issue.path]})));
    cached.value.settings=settings.data;
  }
  const execute=()=>{
    const result=importSite(site,options.settings?cached.value!:{...cached.value!,settings:undefined},options);
    const report={...result,format:'json' as const,sourceId};
    if(!options.dryRun)committed?.(report);
    return report;
  };
  return options.dryRun?execute():site.store.raw.transaction(execute).immediate();
}
