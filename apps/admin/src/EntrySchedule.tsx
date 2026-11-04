import { api } from './api.ts';
import type { ContentWorkspace } from './useContentWorkspace.ts';

export function EntrySchedule({ model }: { model: Pick<ContentWorkspace, 'record' | 'scheduleDueAt' | 'setScheduleDueAt' | 'persist' | 'busy' | 'refresh' | 'notify' | 'setError' | 'state'> }) {
  const { record, scheduleDueAt, setScheduleDueAt, persist, busy, refresh, notify, setError, state } = model;
  if (!record) return null;
  return <div className="entry-schedule">
        <label>
          发布时间
          <input
            type="datetime-local"
            aria-label="定时发布时间"
            value={scheduleDueAt}
            onChange={(event) => setScheduleDueAt(event.target.value)}
          />
        </label>
        <button
          disabled={!scheduleDueAt || busy}
          onClick={async () => {
            try {
              const row = await persist();
              if (!row) return;
              await api('schedule', {
                id: row.id,
                revision: row.revision,
                dueAt: new Date(scheduleDueAt).toISOString(),
              });
              setScheduleDueAt('');
              await refresh();
              notify('定时发布已安排');
            } catch (error: any) {
              setError(error.message);
            }
          }}
        >
          安排发布
        </button>
        {(state.schedules ?? [])
          .filter(
            (item: any) =>
              item.value.entryId === record.id &&
              ['scheduled', 'failed'].includes(item.value.status),
          )
          .map((item: any) => (
            <div className="schedule-item" key={item.id}>
              <time>{new Date(item.value.dueAt).toLocaleString()}</time>
              <p>{item.value.status === 'failed' ? item.value.error : '等待定时发布'}</p>
              <button
                onClick={async () => {
                  try {
                    await api('schedule/cancel', { id: item.id, revision: item.revision });
                    await refresh();
                  } catch (error: any) {
                    setError(error.message);
                  }
                }}
              >
                取消计划
              </button>
              {item.value.status === 'failed' && (
                <button
                  onClick={async () => {
                    try {
                      await api('schedule/retry', { id: item.id, revision: item.revision });
                      await refresh();
                    } catch (error: any) {
                      setError(error.message);
                    }
                  }}
                >
                  重试
                </button>
              )}
            </div>
          ))}
  </div>;
}
