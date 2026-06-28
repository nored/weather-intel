// NOAA SWPC — space weather (global by nature). Provides a scalar summary that
// lands at snapshot.spaceWeather rather than a feature collection. No key,
// public domain. https://services.swpc.noaa.gov

import { registerSource } from './source-registry.js';

const KP = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const SCALES = 'https://services.swpc.noaa.gov/products/noaa-scales.json';

registerSource({
  id: 'noaa-swpc',
  title: 'NOAA SWPC',
  domains: ['spaceweather'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'NOAA SWPC',
  capabilities: { summary: true },
  summaryKey: 'spaceWeather',
  rate: { perMin: 30 },
  ttl: { summary: 300 },

  isConfigured() { return true; },

  async getSummary(ctx) {
    // Kp index: array of {time_tag, Kp, ...}; last entry is the latest reading.
    // (Some SWPC products use array-of-arrays with a header row — handle both.)
    const kp = await ctx.fetch(KP, { ttl: this.ttl.summary });
    const last = Array.isArray(kp) && kp.length ? kp[kp.length - 1] : null;
    const kpVal = last ? (Array.isArray(last) ? Number(last[1]) : Number(last.Kp ?? last.kp_index)) : null;
    const kpTag = last ? (Array.isArray(last) ? last[0] : last.time_tag) : null;
    const out = {
      kpIndex: Number.isFinite(kpVal) ? kpVal : null,
      kpTime: kpTag ? new Date(kpTag.replace(' ', 'T') + (kpTag.endsWith('Z') ? '' : 'Z')).toISOString() : null,
      validTime: kpTag,
    };
    // NOAA G/S/R scales (current conditions) — optional, tolerated if it fails.
    try {
      const scales = await ctx.fetch(SCALES, { ttl: this.ttl.summary });
      const cur = scales['0'] || scales[0];
      if (cur) out.scales = { geomagnetic: cur.G?.Scale ?? null, solarRadiation: cur.S?.Scale ?? null, radioBlackout: cur.R?.Scale ?? null };
    } catch {}
    return out;
  },

  async probe(ctx) {
    const kp = await ctx.fetch(KP, { ttl: 60 });
    const last = kp[kp.length - 1];
    return { detail: `Kp ${last?.[1]} @ ${last?.[0]}` };
  },
});
