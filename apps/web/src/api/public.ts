import { queryPublished, contentQuery } from '@weava/core';
import { publishedMetadata } from '../../../../packages/core/src/release-reader.ts';
import { WeavaError as DomainError, supportsDiscussion } from '@weava/contracts';

import { readJsonBody } from '@weava/core';

import { randomBytes } from 'node:crypto';

import type { ApiServices, AdminContext } from './types.ts';
import { json } from './transport.ts';
import { assertJsonRequest, assertRequestOrigin } from '../../../../packages/core/src/request-safety.ts';
export async function publicApi(
  services: Pick<ApiServices, 'site' | 'analytics' | 'engagement'> & {siteRenderer?:Promise<import('../../../../packages/core/src/site-render.ts').SiteRenderer|null>},
  context: AdminContext,
  route: string,
) {
  const { site, analytics, engagement } = services;
  const { request, url, cookies, identity } = context;
  const method = request.method;
  assertRequestOrigin(request,identity.protocol);
  if(method==='POST')assertJsonRequest(request);
  if (['v1/engagement', 'v1/like', 'v1/comment', 'v1/comment-like', 'v1/comment-captcha'].includes(route)) {
    const write = method === 'POST';
    if ((route === 'v1/engagement' && method !== 'GET') || (route !== 'v1/engagement' && !write))
      return json({ error: '请求方法无效。' }, 405);
    const data = write ? await readJsonBody(request, 16384) : null;
    const id = String(data?.id ?? url.searchParams.get('id') ?? '');
    const entry = site
      .visibleRelease()
      ?.entries.find((item) => item.id === id && supportsDiscussion(item));
    if (!entry) throw new DomainError('内容不存在。', 404);
    let reader = cookies.get('weava-reader')?.value ?? '';
    if (!/^[a-f0-9]{64}$/.test(reader)) {
      reader = randomBytes(32).toString('hex');
      cookies.set('weava-reader', reader, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: identity.secure,
        maxAge: 31536000,
      });
    }
    if (route === 'v1/engagement')
      return json(
        engagement.summary(
          id,
          reader,
          Number(url.searchParams.get('page')) || 1,
          url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'latest',
        ),
      );
    const network = identity.network;
    if(route==='v1/comment-like'){
      if(typeof data.liked!=='boolean'||typeof data.commentId!=='string')throw new DomainError('点赞状态无效。');
      return json(engagement.setCommentLike(id,data.commentId,reader,data.liked,network));
    }
    if (['v1/comment-captcha', 'v1/comment'].includes(route) && entry.allowComments === false)
      throw new DomainError('这篇内容已关闭新评论。', 403);
    if (route === 'v1/comment-captcha')
      return json(await engagement.createCaptcha(reader, network));
    if (route === 'v1/like') {
      if (typeof data.liked !== 'boolean') throw new DomainError('点赞状态无效。');
      return json(engagement.setLike(id, reader, data.liked, network));
    }
    const comment = engagement.postComment(
      id,
      reader,
      network,
      data,
      site.release()?.settings.commentModeration === false ? 'visible' : 'pending',
    );
    return json({ ...engagement.summary(id, reader), comment });
  }
  if (['v1/search', 'v1/content'].includes(route) && method === 'GET') {
    const query = contentQuery(url.searchParams);
    const result = queryPublished(site, query, route === 'v1/search');
    return json(
      result.items.map(publishedMetadata),
      200,
      {
        'X-Total-Count': String(result.total),
        'X-Total-Pages': String(result.pages),
        'X-Page': String(result.page),
        'X-Page-Size': String(result.pageSize),
      },
    );
  }

  if (route === 'v1/analytics' && method === 'POST') {
    if (request.headers.get('dnt') === '1' || cookies.get('weava-exclude')?.value === '1' ||
      site.authenticate(cookies.get('weava-session')?.value ?? '')) return json({ accepted: 0 });
    const ip = identity.network;
    return json(
      analytics.collect(
        await readJsonBody(request, 131072),
        request.headers.get('user-agent') ?? '',
        new Set(
          [...(site
            .visibleRelease()
            ?.entries.filter((e) => e.visibility !== 'private')
            .map((e) => e.path) ?? []),...((await services.siteRenderer)?.publicPaths()??[])],
        ),
        { ip, origin: url.origin, language: request.headers.get('accept-language') || '' },
      ),
    );
  }
}
