// Turns the raw OSM tiles (data/cache/osm) + terrain into the compact map the game loads:
// public/data/sf/map.json. Generated; do not edit the output by hand.
// Map data © OpenStreetMap contributors, ODbL. Elevation: AWS Terrain Tiles / USGS 3DEP.
import fs from 'node:fs';
import path from 'node:path';
import { project } from '../src/city/region.js';
import { encodeMap } from '../src/city/mapdata.js';

const SRC = 'data/cache/osm';
const OUT = 'public/data/sf';

// ---- terrain (to anchor bridges and lift piers) ----
const T = JSON.parse(fs.readFileSync(path.join(OUT, 'terrain.json')));
const tbuf = fs.readFileSync(path.join(OUT, 'terrain.bin'));
const tgrid = new Int16Array(tbuf.buffer, tbuf.byteOffset, tbuf.byteLength / 2);
function ground(x, z) {
  const fx = (x - T.minX) / T.cell, fz = (z - T.minZ) / T.cell;
  const i = Math.max(0, Math.min(T.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(T.nz - 2, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
  const g = (a, b) => tgrid[b * T.nx + a] * T.scale;
  return g(i, j) * (1 - u) * (1 - v) + g(i + 1, j) * u * (1 - v) + g(i, j + 1) * (1 - u) * v + g(i + 1, j + 1) * u * v;
}

// ---- load + dedupe ----
const elements = new Map();
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.json') || f === 'routes.json') continue;
  for (const e of JSON.parse(fs.readFileSync(path.join(SRC, f))).elements) elements.set(e.type[0] + e.id, e);
}
console.log(elements.size, 'elements');

const ring = geom => {
  const out = [];
  for (const g of geom) { if (!g) continue; const [x, z] = project(g.lat, g.lon); out.push(x, z); }
  return out;
};
const closed = p => p.length >= 8 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1];
const open = p => (closed(p) ? p.slice(0, -2) : p);
function area(p) { let a = 0; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }
function ccw(p) { return area(p) < 0 ? reverse(p) : p; } // positive area in x/z = clockwise seen from above (z points south); normalise
function reverse(p) { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; }
function centroid(p) { let x = 0, z = 0; const n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; }
function inside(x, z, p) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function bbox(p) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; }

// Joins multipolygon member ways into closed rings.
function rings(members, role) {
  const parts = members.filter(m => m.type === 'way' && m.geometry && (m.role || 'outer') === role).map(m => m.geometry.filter(Boolean).map(g => [g.lat, g.lon]));
  const out = [];
  const key = g => g[0].toFixed(7) + ',' + g[1].toFixed(7);
  while (parts.length) {
    let cur = parts.shift();
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 500) {
      const end = key(cur[cur.length - 1]);
      const i = parts.findIndex(p => key(p[0]) === end || key(p[p.length - 1]) === end);
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      cur = cur.concat(key(p[0]) === end ? p.slice(1) : p.reverse().slice(1));
    }
    if (cur.length >= 4) out.push(cur.flatMap(([lat, lon]) => project(lat, lon)));
  }
  return out;
}

