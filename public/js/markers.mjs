// User markers — drop a pin anywhere, name it, give it a color + saved zoom,
// then jump back to it: clicking a marker centers the map at its saved zoom and
// shows the live weather for that spot. Persisted in localStorage so they survive
// reloads AND the background auto-refresh. Rendered as maplibre DOM markers,
// independent of the data layers, so a snapshot refresh never touches them.

import { el } from './dom.mjs';

const KEY = 'wx_markers';
const COLORS = ['#2bd', '#e8b84a', '#e8674a', '#7ee84a', '#c14ae8', '#4a9ae8', '#ffffff', '#ff5fa2'];

let map = null, mlg = null, weatherFn = null;
let markers = load();
const rendered = new Map(); // id -> maplibregl.Marker
let curPopup = null;
let onChange = () => {};

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function persist() { localStorage.setItem(KEY, JSON.stringify(markers)); onChange(); }
const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const get = (id) => markers.find(m => m.id === id);

export function initMarkers(mapInstance, maplibre, opts = {}) {
  map = mapInstance; mlg = maplibre; weatherFn = opts.weather || null;
  for (const m of markers) draw(m);
  // Right-click (or long-press) the map → drop a marker right there.
  map.on('contextmenu', (e) => add({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
}

export const setOnChange = (fn) => { onChange = fn; };
export const list = () => markers;

export function add({ lon, lat, name, zoom }) {
  const m = {
    id: uid(),
    name: name || `Marker ${markers.length + 1}`,
    lon: +lon.toFixed(4), lat: +lat.toFixed(4),
    zoom: Math.round(zoom || Math.max(map.getZoom(), 5)),
    color: COLORS[markers.length % COLORS.length],
  };
  markers.push(m);
  persist();
  draw(m);
  openPopup(m);
  return m;
}

export function remove(id) {
  markers = markers.filter(m => m.id !== id);
  const mk = rendered.get(id);
  if (mk) { mk.remove(); rendered.delete(id); }
  if (curPopup) { curPopup.remove(); curPopup = null; }
  persist();
}

export function rename(id, name) {
  const m = get(id);
  if (!m || !name) return;
  m.name = name; persist();
  const mk = rendered.get(id);
  if (mk) mk.getElement().title = name + ' — drag to reposition';
}

export function setColor(id, color) {
  const m = get(id);
  if (!m) return;
  m.color = color; persist();
  const mk = rendered.get(id);
  if (mk) mk.getElement().style.setProperty('--mc', color);
}

export function setZoom(id, zoom) {
  const m = get(id);
  if (!m || !Number.isFinite(zoom)) return;
  m.zoom = Math.max(1, Math.min(12, Math.round(zoom)));
  persist();
}

// Move a marker to exact coordinates (from the popup's lat/lon fields).
function moveTo(id, lat, lon) {
  const m = get(id);
  if (!m || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  m.lat = +lat.toFixed(4); m.lon = +lon.toFixed(4);
  const mk = rendered.get(id); if (mk) mk.setLngLat([m.lon, m.lat]);
  map.flyTo({ center: [m.lon, m.lat], speed: 1.2 });
  persist();
}

// The "shortcut": center at the marker's saved zoom and open its menu (weather).
export function jumpTo(id) {
  const m = get(id);
  if (!m) return;
  map.flyTo({ center: [m.lon, m.lat], zoom: m.zoom, speed: 1.4 });
  openPopup(m);
}

function draw(m) {
  const pin = el('div', { class: 'wx-marker', title: m.name + ' — drag to reposition' });
  pin.style.setProperty('--mc', m.color);
  const mk = new mlg.Marker({ element: pin, anchor: 'center', draggable: true }).setLngLat([m.lon, m.lat]).addTo(map);
  // Click centers + opens the menu — but suppress it when the click was a drag.
  let dragged = false;
  mk.on('dragstart', () => { dragged = true; });
  mk.on('dragend', () => {
    const ll = mk.getLngLat();
    m.lon = +ll.lng.toFixed(4); m.lat = +ll.lat.toFixed(4);
    persist();
    openPopup(m);
    setTimeout(() => { dragged = false; }, 0);
  });
  pin.addEventListener('click', (ev) => { ev.stopPropagation(); if (!dragged) jumpTo(m.id); });
  rendered.set(m.id, mk);
}

// The per-marker shortcut menu: name, live weather, color, zoom, exact coords.
function openPopup(m) {
  if (curPopup) curPopup.remove();

  const name = el('input', { class: 'wx-mk-name', value: m.name });
  name.addEventListener('change', () => rename(m.id, name.value.trim()));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

  // Live weather for this spot (centered at the marker's saved zoom on click).
  const wx = el('div', { class: 'wx-mk-wx muted' }, 'loading weather…');
  if (weatherFn) weatherFn(m.lat, m.lon).then(html => { wx.innerHTML = html; }).catch(() => { wx.textContent = 'weather unavailable'; });
  else wx.remove();

  // Color swatches.
  const swatches = el('div', { class: 'wx-mk-sw' });
  for (const c of COLORS) {
    const b = el('button', { class: 'wx-mk-swb' + (c === m.color ? ' on' : ''), style: `background:${c}`, title: c });
    b.addEventListener('click', () => { setColor(m.id, c); openPopup(m); });
    swatches.append(b);
  }

  // Saved zoom (used when you jump to this marker) + grab the current view.
  const zoom = el('input', { class: 'wx-mk-num', type: 'number', min: '1', max: '12', step: '1', value: Math.round(m.zoom) });
  zoom.addEventListener('change', () => setZoom(m.id, parseInt(zoom.value, 10)));
  const useView = el('button', { class: 'wx-mk-mini', title: 'use the current map zoom' }, 'current');
  useView.addEventListener('click', () => { setZoom(m.id, map.getZoom()); zoom.value = String(Math.round(map.getZoom())); });

  // Exact coordinates.
  const latIn = el('input', { class: 'wx-mk-num', type: 'number', step: 'any', value: m.lat });
  const lonIn = el('input', { class: 'wx-mk-num', type: 'number', step: 'any', value: m.lon });
  const applyCoords = () => moveTo(m.id, parseFloat(latIn.value), parseFloat(lonIn.value));
  for (const f of [latIn, lonIn]) {
    f.addEventListener('change', applyCoords);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCoords(); });
  }

  const del = el('button', { class: 'wx-mk-del' }, 'delete');
  del.addEventListener('click', () => remove(m.id));

  const body = el('div', { class: 'wx-mk-pop' },
    el('div', { class: 'wx-mk-row' }, el('span', { class: 'dot', style: `background:${m.color}` }), name),
    wx,
    el('div', { class: 'wx-mk-cap' }, 'color'),
    swatches,
    el('div', { class: 'wx-mk-row' },
      el('label', { class: 'wx-mk-lbl' }, 'zoom', zoom), useView),
    el('div', { class: 'wx-mk-row' },
      el('label', { class: 'wx-mk-lbl' }, 'lat', latIn),
      el('label', { class: 'wx-mk-lbl' }, 'lon', lonIn)),
    el('div', { class: 'wx-mk-row' }, del, el('span', { class: 'muted' }, 'drag the pin to move')));

  curPopup = new mlg.Popup({ closeButton: true, maxWidth: '270px' })
    .setLngLat([m.lon, m.lat]).setDOMContent(body).addTo(map);
}
