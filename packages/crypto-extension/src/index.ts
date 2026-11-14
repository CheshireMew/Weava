/** Business data extension; account data belongs to the site instance. */
import { cryptoState } from './state.ts';
import { sourceRefresher } from './refresh.ts';
import { cryptoRoutes } from './routes.ts';
import { cryptoBlocks } from './blocks.ts';
import { panels } from './panels.ts';
export default async function ({ site }: { site: { root: string } }) {
  const state = cryptoState(site.root),
    refresh = sourceRefresher(state);
  return {
    id: 'crypto-blacknico',
    apiVersion: 1,
    version: '1.0.0',
    label: 'Crypto 数据服务',
    migrationFiles: [],
    panels,
    schedules: [{ id: 'refresh-sources', intervalMs: 300000, run: refresh }],
    async start() {
      await refresh();
    },
    ...cryptoBlocks(state),
    route: cryptoRoutes(state),
  };
}