const num = v => { if (v == null) return NaN; const s = String(v).trim(); const m = s.match(/^(-?[\d.]+)\s*(m|ft|')?/); if (!m) return NaN; const n = parseFloat(m[1]); return m[2] === 'ft' || m[2] === "'" ? n * 0.3048 : n; };

// ---- buildings ----
const outlines = [], parts = [];
for (const e of elements.values()) {
  const t = e.tags || {};
  if (!t.building && !t['building:part']) continue;
  if (t['building:part'] && t.building == null && /^(no)$/.test(t['building:part'])) continue;
  let polys = [];
  if (e.type === 'way' && e.geometry) { const p = ring(e.geometry); if (closed(p)) polys = [open(p)]; }
  else if (e.type === 'relation') polys = rings(e.members || [], 'outer').map(open);
  for (const p of polys) {
    if (p.length < 6) continue;
    const rec = { id: e.id, p: ccw(p), t };
    (t['building:part'] && !t.building ? parts : outlines).push(rec);
  }
}

// Simple 3D Buildings: an outline with parts inside it is drawn by its parts only.
const grid = new Map(), G = 100;
const gkey = (x, z) => Math.floor(x / G) + ',' + Math.floor(z / G);
for (const pt of parts) { const [x, z] = centroid(pt.p); pt.c = [x, z]; const k = gkey(x, z); (grid.get(k) || grid.set(k, []).get(k)).push(pt); }
let skipped = 0;
for (const o of outlines) {
  const [a, b, c, d] = bbox(o.p);
  let has = false;
  for (let gx = Math.floor(a / G); gx <= Math.floor(c / G) && !has; gx++) for (let gz = Math.floor(b / G); gz <= Math.floor(d / G) && !has; gz++)
    for (const pt of grid.get(gx + ',' + gz) || []) if (inside(pt.c[0], pt.c[1], o.p)) { has = true; break; }
  if (has) { o.skip = true; skipped++; }
}

const KIND = { house: 1, residential: 1, apartments: 1, detached: 1, terrace: 1, semidetached_house: 1, commercial: 2, retail: 2, office: 2, hotel: 2, industrial: 3, warehouse: 3, garage: 4, garages: 4, shed: 4, roof: 5, church: 6, cathedral: 6, chapel: 6, civic: 7, public: 7, government: 7, school: 7, university: 7, hospital: 7, train_station: 7, transportation: 7 };
const buildings = [];
for (const b of [...outlines.filter(o => !o.skip), ...parts]) {
  const t = b.t;
  let h = num(t.height);
  const lv = num(t['building:levels']);
  if (!(h > 0)) h = lv > 0 ? lv * 3.3 + 1 : (KIND[t.building] === 1 ? 9 : KIND[t.building] === 4 ? 3.5 : 10);
  let mh = num(t.min_height);
  if (!(mh >= 0)) { const ml = num(t['building:min_level']); mh = ml > 0 ? ml * 3.3 : 0; }
  if (t.building === 'roof' && !(mh > 0)) mh = Math.max(0, h - 1);
  if (mh >= h) continue;
  const [cx, cz] = centroid(b.p);
  let base = Infinity;
  for (let i = 0; i < b.p.length; i += 2) base = Math.min(base, ground(b.p[i], b.p[i + 1]));
  base = Math.max(base, 0.6);
  const rec = { p: b.p, h: +h.toFixed(1), b: +base.toFixed(1) };
  if (mh > 0) rec.m = +mh.toFixed(1);
  const k = KIND[t.building || t['building:part']]; if (k) rec.k = k;
  if (t['building:colour']) rec.c = t['building:colour'];
  if (t['roof:colour']) rec.rc = t['roof:colour'];
  if (t['roof:shape'] && t['roof:shape'] !== 'flat') rec.rs = t['roof:shape'];
  if (t['building:material']) rec.mat = t['building:material'];
  if (t.name) rec.n = t.name;
  if (t['building:part']) rec.part = 1;
  buildings.push(rec);
}
console.log(buildings.length, 'buildings', `(${parts.length} parts, ${skipped} outlines replaced by parts)`);

// ---- roads ----
const WIDTH = { motorway: 14, trunk: 13, primary: 12, secondary: 11, tertiary: 10, residential: 8.5, unclassified: 8, living_street: 6, service: 5, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7, pedestrian: 6, footway: 2.6, path: 2.2, cycleway: 2.6, steps: 3, track: 3, bridleway: 2.5 };
const CLASS = { motorway: 1, trunk: 1, motorway_link: 1, trunk_link: 1, primary: 2, primary_link: 2, secondary: 3, secondary_link: 3, tertiary: 4, tertiary_link: 4, residential: 5, unclassified: 5, living_street: 5, service: 6, pedestrian: 7, footway: 8, path: 8, cycleway: 9, steps: 10, track: 8, bridleway: 8 };
const names = [], nameIdx = new Map();
const nameOf = n => { if (!n) return undefined; if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); } return nameIdx.get(n); };
const roads = [];
const nodeWays = new Map();
for (const e of elements.values()) {
  const t = e.tags || {};
  if (e.type !== 'way' || !t.highway || !WIDTH[t.highway] || !e.geometry) continue;
  if (t.footway === 'sidewalk' || t.footway === 'crossing' || t.cycleway === 'crossing' || t.indoor === 'yes' || t.area === 'yes' || t.level && +t.level < 0) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  const p = ring(e.geometry);
  if (p.length < 4) continue;
  let w = WIDTH[t.highway];
  const lanes = num(t.lanes);
  if (lanes > 0 && CLASS[t.highway] <= 6) w = Math.max(w * 0.7, lanes * 3.3 + 1);
  const r = { p, w: +w.toFixed(1), k: CLASS[t.highway], nodes: e.nodes };
  const nm = nameOf(t.name); if (nm !== undefined) r.n = nm;
  if (t.bridge && t.bridge !== 'no') r.br = 1;
  if (+t.layer) r.ly = +t.layer;
  if (t.oneway === 'yes') r.ow = 1;
  if (t.surface && /sett|cobble|paving_stones|brick/.test(t.surface)) r.sf = 1;
  if (t.highway === 'steps') r.st = 1;
  roads.push(r);
  e.nodes.forEach(n => (nodeWays.get(n) || nodeWays.set(n, []).get(n)).push(r));
}

// Bridges: heights at nodes where a bridge meets the ground are anchored to the terrain; the heights at
// nodes between bridge ways are relaxed between them; each bridge way then interpolates by distance.
{
  const bridgeNodes = new Map(); // node id -> {y, fixed, nbrs: [[node, dist]]}
  const pos = new Map();
  for (const r of roads) if (r.br) {
    for (let i = 0; i < r.nodes.length; i++) pos.set(r.nodes[i], [r.p[i * 2], r.p[i * 2 + 1]]);
  }
  for (const r of roads) if (r.br) {
    const ends = [r.nodes[0], r.nodes[r.nodes.length - 1]];
    let len = 0; for (let i = 2; i < r.p.length; i += 2) len += Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]);
    for (const n of ends) {
      if (!bridgeNodes.has(n)) {
        const [x, z] = pos.get(n);
        const onGround = (nodeWays.get(n) || []).some(o => !o.br);
        bridgeNodes.set(n, { y: Math.max(0.5, ground(x, z)), fixed: onGround, nbrs: [] });
      }
    }
    bridgeNodes.get(ends[0]).nbrs.push([ends[1], len]);
    bridgeNodes.get(ends[1]).nbrs.push([ends[0], len]);
  }
  for (let it = 0; it < 400; it++) for (const b of bridgeNodes.values()) {
    if (b.fixed || !b.nbrs.length) continue;
    let s = 0, wsum = 0; for (const [n, d] of b.nbrs) { const w = 1 / Math.max(1, d); s += bridgeNodes.get(n).y * w; wsum += w; } b.y = s / wsum;
  }
  for (const r of roads) if (r.br) {
    const y0 = bridgeNodes.get(r.nodes[0]).y, y1 = bridgeNodes.get(r.nodes[r.nodes.length - 1]).y;
    const d = [0]; for (let i = 2; i < r.p.length; i += 2) d.push(d[d.length - 1] + Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]));
    const L = d[d.length - 1] || 1;
    r.y = d.map((di, i) => {
      let y = y0 + (y1 - y0) * di / L;
      const gnd = ground(r.p[i * 2], r.p[i * 2 + 1]);
      const min = Math.max(0, gnd) + (r.ly > 0 ? 5.5 * r.ly : 1);
      return +Math.max(y, min).toFixed(1);
    });
  }
}
// The Golden Gate's roadway in OSM sits too low between its terrain-anchored ends; give the span its
// real profile (about 75 m at mid-span, 73 m at the towers, 69 m at the anchorages), blended into the approaches.
{
  const [sx, sz] = project(37.81403, -122.47774), [nx, nz] = project(37.82551, -122.47908); // tower centres (OSM parts)
  const L = Math.hypot(nx - sx, nz - sz), ux = (nx - sx) / L, uz = (nz - sz) / L;
  const ggName = names.indexOf('Golden Gate Bridge');
  let n = 0;
  for (const r of roads) {
    if (!r.br || !r.y || (r.n !== ggName && r.k > 6)) continue;
    const mid = (r.p.length >> 2) << 1;
    if (Math.abs((r.p[mid] - sx) * uz - (r.p[mid + 1] - sz) * ux) > 25) continue;
    // resample every 20 m so the curve shows
    const np = [], ny = [];
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 20));
      for (let j = 0; j < k; j++) { np.push(+(ax + (bx - ax) * j / k).toFixed(1), +(az + (bz - az) * j / k).toFixed(1)); ny.push(r.y[i] + (r.y[i + 1] - r.y[i]) * j / k); }
    }
    np.push(r.p[r.p.length - 2], r.p[r.p.length - 1]); ny.push(r.y[r.y.length - 1]);
    r.p = np; r.y = ny;
    r.y = r.y.map((y, i) => {
      const x = r.p[i * 2], z = r.p[i * 2 + 1];
      const s = (x - sx) * ux + (z - sz) * uz, lat = Math.abs(-(x - sx) * uz + (z - sz) * ux);
      if (lat > 25 || s < -460 || s > L + 460) return y;
      const prof = 76 - 7.3e-6 * (s - L / 2) ** 2;
      const edge = s < -343 ? (s + 460) / 117 : s > L + 343 ? (L + 460 - s) / 117 : 1;
      n++;
      return +(y + (prof - y) * Math.max(0, Math.min(1, edge))).toFixed(1);
    });
  }
  console.log(n, 'Golden Gate deck points re-profiled');
}

