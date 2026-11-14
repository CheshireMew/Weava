export const response = (value: any, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
export const json = async (url: string) => {
  const result = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(25000),
  });
  if (!result.ok) throw new Error('HTTP ' + result.status);
  return result.json() as Promise<any>;
};
