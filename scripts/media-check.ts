import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import sharp from 'sharp';
import { entrySchema } from '@weava/contracts';
const root = 'D:/Tools/cache/weava/acceptance/media-site-' + Date.now(),
  origin = 'http://127.0.0.1:4325';
const initialized = spawnSync(
  process.execPath,
  [
    'dist/weava.mjs',
    '--site',
    root,
    'init',
    '--password-file',
    'D:/Tools/weava/demo-owner-password.txt',
    '--port',
    '4325',
  ],
  { encoding: 'utf8', windowsHide: true },
);
assert.equal(initialized.status, 0, initialized.stderr);
const child = spawn(process.execPath, ['apps/web/dist/server/entry.mjs'], {
  windowsHide: true,
  stdio: 'ignore',
  env: {
    ...process.env,
    WEAVA_SITE: root,
    WEAVA_FRAMEWORK: process.cwd(),
    PORT: '4325',
    HOST: '127.0.0.1',
  },
});
const headers = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer ' + readFileSync(root + '/cli-token', 'utf8'),
};
const api = async (path: string, data?: any, key?: string) => {
  const response = await fetch(origin + '/api/admin/v1/' + path, {
    method: data ? 'POST' : 'GET',
    headers: { ...headers, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  assert(response.ok, await response.clone().text());
  return response.json() as any;
};
const wait = async (job: any) => {
  for (let i = 0; i < 200 && ['queued', 'running'].includes(job.status); i++) {
    await new Promise((r) => setTimeout(r, 100));
    job = await api('job/' + job.id);
  }
  assert.equal(job.status, 'complete', JSON.stringify(job));
  return job;
};
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      ready = (await fetch(origin + '/__health')).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready);
  const image = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#315c4c' },
  })
    .png()
    .toBuffer();
  const payload = { name: '验收图片.png', base64: image.toString('base64') },
    job = await api('media', payload, 'media-once');
  assert.equal((await api('media', payload, 'media-once')).id, job.id);
  const completed = await wait(job),
    media = completed.result.value;
  assert.equal(media.derivatives.length, 2);
  const value = entrySchema.parse({
      id: 'responsive-image',
      title: '响应图片',
      kind: 'content',
      type: 'post',
      path: '/blog/responsive-image/',
      cover: media.url,
      document: { version: 1, format: 'markdown', source: '![图片](' + media.url + ')' },
    }),
    row = await api('entry', { value, revision: null });
  const login = await fetch(origin + '/api/admin/v1/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      password: readFileSync('D:/Tools/weava/demo-owner-password.txt', 'utf8').trim(),
    }),
  });
  const preview = await fetch(origin + '/__preview/' + row.id + '?revision=' + row.revision, {
    headers: { Cookie: login.headers.get('set-cookie')!.split(';')[0] },
  });
  assert.equal(preview.status, 200);
  assert((await preview.text()).includes('响应图片'));
  await wait(await api('publish', { ids: [row.id] }));
  const html = await (await fetch(origin + value.path)).text();
  assert(html.includes('srcset='));
  assert(html.includes('/media/optimized/'));
  const derivative = await fetch(origin + media.derivatives[0].url);
  assert.equal(derivative.status, 200);
  assert.equal(derivative.headers.get('content-type'), 'image/webp');
  const report = {
    passed: true,
    site: root,
    jobId: job.id,
    checks: [
      'asynchronous-upload',
      'idempotent-media-job',
      'sharp-derived-images',
      'published-srcset',
      'runtime-media-serving',
      'first-release-draft-preview',
    ],
  };
  writeFileSync('D:/Tools/cache/weava/acceptance/media.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  if (child.pid)
    try {
      process.kill(child.pid);
    } catch {}
}
