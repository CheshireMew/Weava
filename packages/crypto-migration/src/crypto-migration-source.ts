import { WeavaError } from '@weava/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yaml } from 'yaml';
import { walk } from '../../runtime-common/src/files.ts';
import { digest } from '../../runtime-common/src/identity.ts';
export function read(path: string, fallback: any = null) {
  return existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8').replace(/^\ufeff/, ''))
    : fallback;
}
export function markdown(file: string) {
  const raw = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) throw new WeavaError('Markdown 元信息无效：' + file);
  return { ...yaml(match[1]), markdown: match[2] };
}
export function prepareCryptoMigration(
  source: string,
  target: string,
  capture: string,
  dryRun: boolean,
) {
  const publicRoot = join(capture, 'site');
  if (!existsSync(publicRoot)) throw new WeavaError('找不到参考网站，请先运行 capture-crypto。');
  const sourceBaseline = read(join(capture, 'source-baseline.json'), []) as {
    path: string;
    hash: string;
  }[];
  const sourceChanged = sourceBaseline
    .filter((item) => !existsSync(item.path) || digest(readFileSync(item.path)) !== item.hash)
    .map((item) => item.path);
  if (sourceChanged.length && !dryRun)
    throw new WeavaError('来源已变化，请重新生成隔离参考快照。', 409, sourceChanged);
  const catalog = read(join(capture, 'catalog.json'), { pages: [], categories: [], hidden: [] });
  const pages = new Map<string, any>(catalog.pages.map((p: any) => [p.url, p]));
  const config = read(join(source, 'site.config.json'));
  const seo = read(
    join(capture, 'seo-history.json'),
    read(join(source, 'content/seo-history.json'), {}),
  );
  const htmlFiles = walk(publicRoot).filter((f) => f.endsWith('index.html'));
  const originals = new Map<string, any>();
  for (const file of walk(join(source, 'content/posts')).filter((f) => f.endsWith('.md'))) {
    const post = markdown(file);
    originals.set('/guides/' + post.slug + '/', post);
  }
  const plan = {
    source,
    target,
    capture,
    pages: htmlFiles.length,
    content: catalog.pages.length,
    originals: originals.size,
    hidden: catalog.hidden.length,
    sourceChanged,
  };
  return {
    source,
    target,
    capture,
    publicRoot,
    catalog,
    pages,
    config,
    seo,
    htmlFiles,
    originals,
    plan,
  };
}
export type CryptoMigrationSource = ReturnType<typeof prepareCryptoMigration>;
