// Central configuration for weather-intel. Env overrides everything; sane
// defaults otherwise. This is a planet-scale aggregator: the defaults assume the
// whole Earth, and the knobs here are mostly about how hard we hit upstream
// sources (rate, cache, concurrency, timeouts) — not about *what* to fetch.

const num = (name, def) => {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : def;
};
const list = (name, def) =>
  (process.env[name] ?? def).split(',').map(s => s.trim()).filter(Boolean);

export const config = {
  // --- Server ------------------------------------------------------------
  port: num('PORT', 8090),

  // --- LLM (optional, only used for `--synthesize` intel) ----------------
  // Default provider when a synthesis request doesn't specify one. Providers
  // are configured per-credential in data/credentials.json (see provider-registry).
  defaultProvider: process.env.LLM_PROVIDER || 'claude-cli',
  effort: process.env.EFFORT || 'high',

  // --- Sources -----------------------------------------------------------
  // Allow-list of adapter ids to enable. Empty = every registered adapter that
  // is configured (i.e. all keyless ones, plus any with credentials present).
  sources: list('SOURCES', ''),
  // A descriptive User-Agent is REQUIRED by several open feeds (NWS, met.no) and
  // polite for the rest. Override with a contact address for production use.
  userAgent: process.env.WI_USER_AGENT ||
    'weather-intel/0.1 (open weather situational-awareness; +https://github.com/nored/weather-intel)',

  // --- Fan-out / resilience ---------------------------------------------
  fanoutConcurrency: num('FANOUT_CONCURRENCY', 6),
  sourceTimeoutMs: num('SOURCE_TIMEOUT', 8000),

  // --- Caching (mandatory: global feeds are rate-limited, many clients) --
  cacheDir: process.env.CACHE_DIR || 'data/cache',
  cacheTtlDefault: num('CACHE_TTL', 600),     // seconds; per-op TTL overrides in adapters
  tilesCacheTtl: num('TILES_CACHE_TTL', 300), // seconds for proxied raster tiles

  // --- Background poller -------------------------------------------------
  // Keeps the whole-Earth snapshot warm so the default planet view is instant
  // and one assembly is shared across all clients. Set POLL_ENABLED=0 to disable.
  pollEnabled: !['0', 'false'].includes(process.env.POLL_ENABLED ?? '1'),
  pollIntervalSecs: num('POLL_INTERVAL', 90),
};
