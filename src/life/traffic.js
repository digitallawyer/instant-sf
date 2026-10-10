// Car traffic: a directed lane graph built from the OSM streets, cars that follow each other (IDM),
// stop at the same signals that are drawn at the junctions, slow down for turns and for the player,
// and are spawned/recycled in a ring around the camera. Plus parked cars along residential curbs.
import * as THREE from 'three';
import { vehicleMaterial, vehiclePool, MODELS } from './models.js';
import { signalInfo, axisOf, signalState } from '../engine/furniture.js';
import { shared } from '../engine/fog.js';

const key = (x, z) => x.toFixed(1) + ',' + z.toFixed(1);
const SPEED = { 1: 18, 2: 12.5, 3: 11.5, 4: 10, 5: 8.5 };
const MIX = [['sedan', 0.5], ['suv', 0.25], ['taxi', 0.1], ['van', 0.1], ['bus', 0.05]];
const POOL = { sedan: 140, suv: 70, taxi: 30, van: 30, bus: 14 };
const PARK_POOL = { sedan: 900, suv: 450, van: 120 };

function laneOffset(seg, lane) {
  if (seg.ow) return seg.w > 9 ? (lane ? seg.w / 2 - 1.8 : -(seg.w / 2 - 1.8) * 0.2) : 0;
  if (seg.k >= 5) return 1.25;
  if (seg.k === 4) return 1.7;
  return lane && seg.w >= 12 ? seg.w / 2 - 1.75 : Math.max(1.7, seg.w / 4);
}

