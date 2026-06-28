// weather-intel — world map app. Loads the shared layer registry, draws one
// global snapshot (all of Earth's weather at once), animates the radar timeline,
// and lists live events. Tile layers are per-source (you can stack RainViewer +
// IEM + DWD radar, GIBS satellite, WAQI air quality); event layers are merged by
// domain (alerts from NWS + Meteoalarm together). Refreshes on an interval.

import { $, $$, el, clear, fmtAgo, mdToHtml } from './dom.mjs';
import * as Wx from './map.mjs';
import * as Markers from './markers.mjs';

const FEATURE_KEY = { earthquake: 'earthquakes', tropical: 'storms', alerts: 'alerts', wildfire: 'wildfires', disaster: 'disasters' };
const tileMapId = (t) => `t:${t.id}`;
const featMapId = (d) => `f:${d.domain}`;
const sid = (id) => id.replace(/[^\w-]/g, '_'); // DOM-id-safe (tile ids contain ':')

const state = {
  tiles: [],            // per-source tile layers
  domains: [],          // merged feature domains
  radar: { layerId: null, frames: [], idx: 0, playing: false, timer: null },
  refreshSecs: 60,
  bbox: null,
};

const api = (path) => fetch(path).then(r => r.json());

// --- split the shared registry into tile layers + feature domains -------
function splitLayers(layers) {
  const tiles = layers.filter(l => l.tile).map(l => ({
    id: l.id, source: l.source, domain: l.domain, title: l.title,
    animated: l.animated, tilesUrl: l.tilesUrl, opacity: l.opacity ?? 0.7,
    configured: l.configured, on: l.defaultOn && l.configured,
  })).sort((a, b) => (a.animated === b.animated ? 0 : a.animated ? 1 : -1));

  const byDomain = new Map();
  for (const l of layers.filter(l => l.feature)) {
    const cur = byDomain.get(l.domain) || { domain: l.domain, color: l.color, order: l.order, on: l.defaultOn };
    byDomain.set(l.domain, cur);
  }
  const order = ['alerts', 'tropical', 'wildfire', 'earthquake'];
  const domains = [...byDomain.values()].sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain));
  return { tiles, domains };
}

function applyDeepLink() {
  const p = new URLSearchParams(location.search);
  const on = (p.get('on') || '').split(',').filter(Boolean);
  const off = (p.get('off') || '').split(',').filter(Boolean);
  const hit = (set, t) => set.includes(t.domain) || set.includes(t.source) || set.includes(t.id);
  for (const t of state.tiles) { if (hit(on, t) && t.configured) t.on = true; if (hit(off, t)) t.on = false; }
  for (const d of state.domains) { if (on.includes(d.domain)) d.on = true; if (off.includes(d.domain)) d.on = false; }
}

// --- panel: Imagery (tiles) + Events (domains) -------------------------
function row(checked, color, label, suffixId, disabled) {
  const cb = el('input', { type: 'checkbox', ...(checked ? { checked: '' } : {}), ...(disabled ? { disabled: '' } : {}) });
  const dot = el('span', { class: 'dot', style: `background:${color}` });
  return { node: el('label', { class: 'layer' + (disabled ? ' off' : '') }, cb, dot, el('span', { class: 'lname' }, label), el('span', { class: 'count', id: suffixId }, '')), cb };
}

function buildPanel() {
  const list = clear($('#layers'));
  list.append(el('div', { class: 'lgroup' }, 'Imagery & tiles'));
  for (const t of state.tiles) {
    const r = row(t.on, t.color || '#2bd', t.title.replace(' — ', ' '), `tc-${sid(t.id)}`, !t.configured);
    r.cb.addEventListener('change', () => toggleTile(t, r.cb.checked));
    if (!t.configured) r.node.append(el('span', { class: 'needkey' }, 'key'));
    list.append(r.node);
  }
  list.append(el('div', { class: 'lgroup' }, 'Events'));
  for (const d of state.domains) {
    const r = row(d.on, d.color, d.domain, `fc-${d.domain}`, false);
    r.cb.addEventListener('change', () => toggleFeature(d, r.cb.checked));
    list.append(r.node);
  }
}

