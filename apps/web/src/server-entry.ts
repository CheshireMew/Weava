// Register the process-wide HTTP lifetime before the adapter starts listening,
// including its static responses and the first request that lazily loads SSR.
import '../../../packages/core/src/http-lifecycle.ts';
export * from '@astrojs/node/server.js';
