import { Dialog } from './Dialog.tsx';
import { LoadingState } from './LoadingState.tsx';
import { useAdminQuery } from './useAdminQuery.ts';

type Finding = { kind: string; reason: string; action: string; urls: string[]; query?: string };
type Group = { provider: string; property: string; dimensions: string[]; pages: { url: string; entryId: string | null; title: string }[]; suggestions: Finding[] };
type Maintenance = { entryId: string; path: string; title: string; kind: string; reason: string; evidenceId?: string; claim?: string };
type Insights = { start: string; end: string; groups: Group[]; maintenance: Maintenance[] };

const labels: Record<string, string> = {
  'review-click-through': '有展示，点击较少',
  'near-first-page': '在搜索结果中已有一定排名',
  'review-decline': '搜索点击减少',
  'review-query-overlap': '同一个搜索词找到了多篇文章',
  'review-source': '引用来源需要重新核对',
  'verify-source': '引用来源待核对',
  'review-link': '链接需要检查',
};

export function SearchReviewDialog({ close, edit }: { close: () => void; edit: (id: string, evidenceId?: string) => Promise<void> }) {
  const { data, error, loading } = useAdminQuery<Insights>('seo/insights');
  const groups = data?.groups.filter(group => group.suggestions.length > 0) ?? [];
  function open(id: string, evidenceId?: string) { close(); void edit(id, evidenceId); }
  return <Dialog label="已发布文章检查" className="modal search-review-dialog" onClose={close}>
    <div className="seo-section-heading"><h2>已发布文章检查</h2><button type="button" onClick={close}>关闭</button></div>
    {loading && <LoadingState label="读取文章检查结果" />}
    {error && <p role="alert">{error}</p>}
    {data && <>
      {!data.maintenance.length && !groups.length && <p>{data.groups.length ? '目前没有需要处理的项目。' : '暂无引用来源或链接需要复核。导入搜索数据后，这里也会显示相关建议。'}</p>}
      {!!data.maintenance.length && <section aria-label="引用来源和链接">
        <h3>引用来源和链接</h3>
        {data.maintenance.map((item, index) => <div className="search-review-item" key={item.entryId + ':' + (item.evidenceId ?? index)}>
          <div><strong>{item.title || item.path}</strong><p>{labels[item.kind] ?? item.reason}{item.claim && ` · ${item.claim}`}</p>{!item.claim && labels[item.kind] && <p>{item.reason}</p>}</div>
          <button type="button" onClick={() => open(item.entryId, item.evidenceId)}>{item.evidenceId ? '查看来源' : '打开文章'}</button>
        </div>)}
      </section>}
      {!!groups.length && <section aria-label="搜索数据里的发现">
        <h3>搜索数据里的发现</h3>
        <p className="seo-preview-detail">{data.start} 至 {data.end}</p>
        {groups.map(group => <div key={JSON.stringify([group.provider, group.property, group.dimensions])} className="search-review-group">
            <p className="seo-preview-detail">{group.provider} · {group.property}</p>
            {group.suggestions.map((finding, index) => <div className="search-review-item" key={finding.kind + ':' + index}>
              <div><strong>{labels[finding.kind] ?? finding.kind}</strong>{finding.query && <p>查询词 · {finding.query}</p>}<p>{finding.reason} {finding.action}</p>
                <div className="search-review-links">{finding.urls.map(url => {
                  const page = group.pages.find(page => page.url === url);
                  return page?.entryId ? <button type="button" key={url} onClick={() => open(page.entryId!)}>{page.title || url}</button> : <span key={url}>{url}</span>;
                })}</div>
              </div>
            </div>)}
        </div>)}
      </section>}
    </>}
  </Dialog>;
}
