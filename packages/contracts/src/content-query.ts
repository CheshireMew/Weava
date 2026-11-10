export const contentSorts = [
  'relevance',
  'date',
  'oldest',
  'title',
  '-title',
  'publishedAt',
  '-publishedAt',
  'updatedAt',
  '-updatedAt',
] as const;
export type ContentSort = (typeof contentSorts)[number];
