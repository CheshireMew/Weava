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
/** Server deployments opt in; local development stays usable over loopback HTTP. */
export function assertRequestTransport(request:Request, secure:boolean, peer:string, localTool:boolean, required=process.env.WEAVA_REQUIRE_HTTPS==='1') {
  if(!required || secure) return;
  const path=new URL(request.url).pathname;
  if(['GET','HEAD'].includes(request.method) && ['/__health','/api/admin/v1/session'].includes(path))return;
  const address=peer.replace(/^::ffff:/,'');
  if(localTool && ['127.0.0.1','::1'].includes(address))return;
  throw new WeavaError('服务器只接受 HTTPS 请求，请通过网站的 HTTPS 地址访问。',403);
}
