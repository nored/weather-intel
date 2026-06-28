// Programmatic API — the entry point for embedding weather-intel as a step in a
// larger pipeline. Importing this registers every source adapter and LLM
// provider, so consumers just import and call.
//
//   import { worldState } from '.../server/lib/api.js';
//   const snap = await worldState({ domains: ['radar','quakes'], bbox });
//   const snap = await worldState({ synthesize: true, question: 'anything notable?' });

// Register LLM providers (for optional synthesis).
import '../lib/llm-providers/claude.js';
import '../lib/llm-providers/openai-compat.js';
import '../lib/llm-providers/claude-cli.js';

// Register source adapters (side-effect imports — add new ones here).
import '../lib/sources/rainviewer.js';
import '../lib/sources/usgs-quakes.js';
import '../lib/sources/nhc.js';
import '../lib/sources/nws.js';
import '../lib/sources/meteoalarm.js';
import '../lib/sources/noaa-swpc.js';
import '../lib/sources/gibs.js';
import '../lib/sources/firms.js';
import '../lib/sources/iem-nexrad.js';
import '../lib/sources/dwd.js';
import '../lib/sources/waqi.js';
import '../lib/sources/gdacs.js';
import '../lib/sources/openweathermap.js';
import '../lib/sources/open-meteo.js';

import { assembleSnapshot } from './merge.js';
import { complete } from './llm-providers/provider-registry.js';
import { config } from '../config.js';

// CLI-friendly aliases so callers can say 'quakes' instead of 'earthquake'.
const DOMAIN_ALIAS = {
  quakes: 'earthquake', quake: 'earthquake', earthquakes: 'earthquake',
  storms: 'tropical', storm: 'tropical', cyclones: 'tropical', hurricanes: 'tropical',
  fires: 'wildfire', wildfires: 'wildfire',
  alert: 'alerts', warnings: 'alerts',
  space: 'spaceweather', sat: 'satellite', aq: 'airquality',
};
const normDomains = (d) => d?.length ? d.map(x => DOMAIN_ALIAS[x] || x) : d;

// Build the planet-wide situational snapshot.
// opts: { domains?, bbox?, time?, synthesize?, question?, provider?, fallback?, onProgress?, signal? }
export async function worldState(opts = {}) {
  const { synthesize = false, question = null, onProgress = null } = opts;
  let { provider = config.defaultProvider, fallback = [] } = opts;
  if (provider === 'claude-cli' && !process.env.CLAUDE_CLI_ENABLED) process.env.CLAUDE_CLI_ENABLED = '1';

  const snapshot = await assembleSnapshot({
    domains: normDomains(opts.domains),
    bbox: opts.bbox || null,
    time: opts.time || null,
    onProgress,
    signal: opts.signal || null,
  });

  if (synthesize) {
    onProgress?.({ phase: 'synthesize', status: 'start' });
    try {
      snapshot.intel = await buildIntel(snapshot, { question, provider, fallback });
      onProgress?.({ phase: 'synthesize', status: 'ok' });
    } catch (e) {
      snapshot.intel = { error: e.message, question };
      onProgress?.({ phase: 'synthesize', status: 'error', error: e.message });
    }
  }
  return snapshot;
}

// --- LLM intel synthesis -------------------------------------------------

function buildContext(snapshot) {
  const f = snapshot.features || {};
  const topBy = (coll, key, n) => (coll?.features || [])
    .map(x => x.properties).sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9)).slice(0, n);
  return {
    generatedAt: snapshot.generatedAt,
    bbox: snapshot.bbox,
    spaceWeather: snapshot.spaceWeather || null,
    radar: snapshot.tiles?.radar ? { latest: snapshot.tiles.radar.latest, frames: snapshot.tiles.radar.frames?.length } : null,
    earthquakes: f.earthquakes ? { count: f.earthquakes.features.length, top: topBy(f.earthquakes, 'mag', 10) } : null,
    storms: f.storms ? { count: f.storms.features.length, items: (f.storms.features || []).map(x => x.properties) } : null,
    alerts: f.alerts ? { count: f.alerts.features.length, top: (f.alerts.features || []).slice(0, 20).map(x => x.properties) } : null,
    wildfires: f.wildfires ? { count: f.wildfires.features.length } : null,
    sources: snapshot.sources,
  };
}

async function buildIntel(snapshot, { question, provider, fallback }) {
  const context = buildContext(snapshot);
  const scope = snapshot.bbox ? `the region bbox=[${snapshot.bbox.join(', ')}]` : 'planet Earth';
  const system =
    'You are a global weather-intelligence analyst. Summarize the most significant ' +
    'weather and geophysical events from ONLY the structured data provided. Rank by ' +
    'severity/impact. Cite the source id and valid time for each claim. Be concise and ' +
    'decision-oriented. If a relevant domain has no data or a source errored, say so.';
  const user =
    `Scope: ${scope}\n` +
    (question ? `Question: ${question}\n` : 'Question: What significant weather/geophysical activity is happening right now?\n') +
    `\nData (JSON):\n${JSON.stringify(context)}`;
  const { text, provider_used } = await complete({ provider, fallback, system, user, maxTokens: 1500 });
  return { answer: text, provider_used, question };
}
