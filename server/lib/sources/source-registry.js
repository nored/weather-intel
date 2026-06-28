// Registry of global weather/geophysical data sources — the heart of the system,
// mirroring the llm-providers registry pattern. Each adapter self-registers via
// registerSource(adapter); importing an adapter file is enough to enable it.
//
// An adapter declares which domains it serves, its coverage, auth, capabilities,
// rate limit and cache TTLs, and implements getGlobal / getFrames / getTiles.
// See _adapter.md for the full contract.

import { loadCredentials } from '../llm-providers/provider-registry.js';
import { config } from '../../config.js';

const sources = new Map();

export function registerSource(adapter) {
  if (!adapter?.id) throw new Error('source adapter needs an id');
  sources.set(adapter.id, adapter);
}
export function getSource(id) { return sources.get(id); }
export function allSources() { return [...sources.values()]; }

// Is the adapter enabled? Honors the SOURCES allow-list (empty = all) and the
// adapter's own isConfigured (keyless adapters are always configured).
function enabled(a, creds) {
  if (config.sources.length && !config.sources.includes(a.id)) return false;
  return a.isConfigured ? a.isConfigured(creds) : true;
}

// Does adapter coverage intersect the requested bbox? Global adapters always do;
// regional adapters (bbox coverage) are included only when no bbox is requested
// (whole planet) or the boxes overlap.
export function coverageHits(coverage, bbox) {
  if (!coverage || coverage.global) return true;
  if (!coverage.bbox) return true;
  if (!bbox) return true; // whole-planet request includes every regional source
  const [w, s, e, n] = coverage.bbox, [w2, s2, e2, n2] = bbox;
  return !(e2 < w || w2 > e || n2 < s || s2 > n);
}

// Pick adapters relevant to a snapshot request.
// sel: { domains?: string[], bbox?: [w,s,e,n], capability: 'globalFeatures'|'tileLayer'|'frames' }
export function resolveForSnapshot(sel, creds = loadCredentials()) {
  const { domains, bbox, capability = 'globalFeatures' } = sel;
  return allSources().filter(a =>
    enabled(a, creds) &&
    a.capabilities?.[capability] &&
    (!domains?.length || a.domains.some(d => domains.includes(d))) &&
    coverageHits(a.coverage, bbox));
}

// Catalog for /api/sources and the ⚙ panel.
export function listSources(creds = loadCredentials()) {
  return allSources().map(a => ({
    id: a.id,
    title: a.title || a.id,
    domains: a.domains,
    coverage: a.coverage,
    auth: a.auth || { required: false },
    capabilities: a.capabilities || {},
    attribution: a.attribution || null,
    configured: a.isConfigured ? a.isConfigured(creds) : true,
    enabled: enabled(a, creds),
  }));
}