export function buildRoadGraph(map, hf) {
  const roads = map.roads.filter(r => r.k <= 5);
  const deg = new Map();
  for (const r of roads) for (let i = 0; i < r.p.length / 2; i++) {
    const k = key(r.p[i * 2], r.p[i * 2 + 1]);
    deg.set(k, (deg.get(k) || 0) + (i === 0 || i === r.p.length / 2 - 1 ? 1 : 2));
  }
  const sig = signalInfo(map);
  const segs = [];
  const byFrom = new Map();
  const mk = (pts, ys, r, from, to) => {
    const cum = [0];
    for (let i = 1; i < pts.length / 2; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
    const len = cum[cum.length - 1];
    if (len < 1) return null;
    const n = pts.length / 2;
    const ex = pts[n * 2 - 2] - pts[n * 2 - 4], ez = pts[n * 2 - 1] - pts[n * 2 - 3], el = Math.hypot(ex, ez) || 1;
    const sx = pts[2] - pts[0], sz = pts[3] - pts[1], sl = Math.hypot(sx, sz) || 1;
    const s = { pts, ys, cum, len, from, to, w: r.w, k: r.k, ow: !!r.ow, n: r.n, out: [], rev: null,
      endDir: [ex / el, ez / el], startDir: [sx / sl, sz / sl], cars: [] };
    const si = sig.get(to);
    if (si) { s.signal = si; s.axis = axisOf(si, -s.endDir[0], -s.endDir[1]); }
    segs.push(s);
    if (!byFrom.has(from)) byFrom.set(from, []);
    byFrom.get(from).push(s);
    return s;
  };
  for (const r of roads) {
    let start = 0;
    const n = r.p.length / 2;
    for (let i = 1; i < n; i++) {
      const k = key(r.p[i * 2], r.p[i * 2 + 1]);
      if (i === n - 1 || deg.get(k) !== 2) {
        const pts = r.p.slice(start * 2, i * 2 + 2);
        const ys = r.y ? r.y.slice(start, i + 1) : null;
        const from = key(r.p[start * 2], r.p[start * 2 + 1]);
        const fwd = mk(pts, ys, r, from, k);
        if (!r.ow && fwd) {
          const rp = []; for (let j = pts.length / 2 - 1; j >= 0; j--) rp.push(pts[j * 2], pts[j * 2 + 1]);
          const back = mk(rp, ys ? ys.slice().reverse() : null, r, k, from);
          if (back) { fwd.rev = back; back.rev = fwd; }
        }
        start = i;
      }
    }
  }
  for (const s of segs) s.out = (byFrom.get(s.to) || []).filter(o => o !== s.rev);
  return { segs };
}

// position on a segment at distance d with a lateral offset (positive = right of travel)
function sample(seg, d, off, out) {
  const { pts, cum } = seg;
  let i = out.i ?? 0;
  if (i >= cum.length - 1 || cum[i] > d) i = 0;
  while (i < cum.length - 2 && cum[i + 1] < d) i++;
  out.i = i;
  const L = cum[i + 1] - cum[i] || 1, t = Math.min(1, Math.max(0, (d - cum[i]) / L));
  const dx = (pts[i * 2 + 2] - pts[i * 2]) / L, dz = (pts[i * 2 + 3] - pts[i * 2 + 1]) / L;
  out.x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t - dz * off;
  out.z = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t + dx * off;
  out.dx = dx; out.dz = dz;
  out.y = seg.ys ? seg.ys[i] + (seg.ys[i + 1] - seg.ys[i]) * t + 0.15 : null;
  return out;
}

export function createTraffic(map, hf, csm, graph) {
  const mat = vehicleMaterial(csm);
  const group = new THREE.Group();
  const pools = {};
  for (const [name, max] of Object.entries(POOL)) { pools[name] = vehiclePool(name, mat, max); group.add(pools[name]); }
  const segs = graph.segs;
  const mids = segs.map(s => { const m = Math.floor(s.pts.length / 4) * 2; return [s.pts[m], s.pts[m + 1]]; });
  const cars = [];
  const TARGET = 200, R = 520;
  const tmp = {}, tmpB = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), col = new THREE.Color(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  let rnd = Math.random;

  function pickType(seg) {
    let r = rnd();
    for (const [name, p] of MIX) { if ((r -= p) <= 0) return name === 'bus' && seg.k > 3 ? 'sedan' : name; }
    return 'sedan';
  }
  function spawn(cx, cz, rMin) {
    for (let tries = 0; tries < 40; tries++) {
      const i = Math.floor(rnd() * segs.length);
      const s = segs[i], m = mids[i];
      const d = Math.hypot(m[0] - cx, m[1] - cz);
      if (d < rMin || d > R) continue;
      const type = pickType(s);
      const live = cars.filter(c => c.type === type).length;
      if (live >= POOL[type]) continue;
      const pos = rnd() * s.len;
      if (s.cars.some(c => Math.abs(c.d - pos) < 12)) continue;
      const pal = MODELS[type].colors;
      const car = { seg: s, d: pos, v: SPEED[s.k] * 0.6, type, color: pal[Math.floor(rnd() * pal.length)], lane: rnd() < 0.5 ? 1 : 0, brake: 0, s: {}, next: null, len: MODELS[type].len, honk: 0 };
      car.next = chooseNext(s);
      cars.push(car); s.cars.push(car);
      return car;
    }
    return null;
  }
  function chooseNext(s) {
    if (!s.out.length) return s.rev || null;
    // prefer going roughly straight, but turn sometimes
    const opts = s.out.map(o => ({ o, dot: o.startDir[0] * s.endDir[0] + o.startDir[1] * s.endDir[1] }));
    const straight = opts.filter(x => x.dot > 0.8);
    if (straight.length && rnd() < 0.6) return straight[Math.floor(rnd() * straight.length)].o;
    return opts[Math.floor(rnd() * opts.length)].o;
  }
  function remove(c) {
    const a = c.seg.cars, i = a.indexOf(c); if (i >= 0) a.splice(i, 1);
    const j = cars.indexOf(c); if (j >= 0) cars.splice(j, 1);
  }

  let initialised = false;
  const api = {
    group, cars,
    update(dt, focus, player) {
      if (!initialised) { for (let i = 0; i < TARGET; i++) spawn(focus.x, focus.z, 20); initialised = true; }
      // recycle far cars, top up the ring
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        if (Math.hypot(c.s.x - focus.x, c.s.z - focus.z) > R + 140) remove(c);
      }
      for (let n = 0; n < 6 && cars.length < TARGET; n++) spawn(focus.x, focus.z, 220);
      for (const s of segs) if (s.cars.length > 1) s.cars.sort((a, b) => a.d - b.d);
      const t = shared.uTime.value;
      for (const c of cars) {
        const s = c.seg;
        let v0 = SPEED[s.k] * (c.type === 'bus' ? 0.75 : 1);
        // gap to the next obstacle along the lane
        let gap = 1e4, lv = v0;
        const arr = s.cars, idx = arr.indexOf(c);
        if (idx < arr.length - 1) { const L = arr[idx + 1]; gap = L.d - c.d - (L.len + c.len) / 2; lv = L.v; }
        else if (c.next && c.next.cars.length) { const L = c.next.cars[0]; gap = s.len - c.d + L.d - (L.len + c.len) / 2; lv = L.v; }
        const toEnd = s.len - c.d;
        if (s.signal) {
          const st = signalState(t, s.signal.phase, s.axis);
          const stopAt = toEnd - 7;
          if ((st === 'red' || (st === 'amber' && stopAt > c.v * 1.2)) && stopAt > -1) { if (stopAt < gap) { gap = Math.max(0.1, stopAt); lv = 0; } }
        }
        // turning: slow down near the end if the next segment bends away
        if (c.next && toEnd < 18) {
          const dot = c.next.startDir[0] * s.endDir[0] + c.next.startDir[1] * s.endDir[1];
          if (dot < 0.8) v0 = Math.min(v0, 4 + 6 * Math.max(0, dot));
          if (c.next === s.rev) v0 = Math.min(v0, 2);
        }
        // the player in our lane ahead
        if (player) {
          const px = player.pos.x - c.s.x, pz = player.pos.z - c.s.z;
          const ahead = px * c.s.dx + pz * c.s.dz, lat = Math.abs(-px * c.s.dz + pz * c.s.dx);
          if (ahead > 0 && ahead < 30 && lat < 2.2 && Math.abs(player.pos.y - (c.s.yy || 0)) < 4) {
            const g = ahead - c.len / 2 - 1.2;
            if (g < gap) { gap = Math.max(0.1, g); lv = 0; }
            if (g < 6 && c.v < 1 && c.honk <= 0) { c.honk = 6; api.onHonk?.(c); }
          }
        }
        c.honk -= dt;
        // IDM
        const A = 2.2, B = 3.5, s0 = 2.2, T = 1.1;
        const dv = c.v - lv;
        const sStar = s0 + Math.max(0, c.v * T + c.v * dv / (2 * Math.sqrt(A * B)));
        let acc = A * (1 - Math.pow(c.v / Math.max(0.1, v0), 4) - (sStar / Math.max(0.1, gap)) ** 2);
        acc = Math.max(-9, Math.min(A, acc));
        c.v = Math.max(0, c.v + acc * dt);
        c.brake = acc < -0.6 || c.v < 0.3 ? 1 : 0;
        c.d += c.v * dt;
        while (c.d > c.seg.len) {
          const over = c.d - c.seg.len;
          const nx = c.next;
          if (!nx) { c.dead = true; break; }
          const a = c.seg.cars, k = a.indexOf(c); if (k >= 0) a.splice(k, 1);
          c.seg = nx; c.d = over; c.s.i = 0; nx.cars.push(c);
          c.next = chooseNext(nx);
        }
        if (c.dead) continue;
        sample(c.seg, c.d, laneOffset(c.seg, c.lane), c.s);
        const gy = c.s.y != null ? c.s.y : hf.at(c.s.x, c.s.z) + 0.3;
        c.s.yy = gy;
        // pitch from the slope under the car
        const half = c.len * 0.4;
        sample(c.seg, Math.max(0, c.d - half), laneOffset(c.seg, c.lane), tmpB);
        const by = tmpB.y != null ? tmpB.y : hf.at(tmpB.x, tmpB.z) + 0.3;
        sample(c.seg, Math.min(c.seg.len, c.d + half), laneOffset(c.seg, c.lane), tmp);
        const fy = tmp.y != null ? tmp.y : hf.at(tmp.x, tmp.z) + 0.3;
        c.pitch = Math.atan2(fy - by, half * 2);
        c.yaw = Math.atan2(c.s.dx, c.s.dz);
        c.y = (fy + by) / 2;
      }
      for (let i = cars.length - 1; i >= 0; i--) if (cars[i].dead) remove(cars[i]);
      // write instances
      const counts = {};
      for (const name of Object.keys(pools)) counts[name] = 0;
      for (const c of cars) {
        const pool = pools[c.type], i = counts[c.type]++;
        e.set(-c.pitch, c.yaw, 0);
        q.setFromEuler(e);
        m4.compose(V.set(c.s.x, c.y, c.s.z), q, S1);
        pool.setMatrixAt(i, m4);
        pool.setColorAt(i, col.setHex(c.color));
        pool.userData.brake.array[i] = c.brake;
      }
      for (const [name, pool] of Object.entries(pools)) {
        pool.count = counts[name];
        pool.instanceMatrix.needsUpdate = true;
        if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
        pool.userData.brake.needsUpdate = true;
      }
    },
    // cars as circles for bumping into: [x, z, radius]
    nearby(x, z, r) {
      const out = [];
      for (const c of cars) if (Math.abs(c.s.x - x) < r && Math.abs(c.s.z - z) < r) out.push(c);
      return out;
    },
  };
  return api;
}

