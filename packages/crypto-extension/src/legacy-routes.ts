import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { response } from './http.ts';
export async function legacyRoute(root: string, analytics: any, request: Request, release: any) {
  const path = new URL(request.url).pathname;
  if (path === '/analytics/collect' && request.method === 'POST') {
    const payload: any = await request.json(),
      catalog = JSON.parse(
        readFileSync(join(root, 'themes/crypto/analytics-catalog.json'), 'utf8'),
      );
    const events = (payload.events ?? []).map((event: any) => {
      const link = catalog.articles?.[event.path]?.links?.[event.link] ?? {};
      return {
        ...event,
        kind: event.type,
        ts: new Date(event.ts).toISOString(),
        url: link.url ?? '',
        label: link.label ?? '',
        zone: link.zone ?? '',
        releaseId: release.id,
      };
    });
    analytics.collect(
      events,
      request.headers.get('user-agent') ?? '',
      new Set(release.entries.filter((e: any) => e.kind === 'content').map((e: any) => e.path)),
    );
    return response({ accepted: events.map((e: any) => e.id), rejected: [] });
  }
  if (path === '/search-index.json')
    return response(
      release.entries
        .filter((e: any) => e.kind === 'content')
        .map((e: any, i: number) => ({
          id: e.id,
          title: e.title,
          url: e.path,
          category: e.categories[0] ?? '',
          categoryName: e.categories[0] ?? '',
          kind: e.fields.kind ?? 'article',
          cover: e.cover,
          thumb: e.cover,
          text: load(e.html ?? '').text(),
          description: e.description,
          readMinutes: e.fields.readMinutes ?? 2,
          platform: e.fields.platform ?? 'general',
          service: e.fields.service ?? '',
          order: i,
        })),
    );
  return null;
}
