import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Site } from '@weava/core';
import { migrateCrypto } from '../packages/core/src/migrate.ts';
it('reuses imported identities and reports target edits without overwriting them', async () => {
  const base = 'D:/Tools/cache/weava/tests/migration-' + Date.now(),
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
});
