// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditSessionsProvider } from '../apps/admin/src/EditSessions.tsx';
import { SelectorsProvider, useSelectors } from '../apps/admin/src/Selectors.tsx';
import { Fields } from '../apps/admin/src/Fields.tsx';
import { MergeDialog, RevisionDialog } from '../apps/admin/src/Revisions.tsx';
import MediaManager from '../apps/admin/src/MediaManager.tsx';
import HistoryMaintenance from '../apps/admin/src/HistoryMaintenance.tsx';
import Operations from '../apps/admin/src/Operations.tsx';
import ImportManager from '../apps/admin/src/ImportManager.tsx';
import { AnalyticsReportView } from '../apps/admin/src/AnalyticsReportView.tsx';
import { ReportWorkspace } from '../apps/admin/src/analytics/report-workspace.ts';
import { api, waitJob } from '../apps/admin/src/api.ts';

const mocks = vi.hoisted(() => ({ api: vi.fn(), waitJob: vi.fn() }));
vi.mock('../apps/admin/src/api.ts', () => mocks);
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mocks.api.mockReset(); mocks.waitJob.mockReset(); localStorage.clear();
  mocks.api.mockImplementation(async (path: string) => path.includes('query?') ? { items: [], total: 0, pages: 0 } : []);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });
async function render(node: React.ReactNode) { await act(async () => root.render(<EditSessionsProvider><SelectorsProvider>{node}</SelectorsProvider></EditSessionsProvider>)); }
function button(text: string, scope: ParentNode = document) { const node = [...scope.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text); expect(node, text).toBeDefined(); return node!; }
async function click(text: string, scope?: ParentNode) { await act(async () => button(text, scope).click()); }
async function fill(selector: string, value: string) { await act(async () => { const node = document.querySelector<HTMLInputElement>(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
function dialog(name: string) { return document.querySelector<HTMLDialogElement>(`dialog[aria-label="${name}"]`)!; }

it('uses a separate URL dialog, rejects invalid schemes, and preserves the media picker when cancelled', async () => {
  const selected = vi.fn();
  function Select() { const selectors = useSelectors(); return <button onClick={async () => selected(await selectors.media('image'))}>选图</button>; }
  await render(<Select />); await click('选图');
  expect(dialog('选择媒体').querySelector('.selector-toolbar')?.textContent).toContain('上传文件');
  await click('粘贴网址'); await fill('[aria-label="媒体网址"]', 'javascript:alert(1)');
  await act(async () => dialog('粘贴媒体网址').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(dialog('粘贴媒体网址').textContent).toContain('请填写完整的网址'); expect(selected).not.toHaveBeenCalled();
  await click('取消', dialog('粘贴媒体网址')); expect(dialog('选择媒体').open).toBe(true);
  await click('粘贴网址'); await fill('[aria-label="媒体网址"]', 'https://example.com/image?id=4');
  await act(async () => dialog('粘贴媒体网址').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(selected).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/image?id=4', kind: 'image' }));
  expect(dialog('选择媒体')).toBeNull();
  expect(mocks.api.mock.calls.every(([, input]: any[]) => input === undefined)).toBe(true);
});

it('keeps simple repeat fields visible and edits complex items in a modal without changing their order', async () => {
  const changes = vi.fn();
  const definitions: any[] = [{ key: 'links', label: '链接', type: 'text', multiple: true }, { key: 'people', label: '人物', type: 'group', multiple: true, fields: [{ key: 'name', label: '姓名', type: 'text' }, { key: 'role', label: '职务', type: 'text' }, { key: 'note', label: '说明', type: 'text' }] }];
  function Form() { const [value, set] = useState({ links: ['one', 'two'], people: [{ name: '甲', role: '编辑', note: '原说明' }] }); return <Fields definitions={definitions} values={value} onChange={next => { changes(next); set(next); }} />; }
  await render(<Form />); expect(host.querySelector('details')).toBeNull();
  expect(host.querySelectorAll('input')).toHaveLength(2); await click('编辑');
  expect(dialog('编辑人物').querySelectorAll('input')).toHaveLength(3);
  await fill('dialog input[aria-label="姓名"]', '乙'); await click('完成', dialog('编辑人物'));
  expect(changes.mock.calls.at(-1)![0]).toEqual({ links: ['one', 'two'], people: [{ name: '乙', role: '编辑', note: '原说明' }] });
  await click('下移第1项'); expect(changes.mock.calls.at(-1)![0].links).toEqual(['two', 'one']);
});

it('shows comparisons directly and switches source views without modifying revision values', async () => {
  mocks.api.mockResolvedValue({ changes: [{ path: '/document', before: { source: '**旧文**' }, beforeHtml: '<p><b>旧文</b></p>', after: { source: '**新文**' }, afterHtml: '<p><b>新文</b></p>' }] });
  const restore = vi.fn();
  await render(<RevisionDialog id="article" history={[{ revision: 2 }, { revision: 1 }]} onClose={vi.fn()} onRestore={restore} onError={vi.fn()} />);
  expect(dialog('历史版本').querySelectorAll('.revision-prose')).toHaveLength(2);
  expect(host.querySelector('details')).toBeNull(); await click('修改前 正文代码');
  expect(dialog('历史版本').querySelector('pre')?.textContent).toContain('**旧文**');
  expect(restore).not.toHaveBeenCalled();
});

it('keeps merge choices when inspecting the original version and sends only the selected resolutions', async () => {
  const save = vi.fn(async () => {}), plan = { base: { revision: 1 }, remote: { revision: 3 }, conflicts: [{ path: '/title', base: '原名', local: '本地名', remote: '远程名' }], changes: [{ path: '/description', before: '旧摘要', after: '新摘要' }] };
  await render(<MergeDialog plan={plan} onSave={save} onRemote={vi.fn()} onClose={vi.fn()} onError={vi.fn()} />);
  expect(host.textContent).toContain('新摘要'); expect(button('保存合并结果').disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="标题保留本地"]')!.click());
  await click('查看原版本'); expect(dialog('原版本').textContent).toContain('原名');
  await click('关闭', dialog('原版本')); expect(host.querySelector<HTMLInputElement>('[aria-label="标题保留本地"]')!.checked).toBe(true);
  await click('保存合并结果'); expect(save).toHaveBeenCalledWith({ '/title': 'local' });
});

it('changes the backup folder only on confirmation and verifies using the entered folder', async () => {
  const task = vi.fn(); await render(<Operations state={{ releases: [], jobs: [] }} task={task} refresh={vi.fn()} onError={vi.fn()} openLogs={vi.fn()} />);
  expect(host.querySelector('details')).toBeNull(); await click('更改位置'); await fill('dialog input', 'D:/Backups/test');
  await click('取消', dialog('更改备份位置')); await click('创建备份'); expect(task).toHaveBeenLastCalledWith('backup', { path: 'D:/Tools/weava/backups' });
  await click('更改位置'); await fill('dialog input', 'D:/Backups/test');
  await act(async () => dialog('更改备份位置').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await click('创建备份'); expect(task).toHaveBeenLastCalledWith('backup', { path: 'D:/Backups/test' });
  await click('检查已有备份'); await fill('dialog input', 'D:/Backups/existing');
  await act(async () => dialog('检查已有备份').querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(task).toHaveBeenLastCalledWith('verify', { path: 'D:/Backups/existing' });
});

it('cancels crop without saving and submits the selected crop once when confirmed', async () => {
  const row = { id: 'image', revision: 3, value: { id: 'image', name: '原图', url: '/media/image.jpg' } };
  mocks.api.mockImplementation(async (path: string) => path.startsWith('media/query?') ? { items: [row], total: 1, pages: 1 } : path === 'media/groups' ? [] : path.startsWith('media/references') ? { working: [], layouts: [], published: [], historicalRevisions: 0 } : { id: 'job' });
  mocks.waitJob.mockResolvedValue({ result: { ...row, revision: 4 } } as any);
  await render(<MediaManager onError={vi.fn()} onOpen={vi.fn()} />);
  await act(async () => host.querySelector<HTMLButtonElement>('.media-open')!.click()); await click('裁切图片');
  await click('关闭', dialog('裁切图片')); expect(mocks.api.mock.calls.some(([path]: any[]) => path === 'media/crop')).toBe(false);
  await click('裁切图片'); const surface = dialog('裁切图片').querySelector<HTMLElement>('.crop-surface')!;
  surface.setPointerCapture = vi.fn(); surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as any;
  await act(async () => surface.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 20, bubbles: true })));
  await act(async () => surface.dispatchEvent(new PointerEvent('pointermove', { clientX: 80, clientY: 90, bubbles: true })));
  await act(async () => surface.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
  await click('保存裁切图片');
  expect(api).toHaveBeenCalledWith('media/crop', { id: 'image', revision: 3, crop: { left: 10, top: 20, width: 70, height: 70 } });
  expect(dialog('裁切图片')).toBeNull(); expect(waitJob).toHaveBeenCalledTimes(1);
});

it('shows import problems immediately and opens long explanations without committing the import', async () => {
  const report = { dryRun: true, content: 1, pages: 0, terms: 0, attachments: [], comments: 0, reviewRequired: [{ id: 'one', title: '旧文章', unresolved: ['需检查视频'] }], skipped: [], warnings: ['说明一', '说明二', '说明三', '说明四'], notes: [] };
  mocks.api.mockResolvedValue(report);
  await render(<ImportManager refresh={vi.fn(async () => {})} />);
  const field = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(field, 'files', { value: [{ name: 'source.xml', size: 100, text: async () => '<rss />' }] });
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })));
  await click('预检导入'); expect(host.textContent).toContain('需检查视频'); expect(host.querySelector('details')).toBeNull();
  await click('查看详情（4 条）'); expect(dialog('转换说明').textContent).toContain('说明四');
  expect(api).toHaveBeenCalledTimes(1); expect(api).toHaveBeenCalledWith('import/wxr', expect.objectContaining({ options: expect.objectContaining({ dryRun: true }) }));
});

it('keeps the overview focused and links to details without changing shared filters', async () => {
  const totals = { views: 1, visitors: 1, sessions: 1, clicks: 0 };
  const data: any = { ...totals, range: { start: '2026-11-03', end: '2026-11-04', timezone: 'Asia/Shanghai', previousStart: '2026-11-01', previousEnd: '2026-11-02' }, previous: totals, lifetime: totals, averageActiveMs: 10, overview: [], daily: [{ date: '2026-11-04', views: 1, visitors: 1, sessions: 1, clicks: 0, previousViews: 1, previousVisitors: 1 }], historicalViews: 0 };
  for (const key of ['pages', 'sources', 'engines', 'countries', 'browsers', 'operatingSystems', 'devices', 'models', 'activeVisitors', 'recentVisitors', 'links', 'actions', 'campaigns', 'crawlers', 'legacySources']) data[key] = [];
  const model: any = { loading: false, filters: { country: 'CN' }, loadedQuery: 'country=CN', live: { visitors: [], count: 0 }, retryLive: { current: vi.fn() }, filter: vi.fn(), updateGeo: vi.fn() };
  const navigate = vi.fn();
  await render(<ReportWorkspace.Provider value={{ data, query: 'start=2026-11-03&end=2026-11-04', loading: false, changeRange: vi.fn(), navigate, openVisitor: vi.fn() }}><AnalyticsReportView data={data} model={model} onError={vi.fn()} /></ReportWorkspace.Provider>);
  const headings = [...host.querySelectorAll('h2')].map(node => node.textContent);
  expect(headings).toEqual(['搜索与 AI 来源趋势', '流量趋势', '流量概览', '页面排行']);
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(host.querySelector('details')).toBeNull();
  await act(async () => host.querySelector<HTMLAnchorElement>('[aria-label="流量趋势"] footer a')!.click());
  expect(navigate).toHaveBeenCalledWith('traffic', 'start=2026-11-03&end=2026-11-04');
  expect(model.filters).toEqual({ country: 'CN' }); expect(model.filter).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
});

it('views archive contents in a dialog without restoring or altering history', async () => {
  mocks.api.mockImplementation(async (path: string) => path === 'maintenance/archives' ? [{ id: 'archive', createdAt: '2026-11-04T10:00:00Z', releases: 1, revisions: 2 }] : { releases: [{ id: 'release', createdAt: '2026-11-01T10:00:00Z' }], revisions: [{}, {}] });
  await render(<HistoryMaintenance refresh={vi.fn(async () => {})} />); await click('查看归档');
  expect(dialog('归档内容').textContent).toContain('公开版本 1 · 修订 2');
  await click('关闭', dialog('归档内容')); expect(dialog('归档内容')).toBeNull();
  expect(mocks.api).toHaveBeenCalledTimes(2); expect(waitJob).not.toHaveBeenCalled();
});
