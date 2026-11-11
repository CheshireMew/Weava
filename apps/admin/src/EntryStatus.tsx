export function entryStatus(row: { published?: boolean; hasChanges?: boolean; value: { status: string } }) {
  if (row.published) return row.hasChanges
    ? { key: 'changed', label: '有未发布修改' }
    : { key: 'published', label: '已发布' };
  return { key: 'draft', label: '草稿' };
}

export function EntryStatus({ row }: { row: Parameters<typeof entryStatus>[0] }) {
  const status = entryStatus(row);
  return <span className={'entry-state ' + status.key}><span className="status-dot" aria-hidden="true" />{status.label}</span>;
}
