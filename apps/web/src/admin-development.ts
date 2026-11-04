import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

const key = Symbol.for('weava.admin-development');
interface AdminDevelopment { server: ViteDevServer; root: string }
const registry = globalThis as unknown as Record<symbol, AdminDevelopment | undefined>;

/** Share the site's origin, API and session while serving the admin directly from source. */
export function adminDevelopmentPlugin(): Plugin {
  return {
    name: 'weava-admin-development',
    apply: 'serve',
    async configureServer(siteServer) {
      const framework = fileURLToPath(new URL('../../../', import.meta.url));
      const root = join(framework, 'apps/admin');
      const server = await createServer({
        root,
        configFile: join(root, 'vite.config.ts'),
        base: '/_admin/',
        appType: 'custom',
        cacheDir: join(framework, 'node_modules/.vite/admin'),
        server: {
          middlewareMode: true,
          ws: { server: siteServer.httpServer!, path: 'hmr' },
        },
      });
      const development = { server, root };
      registry[key] = development;
      siteServer.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/_admin/')) server.middlewares(request, response, next);
        else next();
      });
      siteServer.httpServer?.once('close', () => {
        if (registry[key] === development) delete registry[key];
        void server.close();
      });
    },
  };
}

export async function adminDevelopmentHtml(url: string) {
  const development = registry[key];
  if (!development) throw new Error('后台开发服务尚未就绪。');
  const html = await readFile(join(development.root, 'index.html'), 'utf8');
  return development.server.transformIndexHtml(url, html);
}
