import type { ApiServices, AdminHandlers } from './types.ts';
export function commentsHandlers(services: Pick<ApiServices, 'site' | 'engagement'>) {
  const { site, engagement } = services;

  return {
    comments: async ({}, context) => {
      const { url } = context;

      const result = engagement.comments(
        url.searchParams.get('status') ?? 'all',
        Number(url.searchParams.get('page')) || 1,
      );
      return {
        ...result,
        items: result.items.map((comment) => {
          const entry = site.store.get('entry', comment.entryId)?.value;
          return { ...comment, title: entry?.title ?? comment.entryId, path: entry?.path ?? '' };
        }),
      };
    },
    moderateComment: async ({ body: data }) => {
      return engagement.moderate(data.id, data.status);
    },
    replyComment:async ({body},context)=>engagement.replyAsOwner(body.parentId,body.body,site.auth.account(context.cookies.get('weava-session')?.value??'').displayName,body.clientId),
  } satisfies Pick<AdminHandlers, 'comments' | 'moderateComment' | 'replyComment'>;
}
