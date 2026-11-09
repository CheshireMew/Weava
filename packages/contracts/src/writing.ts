import * as z from 'zod';

export const writingSnippetSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  source: z.string().max(200000),
  archived: z.boolean().default(false),
});
export type WritingSnippet = z.infer<typeof writingSnippetSchema>;
