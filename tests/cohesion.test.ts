import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { Site, uploadMedia, storageUsage, mediaReferences, planHistoryArchive } from '@weava/core';
import { cloneBlocks, entrySchema, publicationPlanInputSchema } from '@weava/contracts';
import { mediaReferencesIn } from '../packages/core/src/media-references.ts';
import { EditSession } from '../apps/admin/src/edit-session.ts';
import { createAdminDispatcher } from '../apps/web/src/api/dispatch.ts';
import { publicApi } from '../apps/web/src/api/public.ts';
import { validateExtensionResponse } from '../apps/web/src/api/transport.ts';
import type { AdminContext, ApiServices } from '../apps/web/src/api/types.ts';

let sequence = 0;
const sites: Site[] = [],
  base = 'D:/Tools/cache/weava/tests/cohesion-' + Date.now();
function fixture() {
  const site = new Site(join(base, String(sequence++)));
  sites.push(site);
  site.saveType(
    { id: 'post', label: '文章', pathPrefix: '/posts/', template: 'article', fields: [] },
    null,
  );
  return site;
}
afterEach(() => sites.splice(0).forEach((site) => site.close()));

it('preserves public analytics collection and contract validation for extension overrides', async () => {
  const site = fixture(),
    collect = vi.fn(() => ({ accepted: 1 }));
  const request = new Request('https://example.com/api/v1/analytics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [] }),
  });
  const context = {
    request,
    url: new URL(request.url),
    identity: { network: 'test', secure: true },
  } as unknown as AdminContext;
  const response = await publicApi(
    { site, analytics: { collect } } as unknown as ApiServices,
    context,
    'v1/analytics',
  );
  expect(await response!.json()).toEqual({ accepted: 1 });
  expect(collect).toHaveBeenCalledOnce();
  const malformed = await validateExtensionResponse(Response.json({ wrong: true }), 'rollback');
  expect(malformed.status).toBe(500);
  expect(
    (await validateExtensionResponse(Response.json({ releaseId: 'valid' }), 'rollback')).status,
  ).toBe(200);
});

it('uses one file identity across structured values, HTML, encoded paths and URL suffixes', () => {
  expect([
    ...mediaReferencesIn({
      cover: '/media/中文.txt?download=1#part',
      body: '<a href="/media/%E4%B8%AD%E6%96%87.txt#part">附件</a>',
    }),
  ]).toEqual(['/media/%E4%B8%AD%E6%96%87.txt']);
  expect([...mediaReferencesIn('<img src="/media/a.png?width=10&amp;format=webp">')]).toEqual([
    '/media/a.png',
  ]);
  expect([...mediaReferencesIn('/media/../invalid.txt')]).toEqual([]);
});

it('does not call a published attachment unreferenced when its link has query parameters', async () => {
  const site = fixture(),
    media = await uploadMedia(site, Buffer.from('referenced file'), 'download.txt');
  site.saveEntry(
    entrySchema.parse({
      id: 'download',
      kind: 'content',
      title: '下载',
      path: '/download/',
      status: 'published',
      document: {
        version: 1,
        format: 'html',
        source: `<a href="${media.value.url}?download=1#part">下载</a>`,
      },
    }),
    null,
  );
  site.publish();
  const references = mediaReferences(site, media.id);
  expect(references.working.map((row) => row.id)).toEqual(['download']);
  expect(references.published.map((row) => row.id)).toEqual(['download']);
  expect(storageUsage(site).unreferenced.files).not.toContainEqual(
    expect.objectContaining({ path: media.value.url }),
  );
});

it('preserves canonical private media identities when moving old revisions into history archives', async () => {
  const site = fixture(),
    media = await uploadMedia(site, Buffer.from('private history file'), 'private.txt');
  let row = site.saveEntry(
    entrySchema.parse({
      id: 'private',
      kind: 'content',
      title: 'Private',
      path: '/private/',
      visibility: 'private',
      document: {
        version: 1,
        format: 'html',
        source: `<a href="${media.value.url}?download=1">file</a>`,
      },
    }),
    null,
  );
  row = site.saveEntry(
    { ...row.value, title: 'Second', document: { version: 1, format: 'markdown', source: '' } },
    row.revision,
  );
  site.saveEntry({ ...row.value, title: 'Third' }, row.revision);
  expect(
    planHistoryArchive(site, { before: '2099-01-01', keepReleases: 1, keepRevisions: 1 })
      .privateMedia,
  ).toContain(media.value.url);
  expect(site.isPrivateMedia(media.value.url)).toBe(true);
});

it('copies nested blocks without reusing identities or mutating values and bindings', () => {
  const source = [
    {
      id: 'parent',
      type: 'columns',
      props: { columns: 2 },
      children: [
        {
          id: 'child',
          type: 'text',
          props: { text: 'Original' },
          bindings: { text: { source: 'field' as const, key: 'description' } },
        },
      ],
    },
  ];
  const copied = cloneBlocks(source);
  copied[0].children![0].props.text = 'Changed';
  expect(copied[0].id).not.toBe('parent');
  expect(copied[0].children![0].id).not.toBe('child');
  expect(source[0].children[0].props.text).toBe('Original');
  expect(copied[0].children![0].bindings).toEqual(source[0].children[0].bindings);
  expect(
    publicationPlanInputSchema.safeParse({
      id: 'plan',
      name: 'Plan',
      actions: [{ id: 'entry', action: 'publish', revision: 0 }],
    }).success,
  ).toBe(false);
});

it('does not apply a late save or its acknowledgement to a different editing session', async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve)),
    acknowledged: string[] = [];
  const first = { id: 'first', revision: 1, value: { title: 'Original' } };
  const session = new EditSession(
    first,
    async (row) => {
      await gate;
      return { ...row, revision: 2 };
    },
    () => {},
    undefined,
    '',
    (row) => acknowledged.push(row.id),
  );
  session.change({ ...first, value: { title: 'Pending' } });
  const save = session.save();
  session.adopt({ id: 'second', revision: 8, value: { title: 'Other' } });
  finish();
  await save;
  expect(session.record).toMatchObject({ id: 'second', revision: 8, value: { title: 'Other' } });
  expect(session.dirty).toBe(false);
  expect(acknowledged).toEqual([]);
});

it('dispatches typed operations with one validation boundary and keeps rollback responses consistent with committed state', async () => {
  const site = fixture(),
    first = site.publish(),
    second = site.publish();
  const dispatch = createAdminDispatcher({ site } as ApiServices);
  const context = {
    url: new URL('http://localhost/api/admin/v1/rollback'),
    request: new Request('http://localhost'),
    cookies: {},
  } as unknown as AdminContext;
  await expect(dispatch('saveEntry', {}, { value: {}, revision: null }, context)).rejects.toThrow();
  const response = await dispatch('rollback', {}, { id: first.id }, context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ releaseId: first.id });
  expect(site.release()?.id).toBe(first.id);
  expect(site.release()?.id).not.toBe(second.id);
});