// Footpaths and cycleways on a bridge follow the deck of the road they run beside.
{
  const carSegs = [];
  for (const r of roads) if (r.br && r.y && r.k <= 6) for (let i = 0; i < r.p.length / 2 - 1; i++)
    carSegs.push([r.p[i * 2], r.p[i * 2 + 1], r.p[i * 2 + 2], r.p[i * 2 + 3], r.y[i], r.y[i + 1]]);
  const G = 50, grid = new Map();
  for (const s of carSegs) {
    for (let gx = Math.floor((Math.min(s[0], s[2]) - 20) / G); gx <= Math.floor((Math.max(s[0], s[2]) + 20) / G); gx++)
      for (let gz = Math.floor((Math.min(s[1], s[3]) - 20) / G); gz <= Math.floor((Math.max(s[1], s[3]) + 20) / G); gz++) {
        const k = gx + ',' + gz; (grid.get(k) || grid.set(k, []).get(k)).push(s);
      }
  }
  let snapped = 0;
  for (const r of roads) {
    if (!r.br || !r.y || r.k <= 6) continue;
    r.y = r.y.map((y, i) => {
      const x = r.p[i * 2], z = r.p[i * 2 + 1];
      let best = null, bd = 18;
      for (const s of grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)) || []) {
        const dx = s[2] - s[0], dz = s[3] - s[1], L = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L));
        const d = Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t);
        if (d < bd) { bd = d; best = s[4] + (s[5] - s[4]) * t; }
      }
      if (best != null) { snapped++; return +best.toFixed(1); }
      return y;
    });
  }
  console.log(snapped, 'bridge footpath points snapped to their decks');
}
for (const r of roads) delete r.nodes;
console.log(roads.length, 'roads', roads.filter(r => r.br).length, 'bridges');

