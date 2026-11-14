import { hasNoteContent, type Entry, type Revision } from '@weava/contracts';
export function hasDraftContent(row: Revision<Entry>) {
  const value = row.value;
  return (
    !!row.revision ||
    !!value.title.trim() ||
    hasNoteContent(value.document) ||
    value.blocks.length > 0 ||
    !!value.description.trim() ||
    !!value.cover ||
    Object.values(value.fields).some(
      (value) => value !== undefined && value !== null && value !== '',
    )
  );
}
