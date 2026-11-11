import type {EntryMoreActionsModel} from './content-models.ts';

export function EntryMoreActions({model}:{model:EntryMoreActionsModel}) {
  const {record,withdraw}=model;
  if (!record) return null;
  return <div className="entry-more-actions">

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
        {(record.published??record.value.status === 'published') && <button
          onClick={()=>withdraw()}
        >
          撤下为草稿
        </button>}
  </div>;
}
