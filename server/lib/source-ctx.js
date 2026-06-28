// Shared adapter context factory. Gives every adapter a caching `fetch` (that
// records stale-on-error), the configured User-Agent, credentials, and an abort
// signal. Used by merge.js (snapshot fan-out) and the tiles route (proxy).

import { config } from '../config.js';
import { cachedFetch } from './cache.js';

export function makeCtx(creds = {}, signal = null) {
  const ctx = { creds, signal, ua: config.userAgent, _stale: false };
  ctx.fetch = async (url, opts = {}) => {
    const r = await cachedFetch(url, { signal, ...opts });
    if (r.stale) ctx._stale = true;
    return r.body;
  };
  return ctx;
}
