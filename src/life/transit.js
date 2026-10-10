// Transit on the real lines: cable cars (Powell–Hyde, Powell–Mason, California) creeping up the hills
// at cable speed and stopping at their stops, F-line streetcars along Market and the Embarcadero,
// and ferries crossing the Bay. The player can hop on a cable car's running board.
import * as THREE from 'three';
import { vehicleMaterial, vehiclePool, MODELS } from './models.js';

const CABLE_SPEED = 4.2, STREETCAR_SPEED = 8, FERRY_SPEED = 11;

class Line {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length / 2; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(d, out = {}) {
    d = ((d % this.len) + this.len) % this.len;
    const { cum, pts } = this;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const L = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / L;
    out.x = pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t;
    out.z = pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t;
    out.dx = (pts[hi * 2] - pts[lo * 2]) / L; out.dz = (pts[hi * 2 + 1] - pts[lo * 2 + 1]) / L;
    return out;
  }
  // distance along the line of the closest vertex to (x, z)
  project(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.pts.length / 2; i++) { const d = (this.pts[i * 2] - x) ** 2 + (this.pts[i * 2 + 1] - z) ** 2; if (d < bd) { bd = d; best = this.cum[i]; } }
    return { d: best, dist: Math.sqrt(bd) };
  }
}

// Joins a route and its return direction into one loop (they meet at the terminals).
function loopFrom(routes) {
  if (!routes.length) return null;
  const a = routes[0].p.slice();
  const b = routes[1] ? routes[1].p : null;
  if (b) {
    const ax = a[a.length - 2], az = a[a.length - 1];
    const d0 = Math.hypot(b[0] - ax, b[1] - az), d1 = Math.hypot(b[b.length - 2] - ax, b[b.length - 1] - az);
    const bb = d0 <= d1 ? b : (() => { const r = []; for (let i = b.length - 2; i >= 0; i -= 2) r.push(b[i], b[i + 1]); return r; })();
    a.push(...bb);
  } else { // run back along the same track
    for (let i = a.length - 4; i >= 0; i -= 2) a.push(a[i], a[i + 1]);
  }
  return a;
}

