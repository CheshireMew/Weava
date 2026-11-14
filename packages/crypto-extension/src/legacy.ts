/** Compatibility renderer and lifecycle for imported BlackNico sites. */
import { cryptoState } from './state.ts';
import { sourceRefresher } from './refresh.ts';
import { cryptoRoutes } from './routes.ts';
import { panels } from './panels.ts';
import { renderLegacy } from './legacy-render.ts';
import { legacyRoute } from './legacy-routes.ts';
export default async function (context: any) {
  const { site, analytics } = context,
    state = cryptoState(site.root);
  const refresh = sourceRefresher(state),
    route = cryptoRoutes(state, true);
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    id: 'crypto-blacknico',
    apiVersion: 1,
    themes: [{ id: 'crypto-blacknico', label: 'BlackNico' }],
    panels,
    start() {
      timer = setInterval(() => refresh(), 300000);
      timer.unref();
      void refresh();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    render: (entry: any, release: any) => renderLegacy(entry, release, context),
    async route(request: Request, release: any) {
      return (await legacyRoute(site.root, analytics, request, release)) ?? route(request, release);
    },
  };
}