// ---- areas ----
const areas = [];
function areaKind(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) return 'water';
  if (t.natural === 'beach' || t.natural === 'sand') return 'sand';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'wood';
  if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland') return 'scrub';
  if (t.natural === 'bare_rock') return 'rock';
  if (t.leisure === 'golf_course') return 'golf';
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'stadium') return 'pitch';
  if (t.leisure === 'playground') return 'playground';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'dog_park' || t.leisure === 'nature_reserve' || /^(grass|meadow|recreation_ground|village_green)$/.test(t.landuse)) return 'park';
  if (t.landuse === 'cemetery') return 'park';
  if (t.man_made === 'pier' || t.man_made === 'breakwater' || t.man_made === 'groyne') return 'pier';
  if (t.amenity === 'parking') return 'parking';
  if (t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes')) return 'plaza';
  if (t.landuse === 'railway') return 'rail';
  if (t.leisure === 'marina') return null;
  return null;
}
for (const e of elements.values()) {
  const t = e.tags || {};
  if (t.building) continue;
  const k = areaKind(t);
  if (!k) continue;
  if (e.type === 'way' && e.geometry) {
    const p = ring(e.geometry);
    if (closed(p)) areas.push({ k, p: ccw(open(p)), ...(t.name ? { n: t.name } : {}) });
    else if (k === 'pier') roads.push({ p, w: 6, k: 11, br: 1, y: p.filter((_, i) => i % 2 === 0).map(() => 2.4) });
  } else if (e.type === 'relation') {
    const holes = rings(e.members || [], 'inner').map(open);
    for (const p of rings(e.members || [], 'outer').map(open)) {
      const rec = { k, p: ccw(p) };
      const hs = holes.filter(h => inside(h[0], h[1], p)).map(h => reverse(ccw(h)));
      if (hs.length) rec.h = hs;
      if (t.name) rec.n = t.name;
      areas.push(rec);
    }
  }
}
console.log(areas.length, 'areas');

