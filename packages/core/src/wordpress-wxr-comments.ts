import { WeavaError } from '@weava/contracts';
import { digest } from '../../runtime-common/src/identity.ts';
import type { Site } from './site.ts';
import type { convertWxr } from './wordpress-wxr-conversion.ts';
type WxrComment = ReturnType<typeof convertWxr>['comments'][number];
function existingComment(site: Pick<Site, 'store'>, comment: WxrComment, message: string) {
  const old = site.store.raw
    .prepare('SELECT entry_id,author,body,status,created_at FROM article_comments WHERE id=?')
    .get(comment.id) as
    | { entry_id: string; author: string; body: string; status: string; created_at: string }
    | undefined;
  if (
    old &&
    (old.entry_id !== comment.entryId ||
      old.author !== comment.author ||
      old.body !== comment.body ||
      old.status !== comment.status ||
      old.created_at !== comment.createdAt)
  )
    throw new WeavaError(message, 409, { id: comment.id });
  return !!old;
}
export function checkWxrComments(site: Pick<Site, 'store'>, comments: WxrComment[]) {
  const ids = new Set<string>();
  for (const comment of comments) {
    if (!/\d+$/.test(comment.id) || ids.has(comment.id))
      throw new WeavaError('来源评论编号缺失或重复。');
    ids.add(comment.id);
    existingComment(site, comment, '来源评论与已有评论不同，请先处理冲突，或选择不导入评论。');
  }
}
/** The caller owns the transaction, shared with content and media import. */
export function writeWxrComments(site: Pick<Site, 'store'>, comments: WxrComment[]) {
  let count = 0;
  for (const comment of comments) {
    if (existingComment(site, comment, '来源评论与已有评论不同，未写入导入内容。')) continue;
    site.store.raw
      .prepare('INSERT INTO article_comments VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        comment.id,
        comment.entryId,
        digest(comment.id),
        'wordpress-import',
        comment.id,
        comment.author,
        comment.body,
        comment.status,
        comment.createdAt,
      );
    count++;
  }
  return count;
}
