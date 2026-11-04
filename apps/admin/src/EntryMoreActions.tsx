import { Archive } from 'lucide-react';
import { api } from './api.ts';
import { SaveCreationTemplate } from './AuthoringControls.tsx';
import type { ContentWorkspace } from './useContentWorkspace.ts';

export function EntryMoreActions({ model }: { model: Pick<ContentWorkspace, 'record' | 'state' | 'session' | 'update' | 'persist' | 'setError' | 'refresh' | 'notify' | 'select'> }) {
  const { record, state, session, update, persist, setError, refresh, notify, select } = model;
  if (!record) return null;
  return <div className="entry-more-actions">
        <SaveCreationTemplate
          entry={record.value}
          onSaved={async () => {
            await refresh();
          }}
          onError={setError}
        />

        <button
          onClick={() => {
            const blob = new Blob(
              [
                record.value.document.format === 'markdown'
                  ? record.value.document.source
                  : JSON.stringify(record.value, null, 2),
              ],
              { type: 'text/plain' },
            );
            const url = URL.createObjectURL(blob),
              a = document.createElement('a');
            a.href = url;
            a.download =
              record.id + (record.value.document.format === 'markdown' ? '.md' : '.json');
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          导出内容
        </button>
        <button
          onClick={async () => {
            const row = await persist();
            if (!row) return;
            await api('withdraw', { id: row.id, revision: row.revision });
            await refresh();
            await select(row.id);
          }}
        >
          撤下为草稿
        </button>
        <button
          onClick={async () => {
            const row = await persist();
            if (!row) return;
            await api('withdraw', {
              id: row.id,
              revision: row.revision,
              archive: true,
            });
            await refresh();
            await select(row.id);
          }}
        >
          <Archive size={14} />
          归档
        </button>
  </div>;
}
