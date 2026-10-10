// The Golden Gate Bridge: two art-deco towers (stepped cruciform legs, four portal struts with ribbed
// panels, X-bracing below the deck), the two main cables hung as parabolas over the saddles, suspender
// ropes every 50 ft, the Warren stiffening truss under the deck, railings, lamp posts, concrete piers,
// the south tower fender, anchorage pylons, and night lighting (floodlit towers, red aviation lights,
// warm roadway lamps).
//
// The road deck itself is drawn by roads.js from OSM; everything here follows the deck heights found in
// map.roads so the structure stays glued to whatever deck profile the data has.
import * as THREE from 'three';
import { Geo, makeMat, glowMat, glowPoints, lightPools, minWidthHook, frame, mesh, beamMatrix, worldRing, roundRectRing, centroid, GLSL_HASH, shared } from './common.js';

const ORANGE = '#c0362c';         // International Orange
const LEG = 13.7;                 // cable plane / leg centre offset from the bridge axis (90 ft apart)
const PANEL = 7.62;               // truss panel (25 ft)
const SUSP = 15.24;               // suspender spacing (50 ft)
const SIDE_SPAN = 343;            // side spans (1,125 ft)
const B = 0.6;                    // OSM base elevation of the towers

// leg sections: [y0, y1, steps [[half-width across the bridge, half-depth along the bridge], ...]]
const SECTIONS = [
  [13.6, 21.6, [[3.0, 8.0], [4.0, 5.2], [5.0, 3.0]]],
  [21.6, 74.6, [[2.2, 6.9], [3.1, 4.4], [3.9, 2.2]]],
  [74.6, 122.6, [[2.1, 5.9], [3.0, 3.8], [3.8, 2.0]]],
  [122.6, 162.6, [[2.0, 4.9], [2.8, 3.1], [3.5, 1.9]]],
  [162.6, 194.6, [[1.9, 4.5], [2.6, 2.6], [3.1, 1.6]]],
  [194.6, 225.6, [[1.75, 3.8], [2.45, 2.1]]],
];
const STRUTS = [[111.6, 121.6], [151.6, 161.6], [185.6, 193.6], [215.6, 223.6]];
const CABLE_TOP = 225.0;          // cable centre over the saddles

function crossRing(st, cx = 0, scale = 1) {
  const q1 = [];
  for (let k = 0; k < st.length; k++) {
    q1.push([st[k][0] * scale, st[k][1] * scale]);
    if (k < st.length - 1) q1.push([st[k][0] * scale, st[k + 1][1] * scale]);
  }
  const ring = [...q1, ...q1.slice().reverse().map(([x, z]) => [x, -z]), ...q1.map(([x, z]) => [-x, -z]), ...q1.slice().reverse().map(([x, z]) => [-x, z])];
  return ring.map(([x, z]) => [x + cx, z]);
}
const sectionAt = y => SECTIONS.find(s => y >= s[0] && y < s[1]) || SECTIONS[SECTIONS.length - 1];

