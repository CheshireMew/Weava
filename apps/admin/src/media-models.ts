import type { ApiOutput } from '@weava/contracts/api';
export type MediaRecord = ApiOutput<'mediaInfo'>;
export type MediaGroup = ApiOutput<'groups'>[number];
export type MediaReferences = ApiOutput<'mediaReferences'>;
