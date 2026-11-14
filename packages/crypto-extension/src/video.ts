import { response } from './http.ts';
export function videoRoute(videoSources: Record<string, any>) {
  const videoCache = new Map<string, { url: string; until: number }>();
  return async (url: URL) => {
    const path = url.pathname;
    if (path.startsWith('/video/')) {
      const key = decodeURIComponent(path.slice(7)),
        item = videoSources[key];
      if (!item) return response({ error: '视频不存在。' }, 404);
      try {
        let cached = videoCache.get(key);
        if (!cached || cached.until < Date.now() || url.searchParams.has('refresh')) {
          const base =
            item.platform === 'binance' ? 'https://app.notion.com' : 'https://www.notion.so';
          const res = await fetch(base + '/api/v3/getSignedFileUrls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              urls: [
                { url: item.fileLocator, permissionRecord: { table: 'block', id: item.blockId } },
              ],
            }),
            signal: AbortSignal.timeout(25000),
          });
          if (!res.ok) throw new Error('来源请求失败');
          const data: any = await res.json(),
            destination = new URL(data.signedUrls?.[0]);
          if (
            destination.protocol !== 'https:' ||
            ![
              'file.notion.com',
              'file.notion.so',
              'prod-files-secure.s3.us-west-2.amazonaws.com',
              's3.us-west-2.amazonaws.com',
            ].includes(destination.hostname)
          )
            throw new Error('来源地址无效');
          const expiration = Number(destination.searchParams.get('expirationTimestamp'));
          const expiry = expiration
            ? (expiration > 1e11 ? expiration : expiration * 1000) - 120000
            : Date.now() + 600000;
          cached = { url: destination.href, until: Math.min(Date.now() + 600000, expiry) };
          if (cached.until < Date.now()) throw new Error('来源地址已过期');
          videoCache.set(key, cached);
        }
        return new Response(null, {
          status: 302,
          headers: { Location: cached.url, 'Cache-Control': 'no-store' },
        });
      } catch {
        return response({ error: '原站视频暂时无法加载，请重试或打开原页面。' }, 502);
      }
    }
    return null;
  };
}