// ---- rails ----
const rails = [];
for (const e of elements.values()) {
  const t = e.tags || {};
  if (e.type !== 'way' || !t.railway || !e.geometry) continue;
  if (!/^(tram|cable_car|light_rail|rail|funicular)$/.test(t.railway)) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  if (t.service === 'yard' || t.service === 'siding' && t.railway === 'rail') continue;
  rails.push({ k: t.railway, p: ring(e.geometry), ...(t.bridge && t.bridge !== 'no' ? { br: 1 } : {}) });
}

// ---- points ----
const trees = [], signals = [], crossings = [], lamps = [], stops = [], pois = [];
const POI_KIND = t => t.tourism === 'attraction' || t.tourism === 'viewpoint' || t.tourism === 'museum' || t.tourism === 'artwork' && t.name ? 'sight'
  : t.historic ? 'sight'
  : /^(restaurant|fast_food)$/.test(t.amenity) ? 'food'
  : /^(cafe|ice_cream)$/.test(t.amenity) ? 'cafe'
  : /^(bar|pub)$/.test(t.amenity) ? 'bar'
  : t.tourism === 'hotel' ? 'hotel'
  : /^(theatre|cinema|museum|library)$/.test(t.amenity) ? 'culture'
  : /^(school|university)$/.test(t.amenity) ? 'school'
  : t.amenity === 'hospital' ? 'hospital'
  : t.amenity === 'place_of_worship' ? 'worship'
  : t.leisure === 'park' ? 'park'
  : t.place ? 'hood'
  : t.railway === 'station' ? 'station'
  : null;
