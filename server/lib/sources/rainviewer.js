// RainViewer — global precipitation radar mosaic (no key). We fetch the public
// weather-maps index, which lists past + nowcast frames; each frame becomes an
// animated tile layer for the map / the snapshot's radar timeline.
//   index: https://api.rainviewer.com/public/weather-maps.json
//   tile:  {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
// License/ToU not formally documented — fine for personal/OSINT; verify before
// commercial redistribution.

import { registerSource } from './source-registry.js';

const INDEX = 'https://api.rainviewer.com/public/weather-maps.json';
const SIZE = 256, COLOR = 2, OPTS = '1_1'; // scheme 2 (universal blue), smooth on, snow on

function framesFrom(index, kind) {
  const host = index.host;
  const sec = index[kind];
  if (!sec) return [];
  const groups = kind === 'radar' ? [...(sec.past || []), ...(sec.nowcast || [])]
    : [...(sec.infrared || [])];
  return groups.map(f => ({
    time: new Date(f.time * 1000).toISOString(),
    unix: f.time,
    nowcast: (sec.nowcast || []).includes(f),
    urlTemplate: `${host}${f.path}/${SIZE}/{z}/{x}/{y}/${COLOR}/${OPTS}.png`,
  }));
}

registerSource({
  id: 'rainviewer',
  title: 'RainViewer',
  domains: ['radar'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'RainViewer',
  capabilities: { frames: true, tileLayer: true, globalFeatures: false },
  rate: { perMin: 60 },
  ttl: { frames: 60 },

  isConfigured() { return true; },

  async getFrames(layer, ctx) {
    const index = await ctx.fetch(INDEX, { ttl: this.ttl.frames });
    const frames = framesFrom(index, 'radar');
    return {
      frames,
      latest: frames.length ? frames[frames.length - 1].time : null,
      tileSize: SIZE, minzoom: 0, maxzoom: 7,
      attribution: this.attribution,
    };
  },

  async probe(ctx) {
    const index = await ctx.fetch(INDEX, { ttl: 30 });
    if (!index?.host) throw new Error('no host in weather-maps index');
    return { detail: `radar frames: ${(index.radar?.past || []).length} past` };
  },
});
