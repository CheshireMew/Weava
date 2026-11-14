import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function cryptoState(root: string) {
  const read = (name: string, fallback: any = {}) => {
    const file = join(root, 'imports', name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  };
  const runtimeDir = join(root, 'extensions/state');

  const videoSources = read('video-sources.json').videos ?? {};
  const initialFeeds = read('exchange-announcements.json');
  const initialStocks = read('equity-catalog.json');
  const live = (name: string, seed: any) => {
    const file = join(runtimeDir, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : seed;
  };
  const feeds = live('announcements.json', initialFeeds),
    stocks = live('stocks.json', initialStocks);
  const write = (name: string, data: any) => {
    const file = join(runtimeDir, name);
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(file + '.pending', JSON.stringify(data));
    renameSync(file + '.pending', file);
  };
  return { root, read, feeds, stocks, videoSources, write };
}
export type CryptoState = ReturnType<typeof cryptoState>;
