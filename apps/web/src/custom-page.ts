import type { PublishedEntry, Release } from '@weava/contracts';
import { composeMetadata } from '@weava/core';
import { contextFor, features, siteExtension, siteRenderer } from './runtime.ts';
export async function customPageResponse(
  request: Request,
  url: URL,
  release: Release,
  entry: PublishedEntry | undefined,
  preview: boolean,
) {
  const privateArticle = entry?.visibility === 'private';
  if (preview && entry) {
    const renderer = await siteRenderer;
    if (renderer) {
      const previewRequest = new Request(new URL(entry.path, url.origin), request);
      const response = await renderer.render(
        previewRequest,
        contextFor(previewRequest, true, entry),
      );
      if (response) {
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('X-Robots-Tag', 'noindex,nofollow');
        return response;
      }
    }
  }
  if (entry) {
    const custom = await (await siteExtension)?.render?.(entry, release);
    if (custom) {
      const metadata = await (
        await siteExtension
      ).metadata(entry, release, url, { preview, html: custom });
      const html = composeMetadata(custom, metadata, {
        preview,
        embedded: url.searchParams.get('embedded') === '1',
        track: features.includes('analytics') && !preview && !privateArticle,
        releaseId: release.id,
      });
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...(preview
            ? {
                'Content-Security-Policy':
                  "script-src 'none'; connect-src 'none'; object-src 'none'",
              }
            : {}),
          ...(preview || privateArticle
            ? { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
            : {}),
        },
      });
    }
  }
}
