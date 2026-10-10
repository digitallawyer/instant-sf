// Builds the small lookup file the website's Eat & drink and Streets & squares pages load instead of the
// full 11 MB map.json:  node tools/build-index.mjs   (run again whenever map.json is rebuilt)
//
// public/data/sf/index.json:
//   streets: [[name, lengthMetres, neighbourhood], ...]       every named street, summed over its segments
//   squares: [[name, 'park' | 'square', neighbourhood], ...]  named parks and plazas not already a street
//   places:  [[name, kind, x, z, cuisine, neighbourhood], ...] food / cafe / bar points (x, z in map.json metres)
//   hoods:   [neighbourhood, ...]                              referenced by index from the rows above
import fs from 'node:fs';
import { decodeMap } from '../src/city/mapdata.js';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'public/data/sf/map.json');
const out = path.join(root, 'public/data/sf/index.json');
const map = decodeMap(JSON.parse(fs.readFileSync(src, 'utf8')));

// neighbourhoods: the map's "hood" points, minus the plazas and squares that share that list
const hoods = (map.pois || []).filter(p => p.k === 'hood' && !/plaza|square|piazza|court|park|street/i.test(p.n));
const hoodNames = [...new Set(hoods.map(h => h.n))].sort();
const hoodIdx = new Map(hoodNames.map((n, i) => [n, i]));
const MAX = 1400 ** 2;
function hoodAt(x, z) {
  let best = null, bd = MAX;
  for (const h of hoods) { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (d < bd) { bd = d; best = h.n; } }
  return best == null ? -1 : hoodIdx.get(best);
}
const r1 = v => Math.round(v * 10) / 10;
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// streets: length and the neighbourhood holding most of that length
const names = map.names || [];
const len = new Float64Array(names.length);
const byHood = names.map(() => new Map());
for (const r of map.roads || []) {
  if (r.n == null || !r.p || r.p.length < 4) continue;
  let L = 0;
  for (let i = 2; i < r.p.length; i += 2) L += Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]);
  len[r.n] += L;
  const mid = (r.p.length / 4 | 0) * 2;
  const h = hoodAt(r.p[mid], r.p[mid + 1]);
  if (h >= 0) byHood[r.n].set(h, (byHood[r.n].get(h) || 0) + L);
}
const seen = new Set();
const streets = [];
names.forEach((n, i) => {
  const key = fold(n);
  if (!n || seen.has(key)) return;
  seen.add(key);
  const top = [...byHood[i]].sort((a, b) => b[1] - a[1])[0];
  streets.push([n, Math.round(len[i]), top ? top[0] : -1]);
});

// squares and parks
const squares = [];
const addSquare = (n, x, z, type) => {
  const key = fold(n);
  if (!n || seen.has(key)) return;
  seen.add(key);
  squares.push([n, type, hoodAt(x, z)]);
};
for (const a of map.areas || []) {
  if (!a.n || (a.k !== 'park' && a.k !== 'plaza') || !a.p || a.p.length < 6) continue;
  let x = 0, z = 0; const k = a.p.length / 2;
  for (let i = 0; i < a.p.length; i += 2) { x += a.p[i]; z += a.p[i + 1]; }
  addSquare(a.n, x / k, z / k, a.k === 'plaza' ? 'square' : 'park');
}
for (const p of map.pois || []) {
  if (p.k === 'park') addSquare(p.n, p.x, p.z, 'park');
  if (p.k === 'hood' && /plaza|square|piazza/i.test(p.n)) addSquare(p.n, p.x, p.z, 'square');
}

// places to eat and drink
const places = (map.pois || [])
  .filter(p => ['food', 'cafe', 'bar'].includes(p.k) && p.n && /[\p{L}\p{N}]/u.test(p.n))
  .map(p => [p.n, p.k, r1(p.x), r1(p.z), p.cu || '', hoodAt(p.x, p.z)]);

const index = { attribution: map.attribution, hoods: hoodNames, streets, squares, places };
fs.writeFileSync(out, JSON.stringify(index));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`wrote ${path.relative(root, out)}: ${streets.length} streets, ${squares.length} squares/parks, ${places.length} places, ${hoodNames.length} neighbourhoods (${kb} KB)`);