function toggleTile(t, on) { t.on = on; if (t.animated) Wx.setRadarVisible(tileMapId(t), on); else Wx.setLayerVisible(tileMapId(t), on); }
function toggleFeature(d, on) { d.on = on; Wx.setLayerVisible(featMapId(d), on); }

// --- snapshot load → draw + feeds --------------------------------------
async function loadSnapshot() {
  $('#status').textContent = 'loading…';
  const qs = state.bbox ? `?bbox=${state.bbox.join(',')}` : '';
  let snap;
  try { snap = await api('/api/world' + qs); }
  catch (e) { $('#status').textContent = 'error: ' + e.message; return; }

  // feature overlays (merged per domain)
  for (const d of state.domains) {
    const key = FEATURE_KEY[d.domain];
    const coll = (key && snap.features[key]) || { type: 'FeatureCollection', features: [] };
    Wx.addFeatureLayer(featMapId(d), d.domain, d.color, coll);
    Wx.setLayerVisible(featMapId(d), d.on);
    const c = $(`#fc-${d.domain}`); if (c) c.textContent = coll.features.length;
  }

  // animated radar layer — one raster layer per frame, switched by visibility.
  const radar = snap.tiles?.radar;
  const animTile = state.tiles.find(t => t.animated);
  if (radar?.frames?.length && animTile) {
    state.radar.layerId = tileMapId(animTile);
    // Only (re)build the frame layers when the timeline actually changed, so a
    // background refresh never disrupts in-progress playback.
    if (radar.latest !== state.radar.lastLatest) {
      state.radar.frames = radar.frames;
      state.radar.lastLatest = radar.latest;
      Wx.setRadarFrames(state.radar.layerId, radar.frames, animTile.opacity, 7);
      Wx.setRadarVisible(state.radar.layerId, animTile.on);
      if (!state.radar.playing) { state.radar.idx = radar.frames.length - 1; setupScrubber(); }
      else showFrame(state.radar.idx);
    }
    const tc = $(`#tc-${sid(animTile.id)}`); if (tc) tc.textContent = radar.frames.length + 'f';
  }

  renderFeeds(snap);
  renderStatus(snap);
}

// --- radar animation scrubber ------------------------------------------
function setupScrubber() {
  const s = $('#frame'); s.max = String(state.radar.frames.length - 1); s.value = String(state.radar.idx);
  showFrame(state.radar.idx);
}
function showFrame(i) {
  const r = state.radar;
  r.idx = Math.max(0, Math.min(i, r.frames.length - 1));
  const f = r.frames[r.idx]; if (!f || !r.layerId) return;
  Wx.showRadarFrame(r.layerId, r.idx);
  $('#frame').value = String(r.idx);
  $('#frametime').textContent = `${new Date(f.time).toLocaleTimeString()} ${f.nowcast ? '(nowcast)' : ''} ${r.idx === r.frames.length - 1 ? '· now' : ''}`;
}
function play() {
  const r = state.radar;
  r.playing = !r.playing;
  $('#play').textContent = r.playing ? '⏸' : '▶';
  if (r.playing) r.timer = setInterval(() => showFrame((r.idx + 1) % r.frames.length), 500);
  else clearInterval(r.timer);
}

