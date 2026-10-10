// The Palace of Fine Arts (Bernard Maybeck, 1915): the open Roman rotunda (eight arched bays between
// columned piers, an entablature, a drum and the ochre ribbed dome) beside the lagoon, and the two curving
// Corinthian colonnades with their tall "flower boxes" along the water. The colonnades follow the OSM
// canopy outlines; the exhibition hall behind stays the OSM building.
import * as THREE from 'three';
import { Geo, makeMat, mesh, worldRing, centroid, circleRing, GLSL_HASH } from './common.js';

export function buildPalaceFineArts(ctx) {
  const { map, project } = ctx;
  let C = project(37.80290, -122.44840), b0 = 2.7;
  const dome = map.buildings.filter(b => b.rs === 'dome' && b.h > 40).map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 80)[0];
  if (dome) { C = dome.c; b0 = dome.b.b; }
  const canopies = map.buildings.filter(b => b.k === 5 && (b.m || 0) > 15).map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 130);

  const group = new THREE.Group();
  group.name = 'palace-of-fine-arts';
  group.position.set(C[0], b0, C[1]);

  const stoneHook = (tint) => shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_HASH)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n = lmNoise(vLmWorld.xz * 0.9 + vLmWorld.y * 0.7) * 0.6 + lmNoise(vLmWorld.xz * 6.0 + vLmWorld.y * 5.0) * 0.4;
        diffuseColor.rgb *= 0.86 + 0.2 * n;
        diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(${(b0 + 4).toFixed(1)}, ${b0.toFixed(1)}, vLmWorld.y); // weathered at the foot`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // floodlights from the lagoon side, stronger low down
        float fd = max(dot(normalize(vLmNormal), normalize(vec3(0.9, 0.35, 0.1))), 0.0);
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.84, 0.62) * uNight * ${tint.toFixed(2)} * (0.25 + 0.75 * fd) * (0.45 + 0.55 * smoothstep(${(b0 + 50).toFixed(1)}, ${b0.toFixed(1)}, vLmWorld.y));`);
  };
  const stone = makeMat(ctx, { color: '#d4b796', roughness: 0.85, side: THREE.DoubleSide }, { worldPos: true, name: 'pfa-stone', hook: stoneHook(0.45) });
  const domeMat = makeMat(ctx, { color: '#c88a5c', roughness: 0.8, side: THREE.DoubleSide }, { worldPos: true, name: 'pfa-dome', hook: stoneHook(0.35) });
  const green = makeMat(ctx, { color: '#4f6b3a', roughness: 0.95 }, { name: 'pfa-planting' });

  const g = new Geo(), dg = new Geo(), plants = new Geo();
  // ================================================================ rotunda
  const RP = 21.5;           // radius to the pier centres
  const PIER = 3.4;          // pier half-size
  const ARCH_TOP = 24, ENT0 = 27.5, ENT1 = 31.5;
  const side = 2 * RP * Math.sin(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    const cx = Math.cos(a) * RP, cz = Math.sin(a) * RP;
    // pier, turned to face outwards
    const m = new THREE.Matrix4().makeRotationY(-a).setPosition(cx, 0, cz);
    g.push(m);
    g.box(-PIER, -1.5, -PIER, PIER, ENT0, PIER, { bottom: false });
    // paired Corinthian columns on the outer face, with bases and capitals
    for (const dz of [-1.9, 1.9]) {
      g.lathe([[1.15, -1.0], [1.15, 0.6], [0.95, 1.0], [0.85, 21.5], [1.25, 23.0], [1.25, 23.6]], 12, { cx: PIER + 1.0, cz: dz });
    }
    // statue plinth on top of the entablature above each pier
    g.box(-2.4, ENT1, -2.4, 2.4, ENT1 + 2.6, 2.4);
    g.lathe([[1.1, ENT1 + 2.6], [0.9, ENT1 + 4.5], [0.5, ENT1 + 5.6], [0.0, ENT1 + 6.0]], 8, { flat: true });
    g.pop();
  }
  // the eight arched bays: a wall panel with a round-arched opening between each pair of piers
  for (let i = 0; i < 8; i++) {
    const a = (i + 1) / 8 * Math.PI * 2; // centre of the bay (between piers i and i+1)
    const r = RP * Math.cos(Math.PI / 8);
    const w = side - 2 * PIER + 0.4;
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, ENT0); sh.lineTo(-w / 2, ENT0); sh.lineTo(-w / 2, 0);
    const hw = w / 2 - 1.2, spring = ARCH_TOP - hw;
    const hole = new THREE.Path();
    hole.moveTo(-hw, 0); hole.lineTo(-hw, spring); hole.absarc(0, spring, hw, Math.PI, 0, true); hole.lineTo(hw, 0); hole.lineTo(-hw, 0);
    sh.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 2.6, bevelEnabled: false, curveSegments: 10 });
    geo.translate(0, 0, -1.3);
    const m = new THREE.Matrix4().makeRotationY(-a + Math.PI / 2).setPosition(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(geo, m);
    // coffered soffit band inside the arch (a darker strip reads as depth)
  }
  // entablature: octagonal frieze + projecting cornice
  const oct = (r, rot = Math.PI / 8) => Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + rot; return [Math.cos(a) * r, Math.sin(a) * r]; });
  const RO = RP + PIER + 0.4;
  g.prism(oct(RO), ENT0, ENT1 - 1.2, { top: false });
  g.loft(oct(RO), ENT1 - 1.2, oct(RO + 1.1), ENT1 - 0.4);
  g.prism(oct(RO + 1.1), ENT1 - 0.4, ENT1, { top: true });
  // inner face of the entablature ring
  // drum with a relief frieze and the ribbed dome
  const RD = 17.2, D0 = ENT1, D1 = ENT1 + 5.5, DT = 51;
  g.lathe([[RD + 0.6, D0], [RD + 0.6, D0 + 0.8], [RD, D0 + 1.0], [RD, D1 - 0.8], [RD + 0.5, D1 - 0.5], [RD + 0.5, D1]], 32);
  // drum relief panels
  for (let i = 0; i < 16; i++) {
    const a = (i + 0.5) / 16 * Math.PI * 2;
    const m = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * (RD + 0.05), 0, Math.sin(a) * (RD + 0.05));
    g.push(m); g.box(0, D0 + 1.4, -2.2, 0.35, D1 - 1.2, 2.2, { bottom: false }); g.pop();
  }
  const prof = [];
  const DH = DT - D1;
  for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI / 2; prof.push([Math.max(1.6, (RD + 0.2) * Math.cos(t)), D1 + Math.sin(t) * DH]); }
  dg.lathe(prof, 48);
  // ribs
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2;
    const ribP = prof.map(([r, y]) => [r + 0.25, y]);
    dg.lathe(ribP, 1, { a0: a - 0.018, a1: a + 0.018, flat: true });
  }
  // the lantern ring at the crown
  g.lathe([[1.9, DT - 0.6], [1.9, DT + 0.8], [2.3, DT + 1.0], [0.0, DT + 1.6]], 12);
  // a floor disc and the central altar inside the rotunda
  g.cap(oct(RO), 0.05, 1);
  g.box(-2.5, 0, -2.5, 2.5, 1.2, 2.5);

  // ================================================================ colonnades
  const colPos = [];
  const colliders = [];
  const suppress = [{ x: C[0], z: C[1], r: 36 }];
  for (const { b, c } of canopies) {
    const ring = [];
    for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i] - C[0], b.p[i + 1] - C[1]]);
    suppress.push({ x: c[0], z: c[1], r: 3 });
    const top = b.b - b0 + b.h, bot = b.b - b0 + (b.m || 18);
    const small = ring.length < 20;
    if (small) {
      // end pavilions: a solid square box with a garland cornice
      g.prism(ring, -1, bot - 1.0, { top: false });
      g.prism(ring, bot - 1.0, top + 4.5, { top: true });
      plants.prism(ring.map(([x, z]) => [x * 0.9 + centroidOf(ring)[0] * 0.1, z * 0.9 + centroidOf(ring)[1] * 0.1]), top + 4.5, top + 5.6, { top: true });
      colliders.push({ p: b.p, b: b.b, h: top + 4.5 });
      continue;
    }
    const { line, width } = centreline(ring, 80);
    if (!line) continue;
    // entablature ribbon along the centre line
    const hw = Math.max(2.5, width / 2);
    const L = offset(line, hw), R = offset(line, -hw);
    const eb = bot - 2.2, et = top + 0.6;
    ribbon(g, L, R, eb, et);
    // columns along both edges (pairs every ~5 m), flower boxes every ~22 m on top
    let acc = 0;
    let lastBox = -12;
    for (let i = 0; i < line.length - 1; i++) {
      const seg = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
      const steps = Math.max(1, Math.round(seg / 0.5));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const pos = acc + seg * t;
        const lerp = (P) => [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t];
        if (Math.floor(pos / 5.2) !== Math.floor((pos - seg / steps) / 5.2) || pos === 0) {
          for (const E of [offset(line, hw - 1.1), offset(line, -(hw - 1.1))]) {
            const p = lerp(E);
            const d = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]]; const dl = Math.hypot(...d);
            for (const k of [-0.8, 0.8]) colPos.push([p[0] + d[0] / dl * k, p[1] + d[1] / dl * k, eb]);
          }
        }
        if (pos - lastBox > 22 && pos > 6) {
          lastBox = pos;
          const p = lerp(line);
          const d = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]]; const ang = Math.atan2(d[1], d[0]);
          const m = new THREE.Matrix4().makeRotationY(-ang).setPosition(p[0], 0, p[1]);
          g.push(m);
          g.box(-2.6, et, -hw + 0.3, 2.6, et + 5.0, hw - 0.3);
          g.box(-3.0, et + 5.0, -hw, 3.0, et + 5.6, hw);
          g.pop();
          plants.push(m); plants.box(-2.4, et + 5.6, -hw + 0.6, 2.4, et + 6.6, hw - 0.6); plants.pop();
        }
      }
      acc += seg;
    }
  }
  // instanced columns (shared geometry)
  const colGeo = new Geo();
  colGeo.lathe([[0.95, -1.5], [0.95, 0.5], [0.78, 0.9], [0.66, 14.6], [1.0, 15.6], [1.0, 16.0]], 10);
  colGeo.box(-1.05, 16.0, -1.05, 1.05, 16.6, 1.05);
  const cg = colGeo.build();
  const cols = new THREE.InstancedMesh(cg, stone, colPos.length);
  colPos.forEach(([x, z, top], i) => {
    const s = top / 16.6;
    cols.setMatrixAt(i, new THREE.Matrix4().makeScale(1, s, 1).setPosition(x, 0, z));
  });
  cols.castShadow = true; cols.receiveShadow = true;
  cols.computeBoundingSphere();

  const meshes = [mesh(g, stone), mesh(dg, domeMat), mesh(plants, green)];
  group.add(...meshes, cols);
  // colliders: the eight piers
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    const cx = C[0] + Math.cos(a) * RP, cz = C[1] + Math.sin(a) * RP;
    colliders.push({ p: worldRing(circleRing(PIER + 0.6, 8), (x, z) => [cx + x, cz + z]), b: b0 - 1, h: 33 });
  }
  console.info(`[lm] palace of fine arts at ${C.map(v => v.toFixed(1))}: ${canopies.length} colonnade parts, ${colPos.length} columns`);
  return { group, suppress, colliders, update: null };
}

function centroidOf(r) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }

// Splits a long thin ring into its two long sides and averages them into a smooth centre line.
function centreline(ring, N) {
  let best = [0, 0, -1];
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    const d = Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
    if (d > best[2]) best = [i, j, d];
  }
  const [i0, j0] = best;
  const A = [], B = [];
  for (let k = i0; k !== j0; k = (k + 1) % ring.length) A.push(ring[k]);
  A.push(ring[j0]);
  for (let k = i0; k !== j0; k = (k - 1 + ring.length) % ring.length) B.push(ring[k]);
  B.push(ring[j0]);
  if (A.length < 3 || B.length < 3) return {};
  const ra = resample(A, N), rb = resample(B, N);
  let line = ra.map((p, k) => [(p[0] + rb[k][0]) / 2, (p[1] + rb[k][1]) / 2]);
  const widths = ra.map((p, k) => Math.hypot(p[0] - rb[k][0], p[1] - rb[k][1]));
  widths.sort((a, b) => a - b);
  // smooth the centre line (the outline has notches at every column pair)
  for (let it = 0; it < 4; it++) line = line.map((p, k) => k === 0 || k === line.length - 1 ? p : [(line[k - 1][0] + 2 * p[0] + line[k + 1][0]) / 4, (line[k - 1][1] + 2 * p[1] + line[k + 1][1]) / 4]);
  // trim the ends a little so the ribbon doesn't overshoot the outline
  return { line: line.slice(1, -1), width: widths[Math.floor(widths.length / 2)] };
}
function resample(pl, N) {
  const d = [0];
  for (let i = 1; i < pl.length; i++) d.push(d[i - 1] + Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]));
  const L = d[d.length - 1], out = [];
  let j = 0;
  for (let k = 0; k < N; k++) {
    const t = L * k / (N - 1);
    while (j < pl.length - 2 && d[j + 1] < t) j++;
    const f = (t - d[j]) / ((d[j + 1] - d[j]) || 1);
    out.push([pl[j][0] + (pl[j + 1][0] - pl[j][0]) * f, pl[j][1] + (pl[j + 1][1] - pl[j][1]) * f]);
  }
  return out;
}
function offset(pl, dist) {
  return pl.map((p, i) => {
    const a = pl[Math.max(0, i - 1)], b = pl[Math.min(pl.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - dz / l * dist, p[1] + dx / l * dist];
  });
}
// a closed box section swept along two edge lines (left/right), from y0 to y1
function ribbon(g, L, R, y0, y1) {
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = L[i + 1], c = R[i], d = R[i + 1];
    const out = (P, Q, O) => { const mx = (P[0] + Q[0]) / 2 - O[0], mz = (P[1] + Q[1]) / 2 - O[1]; return [mx, 0, mz]; };
    g.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], 0, y0, 1, y1, out(a, b, [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]));
    g.quad([c[0], y0, c[1]], [d[0], y0, d[1]], [d[0], y1, d[1]], [c[0], y1, c[1]], 0, y0, 1, y1, out(c, d, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
    g.quad([a[0], y1, a[1]], [b[0], y1, b[1]], [d[0], y1, d[1]], [c[0], y1, c[1]], 0, 0, 1, 1, [0, 1, 0]);
    g.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [d[0], y0, d[1]], [c[0], y0, c[1]], 0, 0, 1, 1, [0, -1, 0]);
    // cornice lip
    const lip = 0.5, dir = (P, O) => { const dx = P[0] - O[0], dz = P[1] - O[1], l = Math.hypot(dx, dz) || 1; return [P[0] + dx / l * lip, P[1] + dz / l * lip]; };
    const a2 = dir(a, c), b2 = dir(b, d), c2 = dir(c, a), d2 = dir(d, b);
    g.quad([a2[0], y1 - 0.7, a2[1]], [b2[0], y1 - 0.7, b2[1]], [b2[0], y1, b2[1]], [a2[0], y1, a2[1]], 0, 0, 1, 1, out(a, b, [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]));
    g.quad([c2[0], y1 - 0.7, c2[1]], [d2[0], y1 - 0.7, d2[1]], [d2[0], y1, d2[1]], [c2[0], y1, c2[1]], 0, 0, 1, 1, out(c, d, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]));
    g.quad([a2[0], y1 - 0.7, a2[1]], [b2[0], y1 - 0.7, b2[1]], [b[0], y1 - 0.7, b[1]], [a[0], y1 - 0.7, a[1]], 0, 0, 1, 1, [0, -1, 0]);
    g.quad([c2[0], y1 - 0.7, c2[1]], [d2[0], y1 - 0.7, d2[1]], [d[0], y1 - 0.7, d[1]], [c[0], y1 - 0.7, c[1]], 0, 0, 1, 1, [0, -1, 0]);
  }
}
