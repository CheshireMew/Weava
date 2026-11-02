import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { AnalyticsReport, AnalyticsVisitorDetail } from '@weava/contracts';
import { api } from '../api.ts';
import { Dialog } from '../Dialog.tsx';

import { DataTable } from './DataTable.tsx';

import { number, duration, dateAt } from './format.ts';
import { analyticsPresentation } from './presentation.tsx';

export function VisitorDetails({
  visitor,
  setVisitor,
  data,
}: {
  visitor: string;
  setVisitor: (id: string | null) => void;
  data: AnalyticsReport | null;
}) {
  const [detail, setDetail] = useState<AnalyticsVisitorDetail | null>(null),
    [detailError, setDetailError] = useState(''),
    [detailPage, setDetailPage] = useState(1);
  const { zone, pageLink } = analyticsPresentation(data, () => {});
  useEffect(() => {
    if (!visitor) {
      setDetail(null);
      return;
    }
    let stopped = false;
    setDetail(null);
    setDetailError('');
    void api(
      `analytics/visitor?${new URLSearchParams({
        id: visitor,
        start: data?.range.start || '',
        end: data?.range.end || '',
        page: String(detailPage),
      })}`,
    )
      .then((v) => {
        if (!stopped) setDetail(v);
      })
      .catch((e) => {
        if (!stopped) setDetailError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [visitor, detailPage, data?.range.start, data?.range.end]);
  return (
    <>
      {' '}
      {visitor && (
        <Dialog
          className="modal analytics-visitor-dialog"
          onClose={() => setVisitor(null)}
          label="访客访问记录"
        >
          <div className="analytics-card-title">
            <h2>访客 {visitor.slice(0, 8)}</h2>
            <button onClick={() => setVisitor(null)} aria-label="关闭访客记录">
              <X size={18} />
            </button>
          </div>
          <p className="analytics-note">
            {data?.range.start} — {data?.range.end} · {zone}
          </p>
          {detailError ? (
            <p role="alert">{detailError}</p>
          ) : !detail ? (
            <p role="status">正在读取访问记录…</p>
          ) : (
            <>
              <DataTable
                rows={detail.events}
                size={50}
                columns={[
                  { key: 'ts', label: '时间', render: (v) => dateAt(v.ts, zone) },
                  { key: 'session', label: '会话', render: (v) => v.session.slice(0, 8) },
                  {
                    key: 'kind',
                    label: '活动',
                    render: (v) =>
                      (
                        ({ view: '浏览', click: '点击', event: '关键动作' }) as Record<
                          string,
                          string
                        >
                      )[v.kind] || v.kind,
                  },
                  { key: 'path', label: '页面', render: (v) => pageLink(v.path) },
                  { key: 'label', label: '内容' },
                  {
                    key: 'activeMs',
                    label: '停留',
                    render: (v) => (v.kind === 'view' ? duration(v.activeMs) : '—'),
                  },
                  {
                    key: 'scroll',
                    label: '阅读进度',
                    render: (v) => (v.kind === 'view' ? v.scroll + '%' : '—'),
                  },
                ]}
              />
              {detail.pages > 1 && (
                <div className="analytics-pagination">
                  <span>
                    共 {number(detail.total)} 条 · {detail.page}/{detail.pages}
                  </span>
                  <button
                    disabled={detail.page <= 1}
                    onClick={() => setDetailPage(detail.page - 1)}
                  >
                    上一页
                  </button>
                  <button
                    disabled={detail.page >= detail.pages}
                    onClick={() => setDetailPage(detail.page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </Dialog>
      )}{' '}
    </>
  );
}