// --- right-hand live event feeds ---------------------------------------
function feedItem(title, sub, onClick) {
  const node = el('div', { class: 'feed-item' }, el('div', { class: 'fi-title' }, title), el('div', { class: 'fi-sub' }, sub));
  node.addEventListener('click', onClick);
  return node;
}
function renderFeeds(snap) {
  const box = clear($('#feeds'));
  const f = snap.features || {};
  const section = (name) => box.append(el('h3', { class: 'feed-h' }, name));
  if (f.disasters?.features.length) {
    const ord = { Red: 0, Orange: 1, Green: 2 };
    section(`Disasters — GDACS (${f.disasters.features.length})`);
    const top = [...f.disasters.features].sort((a, b) => (ord[a.properties.alertLevel] ?? 3) - (ord[b.properties.alertLevel] ?? 3)).slice(0, 25);
    for (const d of top) {
      const p = d.properties, [lon, lat] = d.geometry?.coordinates || [];
      box.append(feedItem(`[${p.alertLevel}] ${p.kind} — ${p.country || ''}`, `${(p.name || '').slice(0, 70)} · ${p.source}`, () => lon != null && Wx.flyTo(lon, lat, 5)));
    }
  }
  if (f.storms?.features.length) {
    section(`Active cyclones (${f.storms.features.length})`);
    for (const s of f.storms.features) {
      const p = s.properties, [lon, lat] = s.geometry?.coordinates || [];
      box.append(feedItem(`${p.classification} ${p.name}`, `${p.intensityKt}kt · ${p.pressureMb}mb · ${p.source}`, () => lon != null && Wx.flyTo(lon, lat, 5)));
    }
  }
  if (f.wildfires?.features.length) {
    section(`Wildfire hotspots (${f.wildfires.features.length})`);
    const top = [...f.wildfires.features].sort((a, b) => (b.properties.frp ?? 0) - (a.properties.frp ?? 0)).slice(0, 20);
    for (const w of top) { const [lon, lat] = w.geometry.coordinates; box.append(feedItem(`FRP ${w.properties.frp ?? '?'}`, `${w.properties.confidence || ''} · ${w.properties.source}`, () => Wx.flyTo(lon, lat, 6))); }
  }
  if (f.alerts?.features.length) {
    section(`Alerts (${f.alerts.features.length})`);
    for (const a of f.alerts.features.slice(0, 40)) {
      const p = a.properties, c = a.geometry?.coordinates?.[0]?.[0];
      box.append(feedItem(`[${p.severity || '?'}] ${p.event}`, `${(p.areaDesc || p.country || '').slice(0, 70)} · ${p.source}`, () => Array.isArray(c) && Wx.flyTo(c[0], c[1], 6)));
    }
  }
  if (f.earthquakes?.features.length) {
    section(`Earthquakes (${f.earthquakes.features.length})`);
    const top = [...f.earthquakes.features].sort((a, b) => (b.properties.mag ?? -9) - (a.properties.mag ?? -9)).slice(0, 30);
    for (const q of top) { const p = q.properties, [lon, lat] = q.geometry?.coordinates || []; box.append(feedItem(`M${p.mag} ${p.place || ''}`, `${fmtAgo(p.time)} · ${p.depthKm}km · ${p.source}`, () => Wx.flyTo(lon, lat, 6))); }
  }
}

function renderStatus(snap) {
  const sw = snap.spaceWeather ? ` · Kp ${snap.spaceWeather.kpIndex ?? '?'}` : '';
  $('#status').innerHTML = snap.sources.map(s => `<span class="src ${s.status}">${s.id}</span>`).join(' ') +
    ` · ${snap.stats.features} features · <span class="live">● auto</span> updated ${new Date(snap.generatedAt).toLocaleTimeString()} (every ${state.refreshSecs}s)${sw}`;
}

// --- intel + settings panels -------------------------------------------
const CRED_FIELDS = [
  { key: 'firms_map_key', label: 'NASA FIRMS map key (wildfires)' },
  { key: 'waqi_token', label: 'WAQI token (air quality tiles)' },
  { key: 'openweather_api_key', label: 'OpenWeather API key' },
  { key: 'openaq_api_key', label: 'OpenAQ API key' },
  { key: 'anthropic_api_key', label: 'Anthropic API key (intel via API)' },
];

