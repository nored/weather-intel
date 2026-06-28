// Meteoalarm (EUMETNET) — pan-European severe-weather warnings. Consumer feeds
// are per-country Atom (CAP underneath); the legacy RSS is being sunset, so we
// use the Atom feeds. CC-BY 4.0. This is a best-effort, dependency-free Atom
// parse: if a country's feed shape changes it errors for that source only and
// the rest of the planet still renders (see merge.js isolation).
//
// NOTE: per-country feed slugs are a known moving target — override the country
// list with WI_METEOALARM_COUNTRIES (comma ISO codes). Endpoint base is also
// overridable with WI_METEOALARM_BASE for when EUMETNET finalizes the new paths.

import { registerSource } from './source-registry.js';

const BASE = process.env.WI_METEOALARM_BASE || 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom';
const COUNTRIES = (process.env.WI_METEOALARM_COUNTRIES ||
  'germany,france,austria,switzerland,italy,spain,netherlands,belgium,poland,czechia,united-kingdom')
  .split(',').map(s => s.trim()).filter(Boolean);

// Extremely small Atom entry extractor (no XML dep). Pulls title/summary/updated/id.
function parseEntries(xml) {
  const entries = [];
  const re = /<entry[\s\S]*?<\/entry>/gi;
  const decode = (s) => s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#3[49];/g, "'").replace(/&apos;/g, "'");
  const get = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return null;
    return decode(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim()) || null;
  };
  for (const block of xml.match(re) || []) {
    entries.push({
      id: get(block, 'id'),
      title: get(block, 'title'),
      summary: get(block, 'summary') || get(block, 'content'),
      updated: get(block, 'updated'),
      // CAP fields embedded in the legacy Atom (best-effort).
      event: get(block, 'cap:event'),
      severity: get(block, 'cap:severity'),
      areaDesc: get(block, 'cap:areaDesc'),
      onset: get(block, 'cap:onset'),
      expires: get(block, 'cap:expires'),
    });
  }
  return entries;
}

registerSource({
  id: 'meteoalarm',
  title: 'Meteoalarm (EU)',
  domains: ['alerts'],
  coverage: { bbox: [-31, 34, 45, 72] }, // Europe
  auth: { required: false, credKey: null },
  attribution: 'Meteoalarm / EUMETNET',
  capabilities: { globalFeatures: true },
  rate: { perMin: 30 },
  ttl: { features: 180 },

  isConfigured() { return true; },

  async getGlobal(domain, opts, ctx) {
    const features = [];
    const errors = [];
    // Fetch countries in sequence-ish; each is independently cached.
    await Promise.all(COUNTRIES.map(async (country) => {
      try {
        // NB: this feed returns HTTP 406 for an explicit atom Accept header — let
        // fetch send its default */* (do not set Accept).
        const xml = await ctx.fetch(`${BASE}-${country}`, { ttl: this.ttl.features, as: 'text' });
        for (const e of parseEntries(xml)) {
          if (!e.title) continue;
          features.push({
            type: 'Feature',
            geometry: null, // CAP polygons live in linked resources; omitted in Phase 1
            properties: {
              id: e.id,
              country,
              event: e.event || e.title,
              severity: e.severity || null,
              areaDesc: e.areaDesc || null,
              headline: e.summary,
              onset: e.onset || null,
              expires: e.expires || null,
              validTime: e.updated || null,
            },
          });
        }
      } catch (e) { errors.push(`${country}: ${e.message}`); }
    }));
    // Only fail the whole source if EVERY country failed (likely a base-URL change).
    if (!features.length && errors.length === COUNTRIES.length) {
      throw new Error(`all Meteoalarm feeds failed (check WI_METEOALARM_BASE): ${errors[0]}`);
    }
    return { type: 'FeatureCollection', features };
  },

  async probe(ctx) {
    const xml = await ctx.fetch(`${BASE}-${COUNTRIES[0]}`, { ttl: 60, as: 'text' });
    return { detail: `${parseEntries(xml).length} entries for ${COUNTRIES[0]}` };
  },
});
