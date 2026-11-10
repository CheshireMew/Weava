import type { EntryScheduleModel } from './content-models.ts';
import {useState} from 'react';
import {zonedInstants} from '@weava/contracts';
export function EntrySchedule({ model }: { model: EntryScheduleModel }) {
  const { record, scheduleDueAt, setScheduleDueAt, busy, setError } = model;
  const [occurrence, setOccurrence] = useState<'' | 'earlier' | 'later'>('');
  const timezone = model.timezone ?? 'Asia/Shanghai';
  let matches: string[] = [], invalid = '';
  if (scheduleDueAt) try { matches = zonedInstants(scheduleDueAt, timezone); if (!matches.length) invalid = '这个时间因夏令时切换而不存在。'; } catch (error: any) { invalid = error.message; }
  if (!record) return null;
  const attempt = (action: () => Promise<void>) =>
    void action().catch((error) => setError(error.message));
  return (
    <div className="entry-schedule">
      <label>
        发布时间（{timezone}）
        <input
          type="datetime-local"
          aria-label="定时发布时间"
          value={scheduleDueAt}
          onChange={(event) => {setScheduleDueAt(event.target.value);setOccurrence('');}}
        />
      </label>
      {invalid && <p role="alert">{invalid}</p>}
      {matches.length > 1 && <label>夏令时重复时刻<select aria-label="选择重复时刻" value={occurrence} onChange={event => setOccurrence(event.target.value as typeof occurrence)}><option value="">请选择</option><option value="earlier">第一次（{matches[0]}）</option><option value="later">第二次（{matches[1]}）</option></select></label>}
      <button disabled={!scheduleDueAt || !!invalid || (matches.length > 1 && !occurrence) || busy} onClick={() => attempt(() => model.create(occurrence || undefined))}>
        安排发布
      </button>
      {model.items
        .filter(
          (item) =>
            item.value.entryId === record.id && ['scheduled', 'failed'].includes(item.value.status),
        )
        .map((item) => (
          <div className="schedule-item" key={item.id}>
            <time dateTime={item.value.dueAt}>{new Date(item.value.dueAt).toLocaleString('zh-CN', {timeZone: timezone})}（{timezone}）</time>
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