function wirePanels() {
  const show = (id, on) => $('#' + id).classList.toggle('hidden', !on);
  $('#intel-btn').addEventListener('click', () => show('intel-panel', $('#intel-panel').classList.contains('hidden')));
  $('#settings-btn').addEventListener('click', () => { const opening = $('#settings-panel').classList.contains('hidden'); show('settings-panel', opening); if (opening) renderSettings(); });
  $('#markers-btn').addEventListener('click', () => { const opening = $('#markers-panel').classList.contains('hidden'); show('markers-panel', opening); if (opening) renderMarkers(); });
  $('#marker-add').addEventListener('click', () => { const c = Wx.getMap().getCenter(); Markers.add({ lon: c.lng, lat: c.lat }); });
  Markers.setOnChange(renderMarkers);
  $$('[data-close]').forEach(b => b.addEventListener('click', () => show(b.dataset.close, false)));

  const runAnswer = async () => {
    const q = $('#intel-q').value.trim();
    if (!q) return;
    const out = $('#intel-out'); out.innerHTML = '<p class="muted">working it out (locate → forecast → answer, ~15–40s)…</p>';
    try {
      const r = await api('/api/answer?q=' + encodeURIComponent(q));
      const where = r.locations?.length ? `<div class="muted">for ${r.locations.map(l => `${l.name}, ${l.country}`).join('; ')}</div>` : '';
      out.innerHTML = where + (r.answer ? mdToHtml(r.answer) : `<p class="muted">no answer: ${r.error || 'unknown'}</p>`);
    } catch (e) { out.innerHTML = `<p class="muted">failed: ${e.message}</p>`; }
  };
  $('#intel-run').addEventListener('click', runAnswer);
  $('#intel-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnswer(); });

  if (location.hash === '#settings') { show('settings-panel', true); renderSettings(); }
  else if (location.hash === '#intel') show('intel-panel', true);
  else if (location.hash === '#markers') { show('markers-panel', true); renderMarkers(); }

  const form = clear($('#creds-form'));
  for (const f of CRED_FIELDS) form.append(el('label', { class: 'cred' }, f.label, el('input', { type: 'password', id: `cred-${f.key}`, placeholder: '••••••' })));
  $('#creds-save').addEventListener('click', async () => {
    const body = {};
    for (const f of CRED_FIELDS) { const v = $(`#cred-${f.key}`).value.trim(); if (v) body[f.key] = v; }
    if (!Object.keys(body).length) return;
    await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    $('#creds-msg').textContent = 'saved — reload to pick up new tile sources';
    renderSettings();
  });
}

async function renderSettings() {
  const box = clear($('#sources-list'));
  const { sources } = await api('/api/sources');
  for (const s of sources) {
    const badge = el('span', { class: 'src ' + (s.enabled ? 'ok' : (s.auth?.required ? 'error' : 'stale')) }, s.enabled ? 'on' : (s.auth?.required ? 'needs key' : 'off'));
    const test = el('button', { class: 'mini' }, 'test');
    const res = el('span', { class: 'muted' }, '');
    test.addEventListener('click', async () => { res.textContent = '…'; try { const r = await api('/api/sources/probe/' + s.id); res.textContent = r.ok ? '✓ ' + (r.detail || 'ok') : '✕ ' + r.error; } catch (e) { res.textContent = '✕ ' + e.message; } });
    box.append(el('div', { class: 'src-row' }, el('b', {}, s.id), el('span', { class: 'muted' }, ' [' + s.domains.join(',') + '] '), badge, test, res));
  }
}

// --- markers panel: list of saved pins, click to jump ------------------
function renderMarkers() {
  const box = clear($('#markers-list'));
  const ms = Markers.list();
  if (!ms.length) { box.append(el('p', { class: 'muted' }, 'No markers yet. Right-click the map to drop one.')); return; }
  for (const m of ms) {
    const go = el('div', { class: 'mk-go' },
      el('span', { class: 'dot', style: `background:${m.color}` }),
      el('span', { class: 'mk-name' }, m.name),
      el('span', { class: 'muted mk-co' }, `${m.lat.toFixed(2)}, ${m.lon.toFixed(2)} · z${m.zoom}`));
    go.addEventListener('click', () => Markers.jumpTo(m.id));
    const del = el('button', { class: 'mini' }, '✕');
    del.addEventListener('click', () => Markers.remove(m.id));
    box.append(el('div', { class: 'mk-row' }, go, del));
  }
}

// --- point weather (Open-Meteo) — shared by click-anywhere + markers ----
async function pointWeatherHtml(lat, lon) {
  try {
    const d = await api(`/api/point?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
    const c = d.current || {};
    const next = (d.hourly || []).find(h => (h.precipProb ?? 0) >= 50);
    return `<h4>${c.weather} · ${Math.round(c.temperatureC)}°C</h4>` +
      `<div>feels ${Math.round(c.feelsLikeC)}° · ${c.humidity}% RH</div>` +
      `<div>cloud ${c.cloudCoverPct}% · wind ${Math.round(c.windKmh)} km/h</div>` +
      `<div>precip now ${c.precipitationMm ?? 0} mm${next ? ` · ${next.precipProb}% by ${new Date(next.time).getHours()}:00` : ''}</div>` +
      `<div class="muted">${lat.toFixed(2)}, ${lon.toFixed(2)} · ${d.timezone || ''} · open-meteo</div>`;
  } catch (err) { return `<div class="muted">weather failed: ${err.message}</div>`; }
}

// --- click anywhere → "normal weather" here ----------------------------
function wirePointWeather() {
  const map = Wx.getMap();
  map.on('click', async (e) => {
    // If the click hit an event overlay, let its own popup handle it.
    const hits = map.queryRenderedFeatures(e.point).filter(h => String(h.source || '').startsWith('f:'));
    if (hits.length) return;
    const { lng, lat } = e.lngLat;
    const popup = new (window.maplibregl.Popup)({ maxWidth: '260px' })
      .setLngLat(e.lngLat).setHTML('<div class="pop"><b>loading weather…</b></div>').addTo(map);
    popup.setHTML(`<div class="pop pt">${await pointWeatherHtml(lat, lng)}</div>`);
  });
}

// --- bootstrap ----------------------------------------------------------
async function main() {
  await Wx.initMap('map');
  const { layers } = await api('/api/layers');
  Object.assign(state, splitLayers(layers));
  applyDeepLink();
  buildPanel();

  // Static (non-animated) tile overlays — satellite/IEM/DWD/WAQI — added under
  // the animated radar + feature layers, via the proxy or a direct WMS template.
  for (const t of state.tiles) {
    if (t.animated || !t.tilesUrl) continue;
    Wx.addRaster(tileMapId(t), t.tilesUrl, { opacity: t.opacity });
    Wx.setLayerVisible(tileMapId(t), t.on);
  }

  await loadSnapshot();
  wirePanels();
  wirePointWeather();
  Markers.initMarkers(Wx.getMap(), window.maplibregl, { weather: pointWeatherHtml });
  if (new URLSearchParams(location.search).get('autoplay')) play();

  $('#play').addEventListener('click', play);
  $('#frame').addEventListener('input', (e) => { if (state.radar.playing) play(); showFrame(+e.target.value); });
  $('#refresh').addEventListener('click', loadSnapshot);
  $('#lockview').addEventListener('change', (e) => {
    if (e.target.checked) { const b = Wx.getMap().getBounds(); state.bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(n => +n.toFixed(3)); }
    else state.bbox = null;
    $('#scope').textContent = state.bbox ? 'view' : 'whole Earth';
    loadSnapshot();
  });

  setInterval(loadSnapshot, state.refreshSecs * 1000);
}

main().catch(e => { document.body.append(el('pre', { class: 'fatal' }, 'init failed: ' + e.message)); });
