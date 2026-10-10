// Shortest paths over the street network (bike-legal: streets, paths and pedestrian ways, ignoring
// one-way rules), so races and missions follow real streets between a few waypoints.
const key = (x, z) => x.toFixed(1) + ',' + z.toFixed(1);

class Heap {
  constructor() { this.a = []; }
  push(n, p) { const a = this.a; a.push([p, n]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top[1]; }
  get size() { return this.a.length; }
}

export function buildStreetGraph(map, { maxK = 9, avoidSteps = true } = {}) {
  const nodes = new Map(); // key -> { x, z, y?, adj: [[key, len, deck y?]] }
  const node = (x, z) => { const k = key(x, z); let n = nodes.get(k); if (!n) nodes.set(k, n = { k, x, z, adj: [] }); return n; };
  for (const r of map.roads) {
    if (r.k > maxK || (avoidSteps && r.st)) continue;
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const a = node(r.p[i * 2], r.p[i * 2 + 1]), b = node(r.p[i * 2 + 2], r.p[i * 2 + 3]);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      // gently prefer proper streets over footpaths
      const cost = len * (r.k <= 5 ? 1 : r.k <= 7 ? 1.15 : 1.4);
      a.adj.push([b.k, cost, r.y ? r.y[i + 1] : null]);
      b.adj.push([a.k, cost, r.y ? r.y[i] : null]);
      if (r.y) { a.y = r.y[i]; b.y = r.y[i + 1]; }
    }
  }
  const list = [...nodes.values()];
  const G = 60, grid = new Map();
  for (const n of list) { const k = Math.floor(n.x / G) + ',' + Math.floor(n.z / G); (grid.get(k) || grid.set(k, []).get(k)).push(n); }
  const nearest = (x, z) => {
    let best = null, bd = Infinity;
    for (let r = 0; r < 6 && !best; r++)
      for (let i = Math.floor(x / G) - r; i <= Math.floor(x / G) + r; i++) for (let j = Math.floor(z / G) - r; j <= Math.floor(z / G) + r; j++)
        for (const n of grid.get(i + ',' + j) || []) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  };
  function path(ax, az, bx, bz) {
    const s = nearest(ax, az), t = nearest(bx, bz);
    if (!s || !t) return null;
    const g = new Map([[s.k, 0]]), came = new Map(), open = new Heap();
    open.push(s.k, Math.hypot(t.x - s.x, t.z - s.z));
    let guard = 0;
    while (open.size && guard++ < 400000) {
      const k = open.pop();
      if (k === t.k) break;
      const n = nodes.get(k), gk = g.get(k);
      for (const [m, c] of n.adj) {
        const ng = gk + c;
        if (ng < (g.get(m) ?? Infinity)) {
          g.set(m, ng); came.set(m, k);
          const mn = nodes.get(m);
          open.push(m, ng + Math.hypot(t.x - mn.x, t.z - mn.z));
        }
      }
    }
    if (!came.has(t.k) && s !== t) return null;
    const out = [];
    for (let k = t.k; k; k = came.get(k)) { const n = nodes.get(k); out.push(n.x, n.z); if (k === s.k) break; }
    const pts = [];
    for (let i = out.length - 2; i >= 0; i -= 2) pts.push(out[i], out[i + 1]);
    return pts;
  }
  return { nodes, nearest, path };
}

// A polyline with distances, resampled every `step` metres, plus helpers to query it.
export class Track {
  constructor(pts, { loop = false, step = 4 } = {}) {
    // resample
    const raw = [];
    for (let i = 0; i < pts.length / 2 - 1; i++) {
      const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / step));
      for (let s = 0; s < n; s++) raw.push(x0 + (x1 - x0) * s / n, z0 + (z1 - z0) * s / n);
    }
    raw.push(pts[pts.length - 2], pts[pts.length - 1]);
    if (loop) raw.push(raw[0], raw[1]);
    this.pts = raw; this.loop = loop;
    this.cum = [0];
    for (let i = 1; i < raw.length / 2; i++) this.cum.push(this.cum[i - 1] + Math.hypot(raw[i * 2] - raw[i * 2 - 2], raw[i * 2 + 1] - raw[i * 2 - 1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(d, out = {}) {
    if (this.loop) d = ((d % this.len) + this.len) % this.len; else d = Math.max(0, Math.min(this.len, d));
    const { cum, pts } = this;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const L = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / L;
    out.x = pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t; out.z = pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t;
    out.dx = (pts[hi * 2] - pts[lo * 2]) / L; out.dz = (pts[hi * 2 + 1] - pts[lo * 2 + 1]) / L;
    return out;
  }
  // progress (distance along) of the closest point, searching near a hint
  progress(x, z, hint = 0, window = 120) {
    const { cum, pts } = this;
    let best = hint, bd = Infinity;
    const n = cum.length;
    let i0 = 0, i1 = n - 1;
    if (hint >= 0) {
      let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= hint) lo = m; else hi = m; }
      const w = Math.ceil(window / 4); i0 = Math.max(0, lo - w); i1 = Math.min(n - 1, lo + w);
    }
    for (let i = i0; i < i1; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3];
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
      const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d < bd) { bd = d; best = cum[i] + Math.sqrt(L) * t; }
    }
    return { d: best, off: Math.sqrt(bd) };
  }
}
