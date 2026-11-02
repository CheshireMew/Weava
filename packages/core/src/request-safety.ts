import { WeavaError } from '@weava/contracts';
/** Covers browser writes before extension dispatch; non-browser JSON/Bearer clients have no Origin. */
export function assertRequestOrigin(request: Request, protocol = new URL(request.url).protocol) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new WeavaError('请求来源无效。',403);
  const origin=request.headers.get('origin');
  if (!origin) return;
  // Astro deliberately substitutes localhost in Request.url when Host is not in
  // allowedDomains. Compare the wire authority only for CSRF; do not reuse it for URLs or proxy trust.
  const authority=request.headers.get('host')??new URL(request.url).host;
  if(/[\s/@\\?#]/.test(authority))throw new WeavaError('请求来源无效。',403);
  let target:URL;
  try { target=new URL(protocol+'//'+authority); } catch {throw new WeavaError('请求来源无效。',403);}
  let candidate:URL;
  try {candidate=new URL(origin);} catch {throw new WeavaError('请求来源无效。',403);}
  if(candidate.origin!==target.origin || candidate.href!==candidate.origin+'/') throw new WeavaError('请求来源无效。',403);
}
export function assertJsonRequest(request:Request) {
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))
    throw new WeavaError('请使用 JSON 格式提交请求。',415);
}
