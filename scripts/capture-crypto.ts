import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { walk, digest, atomicJson } from '@weava/core';
const source = resolve(process.argv[2] ?? 'E:/Code/crypto.blacknico.com');
const output = resolve(process.argv[3] ?? 'D:/Tools/cache/weava/crypto-capture');
mkdirSync(output, { recursive: true });
const files = [
  ...walk(join(source, 'scripts')),
  ...walk(join(source, 'src')),
  ...walk(join(source, 'content')),
  ...walk(join(source, 'public')).filter((f) => !/\.(mp4|mov|m4v|webm)$/i.test(f)),
  join(source, 'site.config.json'),
].filter((f) => !f.endsWith('.pyc') && !f.includes('__pycache__'));
const before = files.map((path) => ({ path, hash: digest(readFileSync(path)) }));
atomicJson(join(output, 'source-baseline.json'), before);
// One-time read-only bridge to the legacy renderer. Weava itself has no Python runtime dependency.
const python = process.env.CRYPTO_PYTHON ?? 'D:/Tools/venvs/crypto-blacknico/Scripts/python.exe';
const script = `import sys, json, os\nfrom pathlib import Path\nsys.path.insert(0,str(Path(sys.argv[1])/'scripts'))\nfrom render_context import create_context\nfrom build import build_site\nimport equity_normalizers as e\nctx=create_context()\nbuild_site(ctx)\nPath(sys.argv[2]).joinpath('catalog.json').write_text(json.dumps({'pages':list(ctx.catalog.pages.values()),'basePages':list(ctx.catalog.base_pages.values()),'categories':ctx.catalog.categories,'hidden':list(ctx.catalog.hidden_urls),'config':ctx.config},ensure_ascii=False),encoding='utf8')\nPath(sys.argv[2]).joinpath('equity-rules.json').write_text(json.dumps({'chinese':e.CHINESE_NAMES,'markets':e.NON_US_MARKETS,'excluded':list(e.NON_EQUITY_FUNDS),'namePattern':e.NON_EQUITY_NAME.pattern,'logos':e.LOCAL_EQUITY_LOGOS},ensure_ascii=False),encoding='utf8')\n`;
const result = spawnSync(python, ['-B', '-c', script, source, output], {
  cwd: source,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  windowsHide: true,
  env: {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: '1',
    CRYPTO_SITE_DIR: join(output, 'site'),
    CRYPTO_REPORT_DIR: join(output, 'reports'),
    CRYPTO_HISTORY_FILE: join(output, 'seo-history.json'),
    CRYPTO_LINK_MEDIA: '1',
  },
});
writeFileSync(join(output, 'capture.log'), result.stdout + '\n' + result.stderr);
if (result.status) throw new Error('旧站参考页面生成失败，请查看 ' + join(output, 'capture.log'));
const changed = before.filter((item) => digest(readFileSync(item.path)) !== item.hash);
if (changed.length)
  throw new Error('捕获期间来源发生变化：' + changed.map((f) => f.path).join(','));
console.log(
  JSON.stringify({ output, files: before.length, sourceUnchanged: true, log: result.stdout }),
);
