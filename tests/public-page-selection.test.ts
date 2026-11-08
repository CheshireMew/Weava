import { entrySchema } from '@weava/contracts';
import { Site } from '@weava/core';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { publicDocumentResponse } from '../apps/web/src/public-documents.ts';
import { selectPublicPage } from '../packages/core/src/public-page-selection.ts';
it('selects saved preview revisions while keeping public pages and system feeds on the release', async () => {
  const site = new Site(
    join(
      process.env.WEAVA_TEST_OUTPUT ?? 'D:/Tools/cache/weava/tests',
      'page-selection-' + randomUUID(),
    ),
  );
  const url = (path: string) => new URL(path, 'https://example.com');
  try {
    site.saveType(
      { id: 'post', label: 'Article', fields: [], pathPrefix: '/', template: 'article' },
      null,
    );
    const first = site.saveEntry(
      entrySchema.parse({
        id: 'article',
        kind: 'content',
        type: 'post',
        title: 'Published',
        path: '/article/',
        status: 'published',
        document: { version: 1, format: 'markdown', source: 'First body' },
      }),
      null,
    );
    expect(() => selectPublicPage(site, url('/__preview/article'), false)).toThrow('请先登录');
    expect(selectPublicPage(site, url('/__preview/article'), true).entry?.title).toBe('Published');
    site.publish();
    const privateRow = site.saveEntry(
      entrySchema.parse({
        id: 'private',
        kind: 'content',
        type: 'post',
        title: 'Private',
        path: '/private/',
        status: 'published',
        visibility: 'private',
        document: { version: 1, format: 'markdown', source: 'Private body' },
      }),
      null,
    );
    site.publish({ ids: [privateRow.id] });
    site.saveEntry({ ...first.value, title: 'Draft edit' }, first.revision);
    expect(selectPublicPage(site, url('/article/'), false).entry?.title).toBe('Published');
    expect(selectPublicPage(site, url('/__preview/article'), true).entry?.title).toBe('Draft edit');
    expect(
      selectPublicPage(site, url('/__preview/article?revision=' + first.revision), true).entry
        ?.title,
    ).toBe('Published');
    expect(() => selectPublicPage(site, url('/__preview/article?revision=999999'), true)).toThrow(
      '草稿修订不存在',
    );
    expect(selectPublicPage(site, url('/private/'), false).entry).toBeUndefined();
    expect(selectPublicPage(site, url('/private/'), true).entry?.id).toBe('private');
    const feed = selectPublicPage(site, url('/rss.xml'), true);
    const response = publicDocumentResponse(feed.release, url('/rss.xml'))!;
    const xml = await response.text();
    expect(xml).toContain('Published');
    expect(xml).not.toContain('Draft edit');
    expect(xml).not.toContain('Private');
    expect(site.store.get('entry', 'article')?.value.title).toBe('Draft edit');
  } finally {
    site.close();
  }
});
