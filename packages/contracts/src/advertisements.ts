import { z } from 'zod';

export const advertisementSlots = [
  { id: 'siteTop', label: '网页顶部' },
  { id: 'siteBottom', label: '网页底部' },
  { id: 'articleTop', label: '文章内顶部' },
  { id: 'articleBottom', label: '文章内底部' },
] as const;

export type AdvertisementPosition = (typeof advertisementSlots)[number]['id'];

const advertisementSchema = z.object({ enabled: z.boolean(), html: z.string() });
export const advertisementsSchema = z.object({
  siteTop: advertisementSchema.optional(),
  siteBottom: advertisementSchema.optional(),
  articleTop: advertisementSchema.optional(),
  articleBottom: advertisementSchema.optional(),
});
export type Advertisements = z.infer<typeof advertisementsSchema>;
