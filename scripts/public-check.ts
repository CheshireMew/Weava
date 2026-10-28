import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
assert(!files.some((file) => /\.(sqlite|sqlite3|db|mp4|webm|zip|7z)$/i.test(file)));
const site = 'E:/Code/WeavaSites/crypto-blacknico',
  db = new Database(site + '/weava.sqlite', { readonly: true });
const settings = JSON.parse(
  (db.prepare("SELECT data FROM records WHERE scope='settings' AND id='site'").get() as any).data,
);
db.close();
const secrets = [
  readFileSync(site + '/cli-token', 'utf8').trim(),
  readFileSync('E:/Code/WeavaSites/demo/cli-token', 'utf8').trim(),
  readFileSync('D:/Tools/weava/demo-owner-password.txt', 'utf8').trim(),
  readFileSync('D:/Tools/weava/crypto-owner-password.txt', 'utf8').trim(),
  ...Object.values<any>(settings.extensions.crypto.config.referrals ?? {})
    .flatMap((item) => [item.url, item.code])
    .filter((value) => typeof value === 'string' && value.length >= 7),
];
const blog = 'E:/Code/WeavaSites/blog-blacknico';
if (existsSync(blog + '/cli-token')) secrets.push(readFileSync(blog + '/cli-token', 'utf8').trim());
if (existsSync('D:/Tools/weava/blog-owner-password.txt')) secrets.push(readFileSync('D:/Tools/weava/blog-owner-password.txt', 'utf8').trim());
if (existsSync(blog + '/weava.sqlite')) {
  const blogDb = new Database(blog + '/weava.sqlite', { readonly: true });
  try {
    for (const row of blogDb.prepare("SELECT data FROM records WHERE scope='entry'").all() as { data: string }[]) {
      const value = JSON.parse(row.data);
      if (value.visibility !== 'private') continue;
      if (value.title?.length >= 12) secrets.push(value.title);
      if (typeof value.document?.source === 'string' && value.document.source.length >= 80) secrets.push(value.document.source.slice(0, 120));
    }
  } finally { blogDb.close(); }
}
const leaks = files.filter((file) => {
  const text = readFileSync(file, 'utf8');
  return secrets.some((secret) => text.includes(secret));
});
assert.equal(leaks.length, 0, leaks.join(', '));
const commits = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
for (const commit of commits) {
  const names = execFileSync('git', ['ls-tree', '-r', '--name-only', commit], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert(!names.some((file) => /\.(sqlite|sqlite3|db|mp4|webm|zip|7z)$/i.test(file)), 'Site data found in commit ' + commit);
  const result = spawnSync('git', ['grep', '-l', '-F', '-f', '-', commit, '--'], { input: secrets.filter((value) => value.length >= 7).join('\n') + '\n', encoding: 'utf8' });
  assert.equal(result.status, 1, 'Private values found in Git history: ' + result.stdout.trim());
}
for (const file of files.filter((file) => file.startsWith('packages/core/src/')))
  assert(!/from\s+['"](?:react|astro|@astrojs)(?:\/|['"])/.test(readFileSync(file, 'utf8')), file);
assert(
  !/from\s+['"](?:node:|better-sqlite3|sharp)/.test(
    readFileSync('packages/contracts/src/index.ts', 'utf8'),
  ),
);
const licenseHash = createHash('sha256').update(readFileSync('LICENSE')).digest('hex');
assert.equal(licenseHash, 'd8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee');
const report = {
  passed: true,
  files: files.length,
  historyCommits: commits.length,
  checks: [
    'private-values-absent',
    'git-history-private-values-absent',
    'site-databases-and-media-excluded',
    'core-independent-of-ui-frameworks',
    'browser-contract-boundary',
    'canonical-license-bytes',
  ],
  licenseHash,
};
writeFileSync(
  'D:/Tools/cache/weava/acceptance/public-boundary.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
