import { it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Site } from '@weava/core';
import { migrateCrypto } from '../packages/core/src/migrate.ts';
import { convertCryptoSite } from '../packages/crypto-migration/src/convert.ts';
import { SiteReleases } from '../packages/core/src/site-releases.ts';
it('reuses imported identities and reports target edits without overwriting them', async () => {
  const base =
      (process.env.WEAVA_TEST_OUTPUT ?? 'D:/Tools/cache/weava/tests') + '/migration-' + Date.now(),
    source = join(base, 'source'),
    target = join(base, 'target'),
    capture = join(base, 'capture');
  for (const path of ['source/content/posts', 'capture/site/guides/test'])
    mkdirSync(join(base, path), { recursive: true });
  writeFileSync(
    join(source, 'site.config.json'),
    JSON.stringify({ name: '参考站', domain: 'https://example.com', language: 'zh-CN' }),
  );
  writeFileSync(
    join(source, 'content/posts/test.md'),
    '---\nid: test\nslug: test\ntitle: 原始标题\ndescription: 说明\nauthor: 作者\ncategory: 测试\nstatus: published\n---\n\n原始正文',
  );
  const html =
    '<html><head><title>参考站</title></head><body><nav id="main-nav"><a href="/">首页</a></nav><main><h1>参考页面</h1><article class="article-body"><p>原始正文</p></article></main></body></html>';
  writeFileSync(join(capture, 'site/index.html'), html);
  writeFileSync(join(capture, 'site/guides/test/index.html'), html);
  writeFileSync(join(capture, 'site/equity-catalog.json'), '{}');
  writeFileSync(
    join(capture, 'catalog.json'),
    JSON.stringify({
      pages: [{ id: 'test', url: '/guides/test/', title: '原始标题', category: '测试' }],
      categories: [],
      hidden: [],
    }),
  );
  await migrateCrypto(source, target, capture);
  expect(readFileSync(join(target, 'extensions/index.ts'), 'utf8')).toContain(
    './crypto-src/legacy.ts',
  );
  expect(existsSync(join(target, 'extensions/crypto-src/refresh.ts'))).toBe(true);
  expect(existsSync(join(target, 'extensions/crypto-src/routes.ts'))).toBe(true);
  const initial = new Site(target),
    release = initial.release()!.id;
  initial.close();
  const second = await migrateCrypto(source, target, capture);
  expect('historyCount' in second ? second.historyCount : -1).toBe(0);
  const site = new Site(target);
  expect(site.release()!.id).toBe(release);
  const row = site.store.get('entry', 'test')!;
  const edited = site.saveEntry({ ...row.value, title: '保留站主修改' }, row.revision);
  site.close();
  await expect(migrateCrypto(source, target, capture)).rejects.toThrow(/目标存在修改/);
  const after = new Site(target);
  expect(after.store.get('entry', 'test')!.revision).toBe(edited.revision);
  expect(after.store.get('entry', 'test')!.value.title).toBe('保留站主修改');
  expect(after.release()!.id).toBe(release);
  after.close();

  const wrapper = readFileSync(join(target, 'extensions/index.ts'), 'utf8');
  const sourceFile = join(target, 'extensions/crypto-src/refresh.ts');
  const editableSource =
    readFileSync(sourceFile, 'utf8') + '\n// Instance customization retained on rollback.\n';
  writeFileSync(sourceFile, editableSource);
  const publish = vi.spyOn(SiteReleases.prototype, 'publish').mockImplementationOnce(() => {
    throw new Error('conversion publication failed');
  });
  try {
    await expect(convertCryptoSite(target, target, { apply: true })).rejects.toThrow(
      'conversion publication failed',
    );
  } finally {
    publish.mockRestore();
  }
  expect(readFileSync(join(target, 'extensions/index.ts'), 'utf8')).toBe(wrapper);
  expect(readFileSync(sourceFile, 'utf8')).toBe(editableSource);
  const converted = await convertCryptoSite(target, target, { apply: true });
  expect(converted.release).toBeTruthy();
  expect(readFileSync(join(target, 'extensions/index.ts'), 'utf8')).toContain(
    './crypto-src/index.ts',
  );
  expect(existsSync(join(target, 'extensions/crypto-src/blocks.ts'))).toBe(true);
});