// ------------------------------------------------------------------------------------------------
export function buildGoldenGate(ctx) {
  const { map, hf } = ctx;
  // tower centres from the OSM tower tops (fallback: surveyed positions)
  const tops = map.buildings.filter(b => b.part && b.h >= 224 && b.h <= 232 && (b.m || 0) >= 180).map(b => centroid(b.p));
  const near = (x, z) => { const pts = tops.filter(p => Math.hypot(p[0] - x, p[1] - z) < 60); if (pts.length < 2) return [x, z]; return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]; };
  const S = near(-5268.3, -2061.0), N = near(-5386.4, -3339.8);
  const L = Math.hypot(N[0] - S[0], N[1] - S[1]);
  const F = frame(S[0], S[1], N[0] - S[0], N[1] - S[1]);
  const sAS = -SIDE_SPAN, sAN = L + SIDE_SPAN;
  const local = (x, z) => { const [t, zl] = F.toLocal(x, z); return [t, -zl]; }; // -> [t, s]

  // ---- deck heights along the bridge from the OSM carriageways (west: t < 0, east: t > 0) ----
  const samp = { [-1]: [], [1]: [] };
  const walks = [];
  const fenders = [];
  for (const r of map.roads) {
    if (!r.br || !r.y) continue;
    const pts = [];
    for (let i = 0; i < r.p.length; i += 2) { const [t, s] = local(r.p[i], r.p[i + 1]); pts.push([t, s, r.y[i / 2] + 0.15]); }
    const inCorr = pts.filter(([t, s]) => s > sAS - 360 && s < sAN + 360 && Math.abs(t) < 32);
    if (!inCorr.length) continue;
    if (r.k <= 6) { for (const [t, s, y] of pts) if (Math.abs(t) < 9 && s > sAS - 400 && s < sAN + 400) samp[t < 0 ? -1 : 1].push([s, y]); }
    else if (r.k === 9 || r.k === 10) walks.push(pts);
    else if (r.k === 11 && pts.every(([t, s]) => Math.abs(s) < 40 && Math.abs(t) < 40)) fenders.push({ pts, w: r.w });
  }
  for (const k of [-1, 1]) samp[k].sort((a, b) => a[0] - b[0]);
  if (!samp[-1].length) samp[-1] = samp[1];
  if (!samp[1].length) samp[1] = samp[-1];
  const interp = (arr, s) => {
    if (!arr.length) return 67;
    if (s <= arr[0][0]) return arr[0][1];
    if (s >= arr[arr.length - 1][0]) return arr[arr.length - 1][1];
    let lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m][0] <= s) lo = m; else hi = m; }
    const [s0, y0] = arr[lo], [s1, y1] = arr[hi];
    return s1 - s0 < 1e-6 ? Math.max(y0, y1) : y0 + (y1 - y0) * (s - s0) / (s1 - s0);
  };
  const deck = (s, side) => interp(samp[side < 0 ? -1 : 1], s);
  const deckC = s => (deck(s, -1) + deck(s, 1)) / 2;

  // ---- cable curve: parabolas with one horizontal tension (same curvature in all three spans) ----
  const yLow = Math.max(deck(L / 2, -1), deck(L / 2, 1)) + 2.6;
  const k = (CABLE_TOP - yLow) / (L / 2) ** 2;
  const sideCable = (d, yA, dA) => { const c = (CABLE_TOP - yA + k * dA * dA) / dA; return CABLE_TOP - c * d + k * d * d; };
  const anchorY = side => ({ S: Math.max(deck(sAS, -1), deck(sAS, 1)) + 1.2, N: Math.max(deck(sAN, -1), deck(sAN, 1)) + 1.2 });
  const AY = anchorY();
  const cableY = s => {
    if (s >= 0 && s <= L) return yLow + k * (s - L / 2) ** 2;
    if (s < 0) return sideCable(-s, AY.S, SIDE_SPAN);
    return sideCable(s - L, AY.N, SIDE_SPAN);
  };

  const group = new THREE.Group();
  group.name = 'golden-gate';
  F.apply(group);
  const colliders = [];
  const toWorldTS = (t, s) => F.toWorld(t, -s);
  const addCollider = (pts, b, h) => colliders.push({ p: worldRing(pts.map(([t, s]) => [t, -s]), F.toWorld), b, h });

  // ---- materials ----
  const paintHook = (flood) => shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_HASH)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float streak = lmNoise(vec2(vLmWorld.x * 0.9 + vLmWorld.z * 0.9, vLmWorld.y * 0.035));
        float blotch = lmNoise(vLmWorld.xz * 0.15 + vLmWorld.y * 0.05);
        diffuseColor.rgb *= 0.9 + 0.1 * streak + 0.06 * blotch;
        diffuseColor.rgb *= 1.0 - 0.18 * smoothstep(30.0, 0.0, vLmWorld.y) * (0.5 + 0.5 * streak); // salt-stained near the water
        // riveted plate seams on the vertical faces (faded out before they can shimmer)
        float sy = vLmWorld.y / 1.52;
        float dSeam = abs(fract(sy + 0.5) - 0.5) / max(fwidth(sy), 1e-4);
        float seam = (1.0 - smoothstep(0.6, 1.4, dSeam)) * (1.0 - smoothstep(0.08, 0.25, fwidth(sy))) * (1.0 - abs(vLmNormal.y));
        diffuseColor.rgb *= 1.0 - 0.13 * seam;
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        // floodlights: warm wash strongest low on the towers, fading with height
        float fl = ${flood.toFixed(3)} * (0.1 + 0.32 * exp(-max(vLmWorld.y - 50.0, 0.0) / 70.0) + 0.12 * smoothstep(150.0, 225.0, vLmWorld.y));
        fl *= 0.75 + 0.25 * abs(vLmNormal.z);
        totalEmissiveRadiance += (diffuseColor.rgb * 0.6 + vec3(0.2, 0.07, 0.02)) * fl * uNight;
      `);
  };
  const orange = makeMat(ctx, { color: ORANGE, roughness: 0.42, metalness: 0.05 }, { worldPos: true, hook: paintHook(1.0), name: 'gg-tower' });
  const orangeLow = makeMat(ctx, { color: ORANGE, roughness: 0.5, metalness: 0.05 }, { worldPos: true, hook: paintHook(0.35), name: 'gg-steel' });
  const cableMat = makeMat(ctx, { color: ORANGE, roughness: 0.6, metalness: 0.05 }, { worldPos: true, name: 'gg-cable', hook: sh => { paintHook(0.3)(sh); minWidthHook(0.46, 0.8)(sh); } });
  const ropeMat = makeMat(ctx, { color: ORANGE, roughness: 0.75, metalness: 0.0 }, { worldPos: true, name: 'gg-rope', hook: sh => { paintHook(0.25)(sh); minWidthHook(0.075, 0.55)(sh); } });
  const concrete = makeMat(ctx, { color: '#c9c3b6', roughness: 0.92 }, {
    worldPos: true, name: 'gg-concrete', hook: shader => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_HASH)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 0.86 + 0.18 * lmNoise(vLmWorld.xz * 0.4 + vLmWorld.y * 0.3);
          diffuseColor.rgb *= 1.0 - 0.35 * smoothstep(3.0, -1.0, vLmWorld.y);`);
    },
  });

  // ================================================================ towers
  const tower = new Geo();
  const conc = new Geo();
  for (const [ti, s0] of [[0, 0], [1, L]]) {
    tower.push(new THREE.Matrix4().makeTranslation(0, 0, -s0));
    conc.push(new THREE.Matrix4().makeTranslation(0, 0, -s0));
    const dk = Math.max(deck(s0, -1), deck(s0, 1));
    for (const side of [-1, 1]) {
      const cx = side * LEG;
      for (const [y0, y1, st] of SECTIONS) tower.prism(crossRing(st, cx), y0, y1, { top: true });
      // stepped crown on each leg and the saddle housing the cable runs through
      const topSt = SECTIONS[SECTIONS.length - 1][2];
      tower.prism(crossRing(topSt, cx, 0.86), 225.6, 226.5, { top: true });
      tower.box(cx - 1.25, 222.5, -3.4, cx + 1.25, 227.0, 3.4);
      tower.loft([[cx - 1.25, -3.4], [cx + 1.25, -3.4], [cx + 1.25, 3.4], [cx - 1.25, 3.4]], 227.0,
        [[cx - 0.5, -2.2], [cx + 0.5, -2.2], [cx + 0.5, 2.2], [cx - 0.5, 2.2]], 227.6);
      tower.box(cx - 0.5, 227.6, -2.2, cx + 0.5, 227.62, 2.2, { sides: false, bottom: false });
      // colliders: the legs at street level
      const [a, b] = sectionAt(dk)[2][1];
      void a; void b;
      const st = sectionAt(dk)[2];
      const wa = st[st.length - 1][0], wb = st[0][1];
      addCollider([[cx - wa, s0 - wb], [cx + wa, s0 - wb], [cx + wa, s0 + wb], [cx - wa, s0 + wb]], 0, 227);
    }
    // portal struts above the deck: ribbed art-deco panels, stepped haunches under each end
    for (const [y0, y1] of STRUTS) {
      const st = sectionAt((y0 + y1) / 2)[2];
      const xi = LEG - st[st.length - 1][0] + 0.4;
      const zd = 1.6, zf = 2.0;
      tower.box(-xi, y0 + 0.9, -zd, xi, y1 - 0.9, zd);
      tower.box(-xi, y1 - 1.0, -zf, xi, y1, zf);
      tower.box(-xi, y0, -zf, xi, y0 + 1.0, zf);
      const nr = Math.max(4, Math.round((2 * xi) / 2.3));
      for (let i = 1; i < nr; i++) {
        const x = -xi + (2 * xi) * i / nr;
        tower.box(x - 0.3, y0 + 1.0, -zf, x + 0.3, y1 - 1.0, zf, { top: false, bottom: false });
      }
      // stepped haunches
      for (const sgn of [-1, 1]) for (let j = 0; j < 3; j++) {
        const w = 2.4 - j * 0.8, h = 0.9 + j * 0.9;
        const xa = sgn * (xi - 0.4), xb = sgn * (xi - 0.4 - w);
        tower.box(Math.min(xa, xb), y0 - h + 0.01, -zd, Math.max(xa, xb), y0 + 0.01, zd);
      }
    }
    // below the deck: the roadway strut and X-bracing down to the pier
    {
      const stD = sectionAt(dk - 4)[2];
      const xi = LEG - stD[stD.length - 1][0] + 0.4;
      const rTop = dk - 1.4, rBot = dk - 8.5;
      tower.box(-xi, rBot, -2.3, xi, rTop, 2.3);
      tower.box(-xi, rBot + 1.2, -2.6, xi, rBot + 2.0, 2.6);
      const yb = 24.6 + B;
      tower.box(-xi, yb, -1.9, xi, yb + 2.0, 1.9);
      const h = rBot - (yb + 2.0);
      const n = Math.max(1, Math.round(h / 24));
      const ph = h / n;
      const m = new THREE.Matrix4(), box = new THREE.BoxGeometry(1, 1, 1);
      for (let i = 0; i < n; i++) {
        const ya = yb + 2.0 + i * ph, yc = ya + ph;
        if (i > 0) tower.box(-xi, ya - 1.0, -1.7, xi, ya + 1.0, 1.7);
        for (const z of [-1.1, 1.1]) {
          tower.add(box, beamMatrix([-xi + 0.5, ya + 0.6, z], [xi - 0.5, yc - 0.6, z], 1.2, 1.2, m));
          tower.add(box, beamMatrix([xi - 0.5, ya + 0.6, z], [-xi + 0.5, yc - 0.6, z], 1.2, 1.2, m));
        }
      }
    }
    // concrete pier (and the fender ring around the south tower)
    const g = Math.min(-6, (hf.inside(...toWorldTS(0, s0)) ? hf.at(...toWorldTS(0, s0)) : 0) - 3);
    conc.prism(roundRectRing(21.2, 10.3, 4.5, 4), g, 13.6, { top: true });
    conc.prism(roundRectRing(19.6, 9.0, 3.6, 4), 13.6, 14.2, { top: true });
    addCollider([[-21.2, s0 - 10.3], [21.2, s0 - 10.3], [21.2, s0 + 10.3], [-21.2, s0 + 10.3]], g, 14.2 - g);
    tower.pop(); conc.pop();
    void ti;
  }
  // the fender: a concrete ring wall in the water under the OSM walkway loop around the south tower
  for (const { pts, w } of fenders) {
    const hw = w / 2;
    const off = offsetLine(pts.map(([t, s]) => [t, s]), hw), offI = offsetLine(pts.map(([t, s]) => [t, s]), -hw);
    for (let i = 0; i < pts.length - 1; i++) {
      const y1 = pts[i][2] - 0.2, y0 = -5;
      const A = off[i], Bq = off[i + 1], C = offI[i], D = offI[i + 1];
      for (const [P, Q] of [[A, Bq], [D, C]]) conc.quad([P[0], y0, -P[1]], [Q[0], y0, -Q[1]], [Q[0], y1, -Q[1]], [P[0], y1, -P[1]], 0, y0, 1, y1);
      conc.quad([A[0], y1, -A[1]], [Bq[0], y1, -Bq[1]], [D[0], y1, -D[1]], [C[0], y1, -C[1]], 0, 0, 1, 1, [0, 1, 0]);
    }
  }
  // fix the facing of the fender walls (both faces drawn so the winding can't matter)
  // anchorage housings and the art-deco pylons (S1 / N1) at both ends of the suspension spans
  const pylonSuppress = [];
  const osmPylons = map.buildings.filter(b => typeof b.n === 'string' && /^Pylon [SN]1$/.test(b.n)).map(b => ({ b, c: centroid(b.p) }));
  for (const [sA, dir] of [[sAS, -1], [sAN, 1]]) {
    const dk = Math.max(deck(sA, -1), deck(sA, 1));
    const groundAt = (t, s) => { const w = toWorldTS(t, s); return Math.max(-1, hf.inside(w[0], w[1]) ? hf.at(w[0], w[1]) : 0) - 3; };
    // the pylons: at the OSM positions when mapped, else just outside the walkways
    for (const side of [-1, 1]) {
      const o = osmPylons.find(({ c }) => { const [t, s] = local(c[0], c[1]); return Math.abs(s - sA) < 40 && Math.sign(t) === side; });
      let [pt, ps] = o ? local(o.c[0], o.c[1]) : [side * 18.2, sA];
      if (Math.abs(pt) < 16.2) pt = side * 16.2;
      if (o) pylonSuppress.push({ x: o.c[0], z: o.c[1], r: 5 });
      const gy = o ? o.b.b - 3 : groundAt(pt, ps);
      conc.push(new THREE.Matrix4().makeTranslation(0, 0, -ps));
      conc.prism(crossRing([[2.0, 5.2], [2.8, 4.2], [3.4, 3.0]], pt), gy, dk + 11.0, { top: true });
      conc.prism(crossRing([[1.7, 4.6], [2.4, 3.6], [2.9, 2.5]], pt), dk + 11.0, dk + 13.2, { top: true });
      conc.prism(crossRing([[1.3, 3.6], [1.9, 2.6]], pt), dk + 13.2, dk + 15.0, { top: true });
      conc.pop();
      addCollider([[pt - 3.4, ps - 5.2], [pt + 3.4, ps - 5.2], [pt + 3.4, ps + 5.2], [pt - 3.4, ps + 5.2]], gy, dk + 15 - gy);
    }
  }

  const towerMesh = mesh(tower, orange);
  const concMesh = mesh(conc, concrete);
  concMesh.material.side = THREE.DoubleSide;
  group.add(towerMesh, concMesh);

  // ================================================================ main cables
  const cab = new Geo();
  const R = 0.46, SEG = 10;
  for (const side of [-1, 1]) {
    const t = side * LEG;
    const pts = [];
    // into the south anchorage housing, side span, main span, north side span, into the north housing
    pts.push([sAS - 4, AY.S - 1.5]);
    for (let s = sAS; s < sAN; s += 4) pts.push([s, cableY(s)]);
    pts.push([0, CABLE_TOP], [L, CABLE_TOP]);
    pts.push([sAN, cableY(sAN)], [sAN + 4, AY.N - 1.5]);
    pts.sort((a, b) => a[0] - b[0]);
    tube(cab, pts.map(([s, y]) => [t, y, -s]), R, SEG);
  }
  group.add(mesh(cab, cableMat));

  // ================================================================ suspenders (instanced)
  const susp = [];
  const addSusp = s => {
    for (const side of [-1, 1]) {
      const yb = deck(s, side) - 1.0, yt = cableY(s) - R * 0.6;
      if (yt - yb < 0.6) continue;
      for (const ds of [-0.22, 0.22]) susp.push([side * LEG, yb, yt, s + ds]);
    }
  };
  for (let i = -Math.floor(L / 2 / SUSP); i <= Math.floor(L / 2 / SUSP); i++) { const s = L / 2 + i * SUSP; if (s > 9 && s < L - 9) addSusp(s); }
  for (let s = -SUSP; s > sAS + 6; s -= SUSP) addSusp(s);
  for (let s = L + SUSP; s < sAN - 6; s += SUSP) addSusp(s);
  {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const im = new THREE.InstancedMesh(geo, ropeMat, susp.length);
    const m = new THREE.Matrix4();
    susp.forEach(([t, yb, yt, s], i) => { m.makeScale(0.085, yt - yb, 0.085); m.setPosition(t, (yb + yt) / 2, -s); im.setMatrixAt(i, m); });
    im.castShadow = true; im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
    // cable bands where each suspender is clamped
    const bands = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), orangeLow, susp.length / 2);
    let bi = 0;
    for (let i = 0; i < susp.length; i += 2) {
      const [t, , , s] = susp[i]; const sc = s + 0.22;
      const slope = (cableY(sc + 0.5) - cableY(sc - 0.5));
      m.compose(new THREE.Vector3(t, cableY(sc), -sc), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2 - Math.atan(slope)), new THREE.Vector3(R + 0.07, 1.1, R + 0.07));
      bands.setMatrixAt(bi++, m);
    }
    bands.castShadow = false;
    bands.computeBoundingSphere();
    group.add(bands);
  }

  // ================================================================ stiffening truss (instanced beams)
  const beams = [];
  const spans = [[sAS + 1, -8.2], [8.2, L - 8.2], [L + 8.2, sAN - 1]];
  const DEPTH = 7.6;
  for (const [a0, a1] of spans) {
    const n = Math.max(1, Math.round((a1 - a0) / PANEL)), ds = (a1 - a0) / n;
    const top = (s, side) => deck(s, side) - 1.3, bot = (s, side) => top(s, side) - DEPTH;
    for (let i = 0; i <= n; i++) {
      const sA = a0 + i * ds, sB = sA + ds;
      for (const side of [-1, 1]) {
        const t = side * LEG;
        beams.push([[t, bot(sA, side), -sA], [t, top(sA, side), -sA], 0.55, 0.7]);
        if (i === n) continue;
        beams.push([[t, top(sA, side), -sA], [t, top(sB, side), -sB], 0.9, 1.0]);
        beams.push([[t, bot(sA, side), -sA], [t, bot(sB, side), -sB], 0.9, 1.0]);
        if (i % 2 === 0) beams.push([[t, bot(sA, side), -sA], [t, top(sB, side), -sB], 0.5, 0.6]);
        else beams.push([[t, top(sA, side), -sA], [t, bot(sB, side), -sB], 0.5, 0.6]);
      }
      // floor beam and bottom lateral bracing
      beams.push([[-LEG, bot(sA, -1) + 0.4, -sA], [LEG, bot(sA, 1) + 0.4, -sA], 0.6, 0.8]);
      beams.push([[-LEG, top(sA, -1) - 0.6, -sA], [LEG, top(sA, 1) - 0.6, -sA], 0.6, 1.0]);
      if (i < n) {
        if (i % 2) beams.push([[-LEG, bot(sA, -1) + 0.2, -sA], [LEG, bot(sB, 1) + 0.2, -sB], 0.35, 0.35]);
        else beams.push([[LEG, bot(sA, 1) + 0.2, -sA], [-LEG, bot(sB, -1) + 0.2, -sB], 0.35, 0.35]);
      }
    }
  }
  {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), orangeLow, beams.length);
    const m = new THREE.Matrix4();
    beams.forEach(([a, b, w, h], i) => im.setMatrixAt(i, beamMatrix(a, b, w, h, m)));
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }

  // ================================================================ deck edge fascia + railings
  const rail = new Geo(), railTop = new Geo();
  // outer deck edge fascia plates under the sidewalks (between truss top chord and the walkway)
  for (const [a0, a1] of spans) {
    for (const side of [-1, 1]) {
      const t = side * (LEG + 0.5);
      const n = Math.max(1, Math.round((a1 - a0) / 8));
      for (let i = 0; i < n; i++) {
        const sA = a0 + (a1 - a0) * i / n, sB = a0 + (a1 - a0) * (i + 1) / n;
        const yA = deck(sA, side), yB = deck(sB, side);
        railTop.quad([t, yA - 1.4, -sA], [t, yB - 1.4, -sB], [t, yB + 0.1, -sB], [t, yA + 0.1, -sA], 0, 0, 1, 1, [side, 0, 0]);
        railTop.quad([t, yA + 0.1, -sA], [t, yB + 0.1, -sB], [side * (LEG - 0.9), yB + 0.1, -sB], [side * (LEG - 0.9), yA + 0.1, -sA], 0, 0, 1, 1, [0, 1, 0]);
      }
    }
  }
  for (const pts of walks) {
    // keep only the stretch of each walkway that is on the suspension bridge
    const seg = pts.filter(([, s]) => s > sAS - 2 && s < sAN + 2);
    if (seg.length < 2) continue;
    // outer side: the one whose offset increases |t| on the straight parts
    const pl = seg.map(([t, s]) => [t, s]);
    const o1 = offsetLine(pl, 1.0);
    let vote = 0;
    for (let i = 0; i < pl.length; i++) if (Math.abs(pl[i][0]) < 14) vote += Math.abs(o1[i][0]) - Math.abs(pl[i][0]);
    const sgn = vote >= 0 ? 1 : -1;
    const hw = 1.3;
    const outer = offsetLine(densify(pl, 6), sgn * (hw + 0.05));
    const ys = densifyY(seg, 6);
    railStrip(rail, railTop, outer, ys, 1.32);
    // inner curb railing between the walkway and the traffic, only along the straight runs
    const inner = offsetLine(densify(pl, 6), -sgn * (hw + 0.05));
    let run = [], runY = [];
    for (let i = 0; i < inner.length; i++) {
      if (Math.abs(inner[i][0]) < 11.2) { run.push(inner[i]); runY.push(ys[i]); }
      else { if (run.length > 1) railStrip(rail, railTop, run, runY, 1.05); run = []; runY = []; }
    }
    if (run.length > 1) railStrip(rail, railTop, run, runY, 1.05);
  }
  const railTex = makeRailTexture();
  const railMat = makeMat(ctx, { color: ORANGE, roughness: 0.5, alphaMap: railTex, alphaTest: 0.5, side: THREE.DoubleSide }, { name: 'gg-rail' });
  const railMesh = mesh(rail, railMat, { cast: false, receive: true });
  group.add(railMesh, mesh(railTop, orangeLow, { cast: true, receive: true }));

  // ================================================================ lamp posts (instanced) and lights
  const lampPos = [];
  for (let s = sAS + 15; s < sAN - 10; s += 30.48) {
    if (Math.abs(s) < 14 || Math.abs(s - L) < 14) continue;
    for (const side of [-1, 1]) lampPos.push([side, s, deck(s, side)]);
  }
  const post = new Geo();
  post.lathe([[0.16, 0], [0.13, 1.2], [0.1, 1.3], [0.09, 7.6], [0.06, 7.9]], 6, { flat: true });
  post.box(-0.05, 7.55, -0.05, 1.1, 7.7, 0.05);
  post.box(0.75, 7.25, -0.22, 1.35, 7.62, 0.22);
  const head = new Geo();
  head.box(0.8, 7.18, -0.17, 1.3, 7.26, 0.17);
  const postGeo = post.build(), headGeo = head.build();
  const posts = new THREE.InstancedMesh(postGeo, orangeLow, lampPos.length);
  const glowLamp = glowMat(new THREE.Color(1.0, 0.78, 0.5));
  const heads = new THREE.InstancedMesh(headGeo, glowLamp, lampPos.length);
  {
    const m = new THREE.Matrix4();
    lampPos.forEach(([side, s, y], i) => {
      // posts stand on the curb between walkway and road; the arm reaches over the traffic
      m.makeRotationY(side < 0 ? 0 : Math.PI);
      m.setPosition(side * 10.45, y, -s);
      posts.setMatrixAt(i, m); heads.setMatrixAt(i, m);
    });
  }
  posts.castShadow = true; posts.computeBoundingSphere(); heads.computeBoundingSphere();
  group.add(posts, heads);
  const lampDots = glowPoints(lampPos.map(([side, s, y]) => [side * (10.45 - 1.05), y + 7.1, -s]), new THREE.Color(1.0, 0.72, 0.42), 4);
  group.add(lampDots);
  const pools = lightPools(lampPos.map(([side, s, y]) => [side * 7.0, y + 0.12, -s]), new THREE.Color(1.0, 0.7, 0.4), 13);
  group.add(pools);

  // red aviation lights: leg tops, the mid-span cable crowns, and the struts
  const red = glowMat(new THREE.Color(1.0, 0.06, 0.03));
  const beaconPos = [];
  for (const s0 of [0, L]) for (const side of [-1, 1]) { beaconPos.push([side * LEG, 227.9, -s0]); beaconPos.push([side * (LEG + 1.4), 224.0, -s0 - 3.4]); beaconPos.push([side * (LEG + 1.4), 224.0, -s0 + 3.4]); }
  for (const side of [-1, 1]) beaconPos.push([side * LEG, yLow + R + 0.4, -L / 2]);
  const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), red, beaconPos.length);
  beaconPos.forEach((p, i) => beacons.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p[0], p[1], p[2])));
  beacons.computeBoundingSphere();
  group.add(beacons);
  const beaconDots = glowPoints(beaconPos, new THREE.Color(1.0, 0.05, 0.02), 6);
  group.add(beaconDots);

  // ---- OSM tower parts (and their deck slabs) are replaced by ours ----
  const suppress = [{ x: S[0], z: S[1], r: 26 }, { x: N[0], z: N[1], r: 26 }, ...pylonSuppress];

  let t = 0;
  const update = dt => {
    t += dt;
    const night = shared.uNight.value;
    glowLamp.color.copy(glowLamp.userData.base).multiplyScalar(night > 0.02 ? 0.25 + night * 9 : 0.22);
    if (night < 0.02) glowLamp.color.setRGB(0.32, 0.31, 0.29);
    const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.2));
    red.color.copy(red.userData.base).multiplyScalar(0.6 + night * 10 * pulse);
    lampDots.visible = beaconDots.visible = pools.visible = night > 0.05;
    pools.material.color.copy(pools.material.userData.base).multiplyScalar(night * 0.32);
    lampDots.material.color.copy(lampDots.material.userData.base).multiplyScalar(night * 2.2);
    beaconDots.material.color.copy(beaconDots.material.userData.base).multiplyScalar(night * 3 * pulse);
  };

  const triangles = [towerMesh, concMesh].reduce((a, m2) => a + m2.geometry.attributes.position.count / 3, 0)
    + cab.count / 3 + beams.length * 12 + susp.length * 12 + rail.count / 3 + railTop.count / 3 + lampPos.length * (postGeo.attributes.position.count / 3);
  console.info(`[lm] golden gate: L=${L.toFixed(1)} deck@towers ${deckC(0).toFixed(1)}/${deckC(L).toFixed(1)} mid ${deckC(L / 2).toFixed(1)} cable low ${yLow.toFixed(1)}, ${susp.length} ropes, ${beams.length} truss members, ~${Math.round(triangles / 1000)}k tris`);

  return { group, suppress, colliders, update, info: { S, N, L, F, deck, cableY } };
}

