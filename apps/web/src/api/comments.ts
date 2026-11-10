import { entryLabel,entryIdAtPath } from '../../../../packages/core/src/admin-content.ts';
import type { AdminHandlers, ApiServices } from './types.ts';
export function commentsHandlers(services: Pick<ApiServices, 'site' | 'engagement'>) {
  const { site, engagement } = services;

  return {
    comments: async ({query = {}}, context) => {
      const { url } = context;
      let entryId=query.entryId;
      if(query.path)entryId=entryIdAtPath(site,query.path)??'__missing__';
      const result = engagement.comments(
        url.searchParams.get('status') ?? 'all',
        Number(url.searchParams.get('page')) || 1,
        {query:query.q,author:query.author,entryId,start:query.start,end:query.end},
      );
      return {
        ...result,
        items: result.items.map((comment) => {
          return { ...comment, ...entryLabel(site, comment.entryId) };
        }),
      };
    },
    moderateComment: async ({ body: data }) => {
      return engagement.moderate(data.id, data.status);
    },
    moderateComments: async ({body}) => engagement.moderateMany(body.items,body.status),
    replyComment: async ({ body }, context) =>
      engagement.replyAsOwner(
        body.parentId,
        body.body,
        site.auth.account(context.cookies.get('weava-session')?.value ?? '').displayName,
        body.clientId,
      ),
  } satisfies Pick<AdminHandlers, 'comments' | 'moderateComment' | 'moderateComments' | 'replyComment'>;
}
