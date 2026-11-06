import type { EntryScheduleModel } from './content-models.ts';
export function EntrySchedule({ model }: { model: EntryScheduleModel }) {
  const { record, scheduleDueAt, setScheduleDueAt, busy, setError } = model;
  if (!record) return null;
  const attempt = (action: () => Promise<void>) =>
    void action().catch((error) => setError(error.message));
  return (
    <div className="entry-schedule">
      <label>
        发布时间
        <input
          type="datetime-local"
          aria-label="定时发布时间"
          value={scheduleDueAt}
          onChange={(event) => setScheduleDueAt(event.target.value)}
        />
      </label>
      <button disabled={!scheduleDueAt || busy} onClick={() => attempt(model.create)}>
        安排发布
      </button>
      {model.items
        .filter(
          (item) =>
            item.value.entryId === record.id && ['scheduled', 'failed'].includes(item.value.status),
        )
        .map((item) => (
          <div className="schedule-item" key={item.id}>
            <time>{new Date(item.value.dueAt).toLocaleString()}</time>
            <p>{item.value.status === 'failed' ? item.value.error : '等待定时发布'}</p>
            <button onClick={() => attempt(() => model.cancel(item.id, item.revision))}>
              取消计划
            </button>
            {item.value.status === 'failed' && (
              <button onClick={() => attempt(() => model.retry(item.id, item.revision))}>
                重试
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