const seenPoi = new Set();
for (const e of elements.values()) {
  const t = e.tags || {};
  let lat = e.lat, lon = e.lon;
  if (e.type !== 'node') {
    if (!t.name || !e.bounds) continue;
    lat = (e.bounds.minlat + e.bounds.maxlat) / 2; lon = (e.bounds.minlon + e.bounds.maxlon) / 2;
  }
  if (lat == null) continue;
  const [x, z] = project(lat, lon);
  if (e.type === 'node') {
    if (t.natural === 'tree') { trees.push(x, z); continue; }
    if (t.highway === 'traffic_signals') { signals.push(x, z); continue; }
    if (t.highway === 'crossing' && t.crossing !== 'unmarked' && t.crossing !== 'no') { crossings.push(x, z); continue; }
    if (t.highway === 'street_lamp') { lamps.push(x, z); continue; }
    if (t.highway === 'bus_stop') { stops.push(x, z); }
  }
  const k = POI_KIND(t);
  if (!k || !t.name) continue;
  const key = k + t.name;
  if (seenPoi.has(key) && k !== 'food' && k !== 'cafe' && k !== 'bar') continue;
  seenPoi.add(key);
  const rec = { n: t.name, k, x, z };
  if (t.wikipedia) rec.wp = t.wikipedia;
  if (t.cuisine) rec.cu = t.cuisine;
  if (t.place) rec.pl = t.place;
  pois.push(rec);
}
console.log(trees.length / 2, 'trees', signals.length / 2, 'signals', crossings.length / 2, 'crossings', pois.length, 'pois');

// ---- transit routes ----
const routes = [];
const rf = path.join(SRC, 'routes.json');
if (fs.existsSync(rf) && fs.readFileSync(rf, "utf8").trimStart().startsWith("{")) {
  for (const e of JSON.parse(fs.readFileSync(rf)).elements) {
    const t = e.tags || {};
    const ways = (e.members || []).filter(m => m.type === 'way' && m.geometry && !/platform/.test(m.role));
    const segs = ways.map(m => m.geometry.filter(Boolean).map(g => project(g.lat, g.lon)));
    // chain the segments in member order, flipping each to continue from where the last one ended
    const line = [];
    for (const s of segs) {
      if (!line.length) { line.push(...s); continue; }
      const last = line[line.length - 1];
      const d0 = Math.hypot(s[0][0] - last[0], s[0][1] - last[1]);
      const d1 = Math.hypot(s[s.length - 1][0] - last[0], s[s.length - 1][1] - last[1]);
      if (line.length === s.length && Math.min(d0, d1) > 1) { // first segment may need flipping too
        const f0 = Math.hypot(s[0][0] - line[0][0], s[0][1] - line[0][1]);
        const f1 = Math.hypot(s[s.length - 1][0] - line[0][0], s[s.length - 1][1] - line[0][1]);
        if (Math.min(f0, f1) < Math.min(d0, d1)) line.reverse();
      }
      const l2 = line[line.length - 1];
      const a = Math.hypot(s[0][0] - l2[0], s[0][1] - l2[1]), b = Math.hypot(s[s.length - 1][0] - l2[0], s[s.length - 1][1] - l2[1]);
      line.push(...(a <= b ? s : s.slice().reverse()).slice(1));
    }
    const stopsOf = (e.members || []).filter(m => m.type === 'node' && /stop/.test(m.role) && m.lat != null).map(m => project(m.lat, m.lon));
    if (line.length > 2) routes.push({ k: t.route, ref: t.ref || '', n: t.name || '', c: t.colour || '', p: line.flat(), s: stopsOf.flat() });
  }
}
console.log(routes.length, 'routes:', routes.map(r => r.k + ' ' + r.ref).join(', '));

const map = {
  attribution: 'Map data © OpenStreetMap contributors (ODbL). Elevation: USGS 3DEP via AWS Terrain Tiles.',
  buildings, roads, areas, rails, names, routes,
  trees, signals, crossings, lamps, stops, pois,
};
const json = JSON.stringify(encodeMap(map));
fs.writeFileSync(path.join(OUT, 'map.json'), json);
console.log(`map.json ${(json.length / 1e6).toFixed(1)} MB`);
