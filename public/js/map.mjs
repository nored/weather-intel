// MapLibre wrapper: world base map + raster tile overlays (radar/satellite) and
// GeoJSON event overlays (quakes/storms/alerts). maplibre-gl is loaded globally
// via a <script> tag (window.maplibregl).

const mlg = () => window.maplibregl;
let map = null;

const BASE_STYLE = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'base', type: 'raster', source: 'base' }],
};

export function initMap(container) {
  map = new (mlg().Map)({
    container,
    style: BASE_STYLE,
    center: [10, 30],
    zoom: 1.6,
    attributionControl: { compact: true },
    maxZoom: 12,
  });
  map.addControl(new (mlg().NavigationControl)({ showCompass: false }), 'top-left');
  // Resolve once the style is parsed (sources/layers can be added safely then) —
  // more reliable than the 'load' event, which can stall under software-GL/headless.
  return new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; res(map); } };
    map.on('load', go);
    const poll = setInterval(() => { if (map.isStyleLoaded && map.isStyleLoaded()) { clearInterval(poll); go(); } }, 100);
    setTimeout(() => { clearInterval(poll); go(); }, 6000); // hard fallback
  });
}

export const getMap = () => map;
export const flyTo = (lon, lat, zoom = 5) => map.flyTo({ center: [lon, lat], zoom, speed: 1.4 });

// --- raster (tile) overlays --------------------------------------------
export function addRaster(id, tilesUrl, { opacity = 0.7, maxzoom = 12 } = {}) {
  if (map.getSource(id)) return;
  map.addSource(id, { type: 'raster', tiles: [tilesUrl], tileSize: 256, maxzoom });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } });
}
export function setRasterTiles(id, tilesUrl) {
  const src = map.getSource(id);
  if (src && src.setTiles) src.setTiles([tilesUrl]);
}

// --- animated radar: one fixed-tile raster layer PER FRAME -------------
// Switching frames toggles visibility (cheap, no reload). This avoids calling
// setTiles() repeatedly, which hard-reloads the source and — at animation speed —
// floods MapLibre with tile aborts that can wedge the whole canvas.
const radarSets = {};

export function clearRadarFrames(baseId) {
  const set = radarSets[baseId];
  if (!set) return;
  for (let i = 0; i < set.count; i++) {
    const id = `${baseId}#${i}`;
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  delete radarSets[baseId];
}

export function setRadarFrames(baseId, frames, opacity = 0.7, maxzoom = 7) {
  clearRadarFrames(baseId);
  frames.forEach((f, i) => {
    const id = `${baseId}#${i}`;
    map.addSource(id, { type: 'raster', tiles: [f.urlTemplate], tileSize: 256, maxzoom });
    map.addLayer({ id, type: 'raster', source: id, layout: { visibility: 'none' }, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } });
  });
  radarSets[baseId] = { count: frames.length, current: -1, visible: true };
}

export function showRadarFrame(baseId, i) {
  const set = radarSets[baseId];
  if (!set) return;
  if (set.current >= 0 && set.current !== i) {
    const old = `${baseId}#${set.current}`;
    if (map.getLayer(old)) map.setLayoutProperty(old, 'visibility', 'none');
  }
  const cur = `${baseId}#${i}`;
  if (map.getLayer(cur)) map.setLayoutProperty(cur, 'visibility', set.visible ? 'visible' : 'none');
  set.current = i;
}

export function setRadarVisible(baseId, on) {
  const set = radarSets[baseId];
  if (!set) return;
  set.visible = on;
  if (set.current >= 0) {
    const cur = `${baseId}#${set.current}`;
    if (map.getLayer(cur)) map.setLayoutProperty(cur, 'visibility', on ? 'visible' : 'none');
  }
}
export function setOpacity(id, opacity) {
  if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', opacity);
}

// --- GeoJSON (event) overlays ------------------------------------------
const EMPTY = { type: 'FeatureCollection', features: [] };

// Paint presets per domain. Polygons get a translucent fill+outline; points a circle.
function addPointLayer(id, color, radiusExpr) {
  map.addLayer({
    id, type: 'circle', source: id,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': color,
      'circle-opacity': 0.75,
      'circle-radius': radiusExpr,
      'circle-stroke-color': '#000', 'circle-stroke-width': 0.5,
    },
  });
}
function addPolyLayers(id, color) {
  map.addLayer({ id: `${id}-fill`, type: 'fill', source: id,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: { 'fill-color': color, 'fill-opacity': 0.18 } });
  map.addLayer({ id: `${id}-line`, type: 'line', source: id,
    filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
    paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.7 } });
}

export function addFeatureLayer(id, domain, color, data = EMPTY) {
  if (map.getSource(id)) { setFeatureData(id, data); return; }
  map.addSource(id, { type: 'geojson', data });
  if (domain === 'earthquake') addPointLayer(id, color, ['interpolate', ['linear'], ['coalesce', ['get', 'mag'], 0], 0, 2, 8, 22]);
  else if (domain === 'tropical') addPointLayer(id, color, ['interpolate', ['linear'], ['coalesce', ['get', 'intensityKt'], 0], 0, 6, 140, 22]);
  else { addPolyLayers(id, color); addPointLayer(id, color, 5); }
  wireClicks(id);
}
export function setFeatureData(id, data) {
  const src = map.getSource(id);
  if (src) src.setData(data || EMPTY);
}
export function setLayerVisible(id, visible) {
  for (const lid of [id, `${id}-fill`, `${id}-line`]) {
    if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', visible ? 'visible' : 'none');
  }
}

// --- popups -------------------------------------------------------------
function wireClicks(id) {
  map.on('click', id, (e) => {
    const p = e.features?.[0]?.properties || {};
    const title = p.title || p.name || p.event || p.headline || 'feature';
    const rows = ['mag', 'place', 'classification', 'intensityKt', 'pressureMb', 'alertLevel', 'kind', 'severity', 'areaDesc', 'country', 'frp', 'time', 'validTime', 'expires', 'source']
      .filter(k => p[k] != null && p[k] !== '')
      .map(k => `<div><b>${k}</b>: ${String(p[k]).slice(0, 160)}</div>`).join('');
    new (mlg().Popup)({ closeButton: true, maxWidth: '320px' })
      .setLngLat(e.lngLat).setHTML(`<div class="pop"><h4>${title}</h4>${rows}</div>`).addTo(map);
  });
  map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
}
