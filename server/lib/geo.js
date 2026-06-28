// Small geo helpers. bbox is always [west, south, east, north] in degrees.

export function parseBbox(str) {
  if (!str) return null;
  const p = String(str).split(',').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isFinite(n))) return null;
  return p; // [w, s, e, n]
}

export function pointInBbox(lon, lat, bbox) {
  if (!bbox) return true;
  const [w, s, e, n] = bbox;
  return lon >= w && lon <= e && lat >= s && lat <= n;
}

// Rough test: does a GeoJSON geometry fall within bbox? Points are exact; other
// geometries pass if ANY coordinate is inside (good enough for clip-to-view).
function geomInBbox(geom, bbox) {
  if (!bbox || !geom) return true;
  const coords = [];
  (function walk(c) {
    if (typeof c?.[0] === 'number') coords.push(c);
    else if (Array.isArray(c)) c.forEach(walk);
  })(geom.coordinates);
  return coords.some(([lon, lat]) => pointInBbox(lon, lat, bbox));
}

// Clip a FeatureCollection to a bbox (returns a new FC). null bbox = unchanged.
export function clipFeatures(fc, bbox) {
  if (!bbox || !fc?.features) return fc;
  return { ...fc, features: fc.features.filter(f => geomInBbox(f.geometry, bbox)) };
}
