import * as z from 'zod';

export const sidebarSchema = z.object({
  text: z.string().max(2000),
  links: z.array(z.object({ label: z.string().max(150), url: z.string().max(2048) })).max(100),
});
export type SiteSidebar = z.infer<typeof sidebarSchema>;
