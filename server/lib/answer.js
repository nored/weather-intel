// Question-answering pipeline — the agent step. Given ANY question, answer it
// from a weather angle: work out the location(s) it implies, geocode them, pull
// their forecast/observations, and have the LLM answer specifically. Indirectly
// weather-related questions ("will the vineyards near Bordeaux get frost?",
// "good day to sail in Sydney tomorrow?") all resolve to a place + forecast.
// When no place is implied, fall back to the global snapshot (state-of-the-planet).

import { complete, completeJson, loadCredentials } from './llm-providers/provider-registry.js';
import { makeCtx } from './source-ctx.js';
import { getSource } from './sources/source-registry.js';
import { assembleSnapshot } from './merge.js';
import { config } from '../config.js';

const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    locations: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, country: { type: 'string' } } },
    },
    aspect: { type: 'string' },     // the weather aspect implied (rain, frost, wind, heat, general…)
    isGlobal: { type: 'boolean' },  // true if the question is about Earth as a whole, not a place
  },
};

async function extractLocations(question, llm) {
  const system =
    'Extract the geographic location(s) the user is asking about and the weather aspect implied. ' +
    'Resolve indirect references to a place (e.g. "the marathon in Boston" -> Boston). ' +
    'IMPORTANT: a geocoder will look up each name, so resolve a state/region/country to a ' +
    'representative MAJOR CITY so it geocodes unambiguously — e.g. "California" -> {name:"Los Angeles", country:"United States"}; ' +
    '"Bavaria" -> {name:"Munich", country:"Germany"}; "Scotland" -> {name:"Glasgow", country:"United Kingdom"}. ' +
    'Keep a specific town as-is. Always include the country when known (e.g. "Hamilton, Canada" -> {name:"Hamilton", country:"Canada"}). ' +
    'If the question is about the whole planet or has no specific place, set isGlobal=true and locations=[]. JSON only.';
  try {
    const { data } = await completeJson({ ...llm, system, user: question, schema: EXTRACT_SCHEMA, maxTokens: 400 });
    return data || { locations: [] };
  } catch {
    return { locations: [] };
  }
}

async function geocodeName(name, countryHint, ctx) {
  const url = `${GEOCODE}?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
  let d;
  try { d = await ctx.fetch(url, { ttl: 86400 }); } catch { return null; }
  const res = d.results || [];
  if (!res.length) return null;
  let pick = res[0];
  if (countryHint) {
    const h = countryHint.toLowerCase();
    const m = res.find(r => (r.country || '').toLowerCase().includes(h) || (r.country_code || '').toLowerCase() === h);
    if (m) pick = m;
  }
  return { name: pick.name, admin1: pick.admin1, country: pick.country, lat: pick.latitude, lon: pick.longitude, timezone: pick.timezone };
}

// Compact global summary for the no-location (state-of-the-planet) fallback.
function globalSummary(snap) {
  const f = snap.features || {};
  const top = (c, key, n) => (c?.features || []).map(x => x.properties).sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9)).slice(0, n);
  return {
    generatedAt: snap.generatedAt,
    spaceWeather: snap.spaceWeather || null,
    earthquakes: f.earthquakes ? { count: f.earthquakes.features.length, top: top(f.earthquakes, 'mag', 8) } : null,
    storms: f.storms ? { count: f.storms.features.length, items: f.storms.features.map(x => x.properties) } : null,
    disasters: f.disasters ? { count: f.disasters.features.length, top: (f.disasters.features || []).map(x => x.properties).filter(p => p.alertLevel !== 'Green').slice(0, 15) } : null,
    alerts: f.alerts ? { count: f.alerts.features.length, top: (f.alerts.features || []).slice(0, 15).map(x => x.properties) } : null,
  };
}

// Answer ANY question from a weather angle. opts: { provider, fallback }.
export async function answerQuestion(question, opts = {}) {
  const provider = opts.provider || config.defaultProvider;
  const fallback = opts.fallback || [];
  if (provider === 'claude-cli' && !process.env.CLAUDE_CLI_ENABLED) process.env.CLAUDE_CLI_ENABLED = '1';
  const llm = { provider, fallback };
  const ctx = makeCtx(loadCredentials());
  const onProgress = opts.onProgress || null;

  onProgress?.({ phase: 'locate' });
  const ex = await extractLocations(question, llm);

  // --- place-specific path ---
  const places = [];
  for (const loc of (ex.locations || []).slice(0, 3)) {
    if (!loc?.name) continue;
    onProgress?.({ phase: 'geocode', name: loc.name });
    const g = await geocodeName(loc.name, loc.country, ctx);
    if (!g) { places.push({ query: loc.name, notFound: true }); continue; }
    let forecast = null;
    try { forecast = await getSource('open-meteo').queryPoint(g.lat, g.lon, ctx, { hours: 72 }); } catch {}
    places.push({ query: loc.name, name: g.name, admin1: g.admin1, country: g.country, lat: g.lat, lon: g.lon, timezone: g.timezone, forecast });
  }

  const resolved = places.filter(p => p.forecast);
  let answer;
  if (resolved.length) {
    onProgress?.({ phase: 'answer' });
    const data = resolved.map(p => ({
      location: `${p.name}${p.admin1 ? ', ' + p.admin1 : ''}, ${p.country}`,
      lat: p.lat, lon: p.lon, timezone: p.forecast.timezone,
      current: p.forecast.current, hourly: p.forecast.hourly, daily: p.forecast.daily,
    }));
    const system =
      'You are a weather-intelligence analyst. Answer the user question from a WEATHER angle using ' +
      'ONLY the forecast/observation data provided (Open-Meteo). Start with a one-line DIRECT answer, ' +
      'then the supporting detail. Be specific: concrete local times/dates, temperatures, mm of rain, ' +
      'probabilities. If the question is only indirectly about weather (crops, travel, an event), ' +
      'interpret which weather matters (frost, heat, rain, wind) and answer that. Times are in the ' +
      "location's timezone. Cite source (open-meteo) and the resolved location. Keep it tight.";
    const user = `Question: ${question}\n\nResolved weather data:\n${JSON.stringify(data)}` +
      (places.some(p => p.notFound) ? `\n\n(Could not geocode: ${places.filter(p => p.notFound).map(p => p.query).join(', ')})` : '');
    const r = await complete({ ...llm, system, user, maxTokens: 1200 });
    answer = r;
  } else {
    // --- global / state-of-the-planet fallback ---
    onProgress?.({ phase: 'global' });
    const snap = await assembleSnapshot({});
    const system =
      'You are a global weather-intelligence analyst. Answer the question from the planet-wide ' +
      'snapshot provided. If the user named a place but it could not be resolved, say so. Start with ' +
      'a one-line direct answer; rank by severity; cite source id and valid time. Keep it tight.';
    const user = `Question: ${question}\n\nGlobal snapshot:\n${JSON.stringify(globalSummary(snap))}` +
      (places.some(p => p.notFound) ? `\n\n(Could not geocode the place(s): ${places.filter(p => p.notFound).map(p => p.query).join(', ')})` : '');
    const r = await complete({ ...llm, system, user, maxTokens: 1200 });
    answer = r;
  }

  return {
    question,
    answer: answer.text,
    provider_used: answer.provider_used,
    locations: resolved.map(p => ({ name: p.name, admin1: p.admin1, country: p.country, lat: p.lat, lon: p.lon, timezone: p.timezone })),
    unresolved: places.filter(p => p.notFound).map(p => p.query),
    scope: resolved.length ? 'location' : 'global',
  };
}
