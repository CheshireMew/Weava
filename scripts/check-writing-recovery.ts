import type { Page, BrowserContext } from 'playwright';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

export async function checkWritingRecovery({ origin, api, page, context, password, output }: {
  origin: string; api: (action: string, value?: any) => Promise<any>; page: Page; context: BrowserContext; password: string; output: string;
}) {
  const row = await api('entries/create', { kind: 'content', type: 'post', title: '写作恢复样例' });
  const release = (await fetch(origin + '/__health').then((response) => response.json()) as any).releaseId;
  const open = async (title: string) => { await page.goto(origin + '/admin/'); await page.getByLabel('搜索内容', { exact: true }).fill(title); await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click(); };
  await open('写作恢复样例');
  await page.route('**/api/admin/v1/entry', (route) => route.abort());
  await page.getByLabel('内容标题').fill('未保存第一版');
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('weava-drafts:v2') || '{"entries":{}}').entries[id]?.[0]?.record.value.title === '未保存第一版', row.id);
  await new Promise((resolve) => setTimeout(resolve, 15200));
  await page.getByLabel('内容标题').fill('未保存第二版');
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('weava-drafts:v2') || '{"entries":{}}').entries[id]?.length >= 2, row.id);
  const copies = await page.evaluate((id) => JSON.parse(localStorage.getItem('weava-drafts:v2')!).entries[id], row.id);
  await page.reload(); await page.getByLabel('搜索内容', { exact: true }).fill('写作恢复样例');
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '写作恢复样例', exact: true }) }).click();
  await page.getByLabel('选择本地草稿').selectOption(copies.find((copy: any) => copy.record.value.title === '未保存第一版').id);
  await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click();
  assert.equal(await page.getByLabel('内容标题').inputValue(), '未保存第一版');
  await page.unroute('**/api/admin/v1/entry');
  await page.getByLabel('内容标题').press('Control+s');
  for (let i = 0; i < 40; i++) { if ((await api('entry/' + row.id)).value.title === '未保存第一版') break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await api('entry/' + row.id)).value.title, '未保存第一版');
  await page.getByRole('button', { name: '本地副本', exact: true }).click();
  assert((await page.getByLabel('选择本地草稿').locator('option').allTextContents()).some((text) => text.includes('未保存第二版')));
  await page.getByRole('button', { name: '使用服务器版本', exact: true }).click();
  await page.getByRole('button', { name: '恢复到编辑器', exact: true }).waitFor({ state: 'hidden' });
  await context.request.post(origin + '/api/admin/v1/logout', { data: {} });
  await page.getByLabel('内容标题').fill('重新登录后保存');
  const dialog = page.getByRole('dialog', { name: '重新登录', exact: true }); await dialog.waitFor();
  assert.equal(await page.getByLabel('内容标题').inputValue(), '重新登录后保存');
  await dialog.getByLabel('站主密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '登录并保存草稿', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  for (let i = 0; i < 40; i++) { if ((await api('entry/' + row.id)).value.title === '重新登录后保存') break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await api('entry/' + row.id)).value.title, '重新登录后保存');
  assert.equal((await fetch(origin + '/__health').then((response) => response.json()) as any).releaseId, release);
  await page.screenshot({ path: join(output, 'writing-reauth-saved.png'), fullPage: true });
  // A denied browser store must be visible while the server draft can still be saved.
  await page.evaluate(() => { const original = Storage.prototype.setItem; (window as any).__draftStoreOriginal = original; Storage.prototype.setItem = function(key, value) { if (key === 'weava-drafts:v2') throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); }; });
  await page.getByLabel('内容标题').fill('本地空间不足仍可保存');
  await page.getByRole('alert').filter({ hasText: /浏览器无法保存本地草稿/ }).waitFor();
  for (let i = 0; i < 40; i++) { if ((await api('entry/' + row.id)).value.title === '本地空间不足仍可保存') break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await api('entry/' + row.id)).value.title, '本地空间不足仍可保存');
  await page.evaluate(() => { Storage.prototype.setItem = (window as any).__draftStoreOriginal; delete (window as any).__draftStoreOriginal; });
  return { multipleOfflineCopies: true, olderCopyRecovery: true, newerCopyPreserved: true, reauthPreservesDraft: true, reauthDoesNotPublish: true, storageFailureVisible: true, serverSaveStillWorks: true };
}
