import { z } from 'zod';
export const publicationActionSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  action: z.enum(['publish', 'withdraw']),
});
export const publicationPlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  dueAt: z.string().optional(),
  actions: z
    .array(publicationActionSchema.extend({ title: z.string().optional() }))
    .min(1)
    .max(200),
});
export const publicationPlanInputSchema = publicationPlanSchema.extend({
  actions: z.array(publicationActionSchema).min(1).max(200),
});
export const publicationPlanValueSchema = publicationPlanSchema.extend({
  status: z.enum(['draft', 'scheduled', 'failed', 'complete', 'cancelled']),
  attempts: z.number(),
  createdAt: z.string(),
  releaseId: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type PublicationPlanInput = z.infer<typeof publicationPlanInputSchema>;
