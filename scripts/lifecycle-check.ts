import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const origin = 'http://127.0.0.1:4322',
  before = (await (await fetch(origin + '/__health')).json()) as any;
async function run(args: string[], env: any) {
  return new Promise<{ code: number | null; text: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let text = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('进程未按预期退出'));
    }, 15000);
    child.stdout.on('data', (v) => (text += v));
    child.stderr.on('data', (v) => (text += v));
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, text });
    });
  });
}
const duplicate = await run(['dist/weava.mjs', '--site', 'E:/Code/WeavaSites/demo', 'start'], {});
assert.equal(duplicate.code, 1);
assert(duplicate.text.includes('仍在运行'));
const port = await run(['apps/web/dist/server/entry.mjs'], {
  PORT: '4322',
  HOST: '127.0.0.1',
  WEAVA_SITE: 'E:/Code/WeavaSites/demo',
  WEAVA_FRAMEWORK: process.cwd(),
});
assert.notEqual(port.code, 0);
assert(port.text.includes('EADDRINUSE'));
const after = (await (await fetch(origin + '/__health')).json()) as any;
assert.equal(after.pid, before.pid);
const report = {
  passed: true,
  checks: [
    'duplicate-site-refused',
    'occupied-port-exits-with-EADDRINUSE',
    'original-service-preserved',
  ],
  pid: before.pid,
};
writeFileSync('D:/Tools/cache/weava/acceptance/lifecycle.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
