import { isIP } from 'node:net';
const address = (value: string) => value.startsWith('::ffff:') ? value.slice(7) : value;
export interface ProxyPolicy { enabled: boolean; trusted: string[] }
export function proxyPolicy(env: NodeJS.ProcessEnv = process.env): ProxyPolicy {
  return {enabled:env.WEAVA_TRUST_PROXY==='1',trusted:(env.WEAVA_TRUSTED_PROXIES??'127.0.0.1,::1').split(',').map(value=>address(value.trim())).filter(value=>!!isIP(value))};
}
/** A forwarding header is usable only from an explicitly trusted peer. */
export function requestIdentity(request: Request, peer: string, policy: ProxyPolicy = proxyPolicy()) {
  let network = address(peer), protocol = new URL(request.url).protocol;
  if (policy.enabled && policy.trusted.includes(network)) {
    const chain = (request.headers.get('x-forwarded-for')??'').split(',').map(value=>address(value.trim()));
    if (chain.every(value=>!!isIP(value))) {
      for (let index=chain.length-1;index>=0 && policy.trusted.includes(network);index--) network=chain[index];
    }
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
    if (forwarded==='https' || forwarded==='http') protocol=forwarded+':';
  }
  return {network:network||'unknown',secure:protocol==='https:',protocol};
}
