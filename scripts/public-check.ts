import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
const leaks = files.filter((file) => {
  const text = readFileSync(file, 'utf8');
  return secrets.some((secret) => text.includes(secret));
});
assert.equal(leaks.length, 0, leaks.join(', '));
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
  checks: [
    'private-values-absent',
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
