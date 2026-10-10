// Everything you can search for and teleport to: curated sights, OSM points of interest,
// neighbourhoods, parks and every named street.
import { project } from '../city/region.js';
import { SIGHTS } from '../city/sf.js';

const KIND_RANK = { landmark: 0, sight: 1, hood: 2, park: 3, station: 4, street: 5, culture: 6, food: 7, cafe: 7, bar: 7, hotel: 8, school: 9, worship: 9, hospital: 9 };

export function buildPlaces(map) {
  const out = [];
  for (const s of SIGHTS) { const [x, z] = project(s.lat, s.lon); out.push({ name: s.name, kind: 'landmark', x, z, blurb: s.blurb, id: s.id }); }
  const have = new Set(out.map(p => p.name.toLowerCase()));
  for (const p of map.pois) {
    if (have.has(p.n.toLowerCase())) continue;
    have.add(p.n.toLowerCase());
    out.push({ name: p.n, kind: p.k, x: p.x, z: p.z, cuisine: p.cu });
  }
  // streets: the midpoint of each name's longest way
  const longest = new Map();
  for (const r of map.roads) {
    if (r.n === undefined) continue;
    let len = 0; for (let i = 2; i < r.p.length; i += 2) len += Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]);
    const cur = longest.get(r.n);
    if (!cur || len > cur.len) longest.set(r.n, { len, r });
  }
  for (const [n, { r }] of longest) {
    const name = map.names[n];
    if (have.has(name.toLowerCase())) continue;
    const mid = Math.floor(r.p.length / 4) * 2;
    out.push({ name, kind: 'street', x: r.p[mid], z: r.p[mid + 1] });
  }
  return out;
}

export function searchPlaces(places, q, limit = 8) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const res = [];
  for (const p of places) {
    const n = p.name.toLowerCase();
    const i = n.indexOf(q);
    if (i < 0) continue;
    const score = (i === 0 ? 0 : n[i - 1] === ' ' ? 1 : 3) * 10 + (KIND_RANK[p.kind] ?? 9) + n.length / 100;
    res.push({ p, score });
  }
  return res.sort((a, b) => a.score - b.score).slice(0, limit).map(r => r.p);
}
