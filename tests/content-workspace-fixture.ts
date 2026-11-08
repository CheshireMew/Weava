import { typeSchema } from '@weava/contracts';
import type { ContentWorkspaceData } from '../apps/admin/src/content-models.ts';
export function contentWorkspaceFixture(input: {
  types: { id: string; value: Record<string, unknown> }[];
  settings?: { value: { name: string } };
}): ContentWorkspaceData {
  return {
    types: input.types.map((row) => ({
      id: row.id,
      revision: 1,
      updatedAt: '2026-11-05T00:00:00Z',
      value: typeSchema.parse({
        fields: [],
        label: row.id,
        pathPrefix: '/' + row.id + '/',
        ...row.value,
      }),
    })),
    terms: [],
    entries: [],
    layouts: [],
    fieldWidgets: {},
    extensionBlocks: [],
    extensionBlockDefinitions: {},
    contentViews: [],
    schedules: [],
    author: { name: input.settings?.value.name ?? '', logo: '' },
  };
}
