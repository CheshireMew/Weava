import type { Page, BrowserContext } from 'playwright';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

export async function readBrowserDrafts(page: Page, id: string) {
  return page.evaluate(id => new Promise<any[]>((resolve, reject) => {
    const opening = indexedDB.open('weava-authoring', 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, read = db.transaction('drafts').objectStore('drafts').get(id);
      read.onsuccess = () => { resolve(read.result?.copies ?? []); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }), id);
}

export async function checkWritingRecovery({ origin, api, page, context, password, output }: {
  origin: string; api: (action: string, value?: any) => Promise<any>; page: Page; context: BrowserContext; password: string; output: string;
}) {
  const row = await api('entries/create', { kind: 'content', type: 'post', title: '写作恢复样例' });
  const release = (await fetch(origin + '/__health').then((response) => response.json()) as any).releaseId;
  const open = async (title: string) => { await page.goto(origin + '/admin/'); await page.getByLabel('搜索内容', { exact: true }).fill(title); await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click(); };
  const waitForDraft = async (title?: string) => {
    for (let i = 0; i < 40; i++) {
      const copies = await readBrowserDrafts(page, row.id);
      if (title ? copies.length === 1 && copies[0].record.value.title === title : copies.length === 0) return copies;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('本地草稿没有更新到预期状态。');
  };
  await open('写作恢复样例');
  await page.route('**/api/admin/v1/entry', (route) => route.abort());
  await page.getByLabel('内容标题').fill('未保存第一版');
  await waitForDraft('未保存第一版');
  await page.getByLabel('内容标题').fill('未保存第二版');
  await waitForDraft('未保存第二版');
  page.once('dialog', dialog => { assert.equal(dialog.type(), 'beforeunload'); void dialog.accept(); });
  await page.reload(); await page.getByLabel('搜索内容', { exact: true }).fill('写作恢复样例');
  await page.locator('.entry-list button').filter({ has: page.getByRole('heading', { name: '写作恢复样例', exact: true }) }).click();
  await page.getByRole('button', { name: '恢复到编辑器', exact: true }).click();
  assert.equal(await page.getByLabel('内容标题').inputValue(), '未保存第二版');
  await page.unroute('**/api/admin/v1/entry');
  await page.getByLabel('内容标题').press('Control+s');
  for (let i = 0; i < 40; i++) { if ((await api('entry/' + row.id)).value.title === '未保存第二版') break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await api('entry/' + row.id)).value.title, '未保存第二版');
  await waitForDraft();
  await page.getByRole('button', { name: '本地草稿', exact: true }).click();
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
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; (window as any).__draftStoreOriginal = original; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'drafts') throw new DOMException('浏览器无法保存本地草稿', 'QuotaExceededError'); return original.apply(this, args); }; });
  await page.getByLabel('内容标题').fill('本地空间不足仍可保存');
  await page.getByRole('alert').filter({ hasText: /浏览器无法保存本地草稿/ }).waitFor();
  for (let i = 0; i < 40; i++) { if ((await api('entry/' + row.id)).value.title === '本地空间不足仍可保存') break; await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await api('entry/' + row.id)).value.title, '本地空间不足仍可保存');
  await page.evaluate(() => { IDBObjectStore.prototype.put = (window as any).__draftStoreOriginal; delete (window as any).__draftStoreOriginal; });
  return { singleOfflineDraft: true, latestDraftRecovery: true, savedDraftCleared: true, unsavedCloseConfirmation: true, reauthPreservesDraft: true, reauthDoesNotPublish: true, storageFailureVisible: true, serverSaveStillWorks: true };
}