export function createTransit(map, hf, csm) {
  const mat = vehicleMaterial(csm);
  const group = new THREE.Group();
  const pools = { cablecar: vehiclePool('cablecar', mat, 24), streetcar: vehiclePool('streetcar', mat, 10) };
  group.add(pools.cablecar, pools.streetcar);
  const vehicles = [];
  const byRef = {};
  for (const r of map.routes) (byRef[r.k + ':' + r.ref] ||= []).push(r);

  const lines = [];
  const addLine = (ref, kind, count, name) => {
    const rs = byRef['tram:' + ref];
    if (!rs) return;
    const pts = loopFrom(rs);
    if (!pts || pts.length < 8) return;
    const line = new Line(pts);
    line.name = name; line.ref = ref;
    // stops along the loop, as distances
    const stops = new Set();
    for (const r of rs) for (let i = 0; i < r.s.length; i += 2) { const p = line.project(r.s[i], r.s[i + 1]); if (p.dist < 25) stops.add(Math.round(p.d)); }
    line.stops = [...stops].sort((a, b) => a - b);
    lines.push(line);
    const pal = MODELS[kind].colors;
    for (let i = 0; i < count; i++) {
      vehicles.push({ kind, line, d: (i + Math.random() * 0.3) / count * line.len, v: 0, dwell: 0, nextStop: -1, color: pal[i % pal.length], name, s: {}, len: MODELS[kind].len, w: kind === 'cablecar' ? 2.5 : 2.7, yaw: 0, pitch: 0, x: 0, y: 0, z: 0 });
    }
  };
  addLine('PH', 'cablecar', 7, 'Powell–Hyde');
  addLine('PM', 'cablecar', 6, 'Powell–Mason');
  addLine('C', 'cablecar', 6, 'California');
  addLine('F', 'streetcar', 8, 'F Market & Wharves');

  // ferries: one boat per ferry route, shuttling back and forth
  const ferries = [];
  const ferryGeo = ferryGeometry();
  const ferryMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1, vertexColors: true });
  if (csm) csm.setupMaterial(ferryMat);
  const ferryRoutes = map.routes.filter(r => r.k === 'ferry');
  const ferryMesh = new THREE.InstancedMesh(ferryGeo, ferryMat, Math.max(1, ferryRoutes.length));
  ferryMesh.castShadow = true; ferryMesh.receiveShadow = true; ferryMesh.frustumCulled = false;
  ferryRoutes.forEach((r, i) => { const line = new Line(loopFrom([r])); ferries.push({ line, d: Math.random() * line.len, s: {} }); });
  ferryMesh.count = ferries.length;
  group.add(ferryMesh);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), col = new THREE.Color(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  const tmpA = {}, tmpB = {};
  const api = {
    group, vehicles, lines,
    onBell: null,
    update(dt) {
      const counts = { cablecar: 0, streetcar: 0 };
      for (const v of vehicles) {
        const cruise = v.kind === 'cablecar' ? CABLE_SPEED : STREETCAR_SPEED;
        // keep a gap to the car ahead on the same line
        let gap = Infinity;
        for (const o of vehicles) if (o !== v && o.line === v.line) { let dd = o.d - v.d; if (dd < 0) dd += v.line.len; if (dd < gap) gap = dd; }
        const stops = v.line.stops;
        if (v.dwell > 0) {
          v.dwell -= dt; v.v = 0;
          if (v.dwell <= 0 && v.kind === 'cablecar') api.onBell?.(v);
        } else {
          let target = cruise;
          // approach the next stop
          if (stops.length) {
            let next = stops.find(s => s > v.d + 0.5);
            if (next === undefined) next = stops[0] + v.line.len;
            const toStop = next - v.d;
            if (toStop < 12) target = Math.min(target, 0.6 + toStop * 0.35);
            if (toStop < 0.8 && v.nextStop !== next % v.line.len) { v.nextStop = next % v.line.len; v.dwell = 5 + Math.random() * 6; }
          }
          if (gap < v.len + 10) target = Math.min(target, Math.max(0, (gap - v.len - 4) * 0.5));
          v.v += Math.max(-3, Math.min(1.2, (target - v.v) * 1.5)) * dt;
          v.v = Math.max(0, v.v);
        }
        v.d = (v.d + v.v * dt) % v.line.len;
        const p = v.line.at(v.d, v.s);
        const half = v.len * 0.4;
        const a = v.line.at(v.d - half, tmpA), b = v.line.at(v.d + half, tmpB);
        const ya = hf.at(a.x, a.z), yb = hf.at(b.x, b.z);
        v.x = p.x; v.z = p.z; v.y = (ya + yb) / 2 + 0.33;
        v.yaw = Math.atan2(b.x - a.x, b.z - a.z);
        v.pitch = Math.atan2(yb - ya, Math.hypot(b.x - a.x, b.z - a.z) || 1);
        const pool = pools[v.kind], i = counts[v.kind]++;
        e.set(-v.pitch, v.yaw, 0); q.setFromEuler(e);
        m4.compose(V.set(v.x, v.y, v.z), q, S1);
        pool.setMatrixAt(i, m4); pool.setColorAt(i, col.setHex(v.color));
      }
      for (const [k, pool] of Object.entries(pools)) { pool.count = counts[k]; pool.instanceMatrix.needsUpdate = true; pool.instanceColor.needsUpdate = true; }
      ferries.forEach((f, i) => {
        f.d = (f.d + FERRY_SPEED * dt) % f.line.len;
        const p = f.line.at(f.d, f.s);
        const bob = Math.sin(performance.now() * 0.0011 + i) * 0.04;
        e.set(bob, Math.atan2(p.dx, p.dz), Math.sin(performance.now() * 0.0009 + i * 2) * 0.03); q.setFromEuler(e);
        m4.compose(V.set(p.x, 0.1, p.z), q, S1);
        ferryMesh.setMatrixAt(i, m4);
      });
      ferryMesh.instanceMatrix.needsUpdate = true;
    },
    // the transit vehicle nearest to (x, z) within r metres
    nearest(x, z, r, kind) {
      let best = null, bd = r;
      for (const v of vehicles) { if (kind && v.kind !== kind) continue; const d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; best = v; } }
      return best;
    },
  };
  return api;
}

// A Bay ferry: white hull, dark windows, a blue stripe.
function ferryGeometry() {
  const parts = [];
  const colorize = (g, c) => { g = g.toNonIndexed(); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };
  const hull = new THREE.Shape();
  hull.moveTo(-4, -18); hull.lineTo(4, -18); hull.lineTo(4.6, 6); hull.quadraticCurveTo(4, 15, 0, 20); hull.quadraticCurveTo(-4, 15, -4.6, 6); hull.lineTo(-4, -18);
  const hg = new THREE.ExtrudeGeometry(hull, { depth: 3.2, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2).translate(0, -1.2, 0);
  parts.push(colorize(hg, [0.92, 0.92, 0.9]));
  parts.push(colorize(new THREE.BoxGeometry(9.3, 0.5, 36).translate(0, 0.7, 0), [0.15, 0.3, 0.55]));
  parts.push(colorize(new THREE.BoxGeometry(7.6, 2.6, 24).translate(0, 3.3, -2), [0.9, 0.9, 0.88]));
  parts.push(colorize(new THREE.BoxGeometry(7.7, 1.2, 23).translate(0, 3.4, -2), [0.05, 0.06, 0.08]));
  parts.push(colorize(new THREE.BoxGeometry(6, 2.2, 12).translate(0, 5.8, -4), [0.9, 0.9, 0.88]));
  parts.push(colorize(new THREE.BoxGeometry(6.1, 1, 11).translate(0, 6, -4), [0.05, 0.06, 0.08]));
  parts.push(colorize(new THREE.BoxGeometry(3, 1.8, 3.5).translate(0, 7.8, 2), [0.9, 0.9, 0.88]));
  return mergeAll(parts);
}
function mergeAll(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), colA = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) { if (!g.attributes.normal) g.computeVertexNormals(); pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); colA.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  return g;
}
