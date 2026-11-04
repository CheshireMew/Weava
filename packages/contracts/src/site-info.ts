import * as z from 'zod';

const path = z.string().startsWith('/').max(500);
export const siteInfoSchema = z.object({
  about: z.object({ enabled: z.boolean(), path, entryId: z.string().optional(), text: z.string().max(50000) }).optional(),
  friends: z.object({ enabled: z.boolean(), path, entryId: z.string().optional(), links: z.array(z.object({
    name: z.string().max(150), url: z.string().max(2048), description: z.string().max(1000),
  })).max(200) }).optional(),
});
export type SiteInfo = z.infer<typeof siteInfoSchema>;
