/** Astro's wrapper is an identity function; keep the production middleware under test. */
export const defineMiddleware=<T>(handler:T)=>handler;
