import { BoundedCache } from './cache.ts';
import { createHash } from 'node:crypto';
interface CacheKey { id:string; generation:string; seconds:number; headers:Headers }
interface CachedResponse { body:string; headers:[string,string][]; expires:number; vary:[string,string|null][]; bytes:number }

/** Short-lived anonymous responses only; each public release owns a separate generation. */
export class PublicResponseCache {
  private generation = '';
  private entries = new BoundedCache<string, CachedResponse[]>(64, 16 * 1024 * 1024);
  key(request: Request, generation: string, htmlSeconds = 0) {
    if (!generation || !['GET', 'HEAD'].includes(request.method) || request.headers.has('cookie') || request.headers.has('authorization')) return null;
    const url = new URL(request.url);
    const document = ['/sitemap.xml', '/robots.txt', '/rss.xml'].includes(url.pathname);
    if (!document && (!htmlSeconds || /^\/(?:api|admin|media|site-assets|_|__)/.test(url.pathname))) return null;
    if (generation !== this.generation) { this.entries.clear(); this.generation = generation; }
    return { id: url.protocol + '//' + (request.headers.get('host') ?? url.host) + url.pathname + url.search, generation, seconds: document ? 60 : Math.min(60, Math.max(0, htmlSeconds)),headers:new Headers(request.headers) };
  }
  get(key: CacheKey | null, clock = Date.now()) {
    if (!key || key.generation !== this.generation) return null;
    const value = this.entries.get(key.id)?.find(value=>value.expires>clock&&value.vary.every(([name,expected])=>key.headers.get(name)===expected));
    if (!value) return null;
    return new Response(value.body, { headers: value.headers });
  }
  async remember(key: CacheKey | null, response: Response, clock = Date.now()) {
    if (!key || response.status !== 200 || response.headers.has('set-cookie') || response.headers.has('content-encoding') || /private|no-store/i.test(response.headers.get('cache-control') ?? '') || !/html|xml|text\/plain/i.test(response.headers.get('content-type') ?? '')) return;
    const names=[...new Set((response.headers.get('vary')??'').toLowerCase().split(',').map(name=>name.trim()).filter(Boolean))].sort();
    if(names.includes('*')){this.entries.delete(key.id);return;}
    const vary:[string,string|null][]=names.map(name=>[name,key.headers.get(name)]);
    const reader = response.clone().body?.getReader(); if (!reader) return;
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) { void reader.cancel(); return; }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (key.generation === this.generation) {
      const signature=JSON.stringify(vary),policy=JSON.stringify(names);
      const variants=(this.entries.get(key.id)??[]).filter(value=>value.expires>clock&&JSON.stringify(value.vary.map(([name])=>name))===policy&&JSON.stringify(value.vary)!==signature).slice(-7);
      variants.push({body,headers:[...response.headers],expires:clock+key.seconds*1000,vary,bytes:bytes*2});
      this.entries.set(key.id,variants,variants.reduce((sum,value)=>sum+value.bytes,0));
    }
  }
}

export function conditionalPublicResponse(request: Request, response: Response, body: string) {
  const etag = 'W/"' + createHash('sha256').update(body).digest('base64url') + '"';
  response.headers.set('ETag', etag);
  const matches = (request.headers.get('if-none-match') ?? '').split(',').some(value => value.trim().replace(/^W\//, '') === etag.slice(2) || value.trim() === '*');
  return matches ? new Response(null, { status: 304, headers: response.headers }) : request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
}
