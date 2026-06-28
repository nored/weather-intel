// Snapshot assembler. Fans out across the relevant source adapters, isolates
// failures (one dead feed never blanks the planet), stamps provenance on every
// feature, and merges everything into ONE global snapshot. A bbox only clips.

import { config } from '../config.js';
import { acquire } from './ratelimit.js';
import { clipFeatures } from './geo.js';
import { makeCtx } from './source-ctx.js';
import { resolveForSnapshot } from './sources/source-registry.js';
import { loadCredentials } from './llm-providers/provider-registry.js';

// domain -> snapshot.features key (plural collection name)
const FEATURE_KEY = {
  earthquake: 'earthquakes', tropical: 'storms', wildfire: 'wildfires',
  alerts: 'alerts', lightning: 'lightning', marine: 'marine', disaster: 'disasters',
};
// domain -> snapshot.tiles key
const TILE_KEY = { radar: 'radar', satellite: 'satellite', airquality: 'airquality', lightning: 'lightning' };

function stamp(fc, source, nowIso) {
  const features = fc?.features || [];
  for (const f of features) {
    f.properties = f.properties || {};
    f.properties.source = source;
    f.properties.fetchedAt = nowIso;
    if (f.properties.validTime === undefined) f.properties.validTime = f.properties.time ?? null;
  }
  return features;
}

// Bounded-concurrency pool.
async function pool(items, n, worker) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, run));
  return out;
}

// Assemble the global snapshot.
// opts: { domains?, bbox?, time?, creds?, onProgress?, signal? }
export async function assembleSnapshot(opts = {}) {
  const { domains, bbox = null, time = null, onProgress = null, signal = null } = opts;
  const creds = opts.creds || loadCredentials();
  const nowIso = new Date().toISOString();

  // Build the task list across the three capability kinds.
  const tasks = [];
  const wantDomain = (d) => !domains?.length || domains.includes(d);

  for (const a of resolveForSnapshot({ domains, bbox, capability: 'globalFeatures' }, creds))
    for (const d of a.domains) if (FEATURE_KEY[d] && wantDomain(d)) tasks.push({ a, kind: 'features', domain: d });

  for (const a of resolveForSnapshot({ domains, bbox, capability: 'frames' }, creds))
    for (const d of a.domains) if (TILE_KEY[d] && wantDomain(d)) tasks.push({ a, kind: 'frames', domain: d });

  for (const a of resolveForSnapshot({ domains, bbox, capability: 'summary' }, creds))
    for (const d of a.domains) if (wantDomain(d)) { tasks.push({ a, kind: 'summary', domain: d }); break; }

  const results = await pool(tasks, config.fanoutConcurrency, async (t) => {
    const start = Date.now();
    onProgress?.({ phase: 'fetch', source: t.a.id, domain: t.domain, status: 'start' });
    try {
      await acquire(t.a.id, t.a.rate?.perMin);
      const ctx = makeCtx(creds, signal);
      let value;
      if (t.kind === 'features') value = await t.a.getGlobal(t.domain, { bbox, time }, ctx);
      else if (t.kind === 'frames') value = await t.a.getFrames(t.domain, ctx);
      else value = await t.a.getSummary(ctx);
      const r = { t, ok: true, value, ms: Date.now() - start, stale: ctx._stale };
      onProgress?.({ phase: 'fetch', source: t.a.id, domain: t.domain, status: ctx._stale ? 'stale' : 'ok', ms: r.ms });
      return r;
    } catch (e) {
      onProgress?.({ phase: 'fetch', source: t.a.id, domain: t.domain, status: 'error', error: e.message });
      return { t, ok: false, error: e.message, ms: Date.now() - start };
    }
  });

  // Merge.
  const snapshot = {
    generatedAt: nowIso,
    bbox,
    tiles: {},
    features: {},
    sources: [],
    stats: {},
  };
  const byAdapter = new Map(); // id -> { status, ms, count, stale }

  const note = (id, patch) => {
    const cur = byAdapter.get(id) || { id, status: 'ok', ms: 0, count: 0 };
    byAdapter.set(id, { ...cur, ...patch, ms: cur.ms + (patch.ms || 0), count: cur.count + (patch.count || 0) });
  };

  for (const r of results) {
    const id = r.t.a.id, domain = r.t.domain;
    if (!r.ok) { note(id, { status: 'error', error: r.error, ms: r.ms }); continue; }

    if (r.t.kind === 'features') {
      const key = FEATURE_KEY[domain];
      const fc = clipFeatures(r.value, bbox) || { features: [] };
      const features = stamp(fc, id, nowIso);
      const coll = snapshot.features[key] || (snapshot.features[key] = { type: 'FeatureCollection', features: [], sources: [] });
      coll.features.push(...features);
      if (!coll.sources.includes(id)) coll.sources.push(id);
      note(id, { status: r.stale ? 'stale' : 'ok', count: features.length, ms: r.ms });
    } else if (r.t.kind === 'frames') {
      const key = TILE_KEY[domain];
      snapshot.tiles[key] = { ...r.value, source: id };
      note(id, { status: r.stale ? 'stale' : 'ok', count: r.value?.frames?.length || 0, ms: r.ms });
    } else { // summary
      const sumKey = r.t.a.summaryKey || domain;
      snapshot[sumKey] = { ...r.value, source: id };
      note(id, { status: r.stale ? 'stale' : 'ok', ms: r.ms });
    }
  }

  snapshot.sources = [...byAdapter.values()];
  snapshot.stats = {
    adaptersQueried: byAdapter.size,
    ok: snapshot.sources.filter(s => s.status === 'ok').length,
    stale: snapshot.sources.filter(s => s.status === 'stale').length,
    errors: snapshot.sources.filter(s => s.status === 'error').length,
    features: Object.values(snapshot.features).reduce((n, c) => n + c.features.length, 0),
    elapsedMs: Math.max(0, ...results.map(r => r.ms), 0),
  };
  return snapshot;
}
