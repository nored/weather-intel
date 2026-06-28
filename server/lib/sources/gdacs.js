// GDACS — Global Disaster Alert and Coordination System (UN/EC). One keyless
// global GeoJSON feed of current disasters: floods (FL), earthquakes (EQ),
// tropical cyclones (TC), volcanoes (VO), droughts (DR), wildfires (WF), with a
// Green/Orange/Red alert level. High-value OSINT situational layer.
//   https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP

import { registerSource } from './source-registry.js';

const URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP';
const TYPE = { EQ: 'earthquake', TC: 'cyclone', FL: 'flood', VO: 'volcano', DR: 'drought', WF: 'wildfire', TS: 'tsunami' };

registerSource({
  id: 'gdacs',
  title: 'GDACS',
  domains: ['disaster'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'GDACS (UN/EC)',
  capabilities: { globalFeatures: true },
  rate: { perMin: 20 },
  ttl: { features: 600 },

  isConfigured() { return true; },

  async getGlobal(domain, opts, ctx) {
    const fc = await ctx.fetch(URL, { ttl: this.ttl.features });
    const features = (fc.features || [])
      .filter(f => f.properties?.iscurrent !== false && f.geometry)
      .map(f => {
        const p = f.properties;
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            id: `${p.eventtype}${p.eventid}`,
            kind: TYPE[p.eventtype] || p.eventtype,
            name: p.eventname || p.name || p.description,
            alertLevel: p.alertlevel,        // Green | Orange | Red
            severity: p.alertscore,
            country: p.country,
            url: p.url?.report || p.url || null,
            onset: p.fromdate,
            validTime: p.fromdate || null,
          },
        };
      });
    return { type: 'FeatureCollection', features };
  },

  async probe(ctx) {
    const fc = await ctx.fetch(URL, { ttl: 120 });
    const red = (fc.features || []).filter(f => f.properties?.alertlevel === 'Red').length;
    return { detail: `${(fc.features || []).length} current events (${red} red)` };
  },
});
