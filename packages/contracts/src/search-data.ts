import { z } from 'zod';
const validDatasetDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const date = z.string().refine(validDatasetDate, '需要有效的 YYYY-MM-DD 日期');
const count = z.number().int().min(0), url = z.url().refine((value) => /^https?:\/\//.test(value));
const performanceRow = z.object({ url, entryId: z.string().optional(), date, query: z.string().optional(), country: z.string().optional(), device: z.string().optional(),
  clicks: count, impressions: count, position: z.number().min(0).optional() }).strict().refine((row) => row.clicks <= row.impressions, '点击数不能超过展示数');
const observationRow = z.object({ id: z.string().min(1), platform: z.string().min(1), model: z.string().min(1), query: z.string().min(1),
  answer: z.string(), citations: z.array(url).max(100), observedAt: z.iso.datetime({ offset: true }), locale: z.string().min(2),
  collectionMethod: z.enum(['browser', 'api', 'manual']), panelVersion: z.string().min(1), status: z.enum(['answered', 'failed']) }).strict();
const rankRow = z.object({ url: url.optional(), keyword: z.string().min(1), country: z.string(), device: z.string(), date,
  rank: z.number().int().positive().nullable(), searchVolume: count.optional() }).strict();
const analyticsRow = z.object({ url, date, sessions: count, keyEvents: z.number().min(0), channel: z.string() }).strict();
const common = { version: z.literal(1), id: z.string().min(1).max(200), provider: z.string().min(1).max(100),
  property: z.string().min(1).max(2000), start: date, end: date, collectedAt: z.iso.datetime({ offset: true }),
  language: z.string().optional(), expectedSamples: z.number().int().positive().optional(), notes: z.string().max(5000).optional() };
export const searchDatasetSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('search-performance'), rows: z.array(performanceRow).max(10000) }).strict(),
  z.object({ ...common, kind: z.literal('ai-observations'), rows: z.array(observationRow).max(10000) }).strict(),
  z.object({ ...common, kind: z.literal('keyword-rank'), rows: z.array(rankRow).max(10000) }).strict(),
  z.object({ ...common, kind: z.literal('web-analytics'), rows: z.array(analyticsRow).max(10000) }).strict(),
]);
export type SearchDataset = z.infer<typeof searchDatasetSchema>;