// Parked cars along residential curbs, shown only near the camera.
export function createParked(map, hf, csm, graph) {
  const mat = vehicleMaterial(csm);
  const group = new THREE.Group();
  const pools = {};
  for (const [name, max] of Object.entries(PARK_POOL)) { pools[name] = vehiclePool(name, mat, max); pools[name].castShadow = true; group.add(pools[name]); }
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const slots = [];
  const used = new Set();
  for (const s of graph.segs) {
    if (s.k < 4 || s.ys || s.len < 25) continue;
    const pairKey = s.rev ? [s.from, s.to].sort().join('|') : null;
    // each side of the street once: the right-hand curb of each direction (one-way: both curbs)
    if (pairKey && used.has(pairKey + s.from)) continue;
    used.add(pairKey + s.from);
    const sides = s.ow ? [1, -1] : [1];
    for (const side of sides) {
      const off = side * (s.w / 2 - 1.0);
      for (let d = 11; d < s.len - 11; d += 6.1 + rnd() * 0.8) {
        if (rnd() < 0.3) continue;
        const p = sample(s, d, off, {});
        const r = rnd();
        const type = r < 0.62 ? 'sedan' : r < 0.92 ? 'suv' : 'van';
        const pal = MODELS[type].colors;
        slots.push({ x: p.x, z: p.z, yaw: Math.atan2(p.dx, p.dz) + (rnd() < 0.15 ? Math.PI : 0), type, color: pal[Math.floor(rnd() * pal.length)], seg: s, d });
      }
    }
  }
  // heights and pitch once
  for (const sl of slots) {
    const fx = Math.sin(sl.yaw) * 2, fz = Math.cos(sl.yaw) * 2;
    const a = hf.at(sl.x - fx, sl.z - fz), b = hf.at(sl.x + fx, sl.z + fz);
    sl.y = (a + b) / 2 + 0.28; sl.pitch = Math.atan2(b - a, 4);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), col = new THREE.Color(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  let lx = Infinity, lz = Infinity;
  return {
    group, slots,
    update(cam) {
      if (Math.hypot(cam.x - lx, cam.z - lz) < 25) return;
      lx = cam.x; lz = cam.z;
      const counts = { sedan: 0, suv: 0, van: 0 };
      for (const sl of slots) {
        if (Math.abs(sl.x - cam.x) > 260 || Math.abs(sl.z - cam.z) > 260) continue;
        const pool = pools[sl.type];
        if (counts[sl.type] >= PARK_POOL[sl.type]) continue;
        const i = counts[sl.type]++;
        e.set(-sl.pitch, sl.yaw, 0); q.setFromEuler(e);
        m4.compose(V.set(sl.x, sl.y, sl.z), q, S1);
        pool.setMatrixAt(i, m4); pool.setColorAt(i, col.setHex(sl.color));
      }
      for (const [name, pool] of Object.entries(pools)) { pool.count = counts[name]; pool.instanceMatrix.needsUpdate = true; pool.instanceColor.needsUpdate = true; }
    },
    nearby(x, z, r) { return slots.filter(s => Math.abs(s.x - x) < r && Math.abs(s.z - z) < r); },
  };
}
