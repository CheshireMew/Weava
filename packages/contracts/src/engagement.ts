import * as z from 'zod';

export const commentSchema=z.object({
  id:z.string().min(1),entryId:z.string().min(1),author:z.string(),body:z.string(),createdAt:z.string(),
  status:z.enum(['visible','hidden','pending']).optional(),parentId:z.string().nullable().optional(),
  replyTo:z.string().nullable().optional(),isOwner:z.boolean().optional(),likes:z.number().int().min(0).optional(),liked:z.boolean().optional(),
});
export type ArticleComment=z.infer<typeof commentSchema>;
