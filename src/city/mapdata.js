// The game map is stored compactly: every coordinate list is integer decimetres, delta-encoded
// ([x0, z0, dx1, dz1, ...]), which roughly halves the file and gzips far better. encode() runs in
// tools/build-map.mjs, decode() in the browser (and in Node tools that read map.json).

const enc = p => { const o = new Array(p.length); let px = 0, pz = 0; for (let i = 0; i < p.length; i += 2) { const x = Math.round(p[i] * 10), z = Math.round(p[i + 1] * 10); o[i] = x - px; o[i + 1] = z - pz; px = x; pz = z; } return o; };
const dec = p => { const o = new Float64Array(p.length); let x = 0, z = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; o[i] = x / 10; o[i + 1] = z / 10; } return Array.from(o); };

function walk(map, f) {
  for (const b of map.buildings) b.p = f(b.p);
  for (const r of map.roads) r.p = f(r.p);
  for (const a of map.areas) { a.p = f(a.p); if (a.h) a.h = a.h.map(f); }
  for (const r of map.rails) r.p = f(r.p);
  for (const r of map.routes) { r.p = f(r.p); r.s = f(r.s); }
  for (const k of ['trees', 'signals', 'crossings', 'lamps', 'stops']) map[k] = f(map[k]);
}

export function encodeMap(map) { walk(map, enc); map.enc = 1; return map; }
export function decodeMap(map) { if (map.enc) { walk(map, dec); delete map.enc; } return map; }
export async function loadMap(url) { return decodeMap(await (await fetch(url)).json()); }