// ---------------------------------------------------------------------------------------------- helpers
function offsetLine(pl, d) {
  const n = pl.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = pl[Math.max(0, i - 1)], b = pl[i], c = pl[Math.min(n - 1, i + 1)];
    let n1x = 0, n1y = 0, n2x = 0, n2y = 0;
    if (i > 0) { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; n1x = -dy / l; n1y = dx / l; }
    if (i < n - 1) { const dx = c[0] - b[0], dy = c[1] - b[1], l = Math.hypot(dx, dy) || 1; n2x = -dy / l; n2y = dx / l; }
    if (i === 0) { n1x = n2x; n1y = n2y; }
    if (i === n - 1) { n2x = n1x; n2y = n1y; }
    let mx = n1x + n2x, my = n1y + n2y; const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const cos = mx * n1x + my * n1y; const s = 1 / Math.max(0.35, cos);
    out.push([b[0] + mx * d * s, b[1] + my * d * s]);
  }
  return out;
}
function densify(pl, step) {
  const out = [];
  for (let i = 0; i < pl.length - 1; i++) {
    const a = pl[i], b = pl[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  out.push(pl[pl.length - 1]);
  return out;
}
function densifyY(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push(a[2] + (b[2] - a[2]) * k / n);
  }
  out.push(pts[pts.length - 1][2]);
  return out;
}
// railing: an alpha-tested baluster strip plus a solid top rail, along a polyline of [t, s] with deck heights
function railStrip(strip, solid, pl, ys, h) {
  let u = 0;
  for (let i = 0; i < pl.length - 1; i++) {
    const [ta, sa] = pl[i], [tb, sb] = pl[i + 1];
    const len = Math.hypot(tb - ta, sb - sa);
    if (len < 1e-3) continue;
    const ya = ys[i], yb = ys[i + 1];
    strip.quad([ta, ya, -sa], [tb, yb, -sb], [tb, yb + h, -sb], [ta, ya + h, -sa], u / 0.24, 0, (u + len) / 0.24, 1);
    // top rail: a small box section
    const nx = -(sb - sa) / len, nz = -(tb - ta) / len; // perpendicular in (t, -s)
    const w = 0.07;
    const A = [ta + nx * w, ya + h, -sa + nz * w], Bp = [tb + nx * w, yb + h, -sb + nz * w], C = [tb - nx * w, yb + h, -sb - nz * w], D = [ta - nx * w, ya + h, -sa - nz * w];
    const up = v => [v[0], v[1] + 0.11, v[2]];
    solid.quad(up(A), up(Bp), up(C), up(D), 0, 0, 1, 1, [0, 1, 0]);
    solid.quad(A, Bp, up(Bp), up(A), 0, 0, 1, 1, [nx, 0, nz]);
    solid.quad(D, C, up(C), up(D), 0, 0, 1, 1, [-nx, 0, -nz]);
    u += len;
  }
}
function makeRailTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 32, 4);        // under the top rail
  g.fillRect(0, 56, 32, 5);       // bottom rail
  g.fillRect(0, 26, 32, 2);       // mid rail
  g.fillRect(13, 0, 6, 64);       // baluster
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
// a tube along points (all in one vertical plane x = const): radius r, seg sides
function tube(geo, pts, r, seg) {
  const ring = (i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2], tl = Math.hypot(tx, ty, tz) || 1;
    const T = new THREE.Vector3(tx / tl, ty / tl, tz / tl);
    const Bn = new THREE.Vector3(1, 0, 0);
    const Nn = new THREE.Vector3().crossVectors(T, Bn).normalize();
    const Bv = new THREE.Vector3().crossVectors(Nn, T).normalize();
    return Array.from({ length: seg + 1 }, (_, k) => {
      const a2 = k / seg * Math.PI * 2, c = Math.cos(a2), s = Math.sin(a2);
      const nx = Nn.x * c + Bv.x * s, ny = Nn.y * c + Bv.y * s, nz = Nn.z * c + Bv.z * s;
      return [pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r, nx, ny, nz];
    });
  };
  let prev = ring(0);
  let u = 0;
  for (let i = 1; i < pts.length; i++) {
    const cur = ring(i);
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    for (let k = 0; k < seg; k++) {
      const a = prev[k], b = prev[k + 1], c = cur[k + 1], d = cur[k];
      // orientation: outward normal is the vertex normal
      for (const v of [a, d, c, a, c, b]) geo.vert(v[0], v[1], v[2], v[3], v[4], v[5], (v === a || v === b) ? u : u + len, k / seg);
    }
    u += len;
    prev = cur;
  }
}
