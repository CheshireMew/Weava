export function normalize(input: string, config: any, equity = false) {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  const host = u.hostname.replace(/^www\./, '');
  let provider =
    host === 'binance.com'
      ? 'binance'
      : host === 'okx.com'
        ? 'okx'
        : host === 'bitget.com'
          ? 'bitget'
          : host === 'web3.binance.com'
            ? 'binance-web3'
            : host === 'web3.okx.com'
              ? 'okx-web3'
              : null;
  if (!provider) return input;
  if (!equity && /\/(web3|wallet|web3-wallet)(\/|$)/i.test(u.pathname) && provider === 'okx')
    provider = 'okx-web3';
  const entry = config.referrals?.[provider];
  if (!entry) return input;
  if (/\/(join|register|registration|signup|referral|joindex)(\/|$)/i.test(u.pathname))
    return entry.url;
  const key =
    provider === 'bitget' ? 'clacCode' : equity && provider === 'okx' ? 'channelId' : 'ref';
  if (!u.pathname.startsWith('/api/') && !u.pathname.startsWith('/bapi/')) {
    u.searchParams.delete('ref');
    u.searchParams.set(key, entry.code);
  }
  return u.href;
}
export function configFor(release: any) {
  return release?.settings.extensions.crypto?.config ?? {};
}
export const providerLabels: Record<string, string> = {
  binance: '币安',
  okx: 'OKX',
  bitget: 'Bitget',
  'binance-web3': '币安 Web3 钱包',
  'okx-web3': 'OKX Web3 钱包',
};
