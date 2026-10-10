// Coit Tower (1933) on Telegraph Hill: a 64 m fluted column of unpainted reinforced concrete on a
// low rectangular base (the mural lobby), with a ring of tall arched windows under the cornice, a set-back
// crown of small arches and a parapet. Floodlit at night.
import * as THREE from 'three';
import { Geo, makeMat, mesh, worldRing, centroid, circleRing, GLSL_HASH } from './common.js';

export function buildCoit(ctx) {
  const { map, project, hf } = ctx;
  let C = project(37.80239, -122.40582), base = null;
  // the shaft in OSM: the tallest round part near the published point
  const parts = map.buildings.map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 25);
  const shaft = parts.filter(o => o.b.h >= 40).sort((a, b) => b.b.h - a.b.h)[0];
  if (shaft) { C = shaft.c; base = shaft.b.b; }
  if (base == null) base = hf.at(C[0], C[1]);
  const lower = parts.filter(o => o.b.h < 40);

  const group = new THREE.Group();
  group.name = 'coit-tower';
  group.position.set(C[0], base, C[1]);

  const concrete = makeMat(ctx, { color: '#d9d0bf', roughness: 0.88 }, {
    worldPos: true, name: 'coit-concrete', hook: shader => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_HASH)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float n = lmNoise(vLmWorld.xz * 1.3 + vLmWorld.y * 0.9) * 0.6 + lmNoise(vec2(atan(vLmWorld.z - ${C[1].toFixed(1)}, vLmWorld.x - ${C[0].toFixed(1)}) * 9.0, vLmWorld.y * 0.08)) * 0.4;
          diffuseColor.rgb *= 0.88 + 0.16 * n;
          // board-formed lifts every ~1.2 m
          float lift = abs(fract(vLmWorld.y / 1.22) - 0.5);
          diffuseColor.rgb *= 1.0 - 0.05 * smoothstep(0.44, 0.5, lift) * (1.0 - abs(vLmNormal.y));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // floodlit from the base at night
          float up = clamp((vLmWorld.y - ${base.toFixed(1)}) / 64.0, 0.0, 1.0);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.86, 0.66) * uNight * (0.55 - 0.25 * up) * (0.6 + 0.4 * max(vLmNormal.y, 0.0) + 0.4 * (1.0 - abs(vLmNormal.y)));`);
    },
  });
  const dark = makeMat(ctx, { color: '#1d1b19', roughness: 0.4, metalness: 0.2 }, {
    name: 'coit-openings', hook: shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * uNight * 0.6;');
    },
  });

  const g = new Geo(), op = new Geo();
  // ---- fluted shaft: 24 flutes, slight entasis
  const FL = 24, R0 = 5.7, R1 = 5.25, H0 = 0, H1 = 47.5;
  const fluted = (r) => {
    const ring = [];
    for (let i = 0; i < FL; i++) {
      const a0 = (i / FL) * Math.PI * 2, a1 = ((i + 0.5) / FL) * Math.PI * 2;
      // a narrow fillet then a shallow concave flute (approximated by 3 points)
      ring.push([Math.cos(a0) * r, Math.sin(a0) * r]);
      ring.push([Math.cos(a0 + 0.035) * r, Math.sin(a0 + 0.035) * r]);
      ring.push([Math.cos(a1) * (r - 0.32), Math.sin(a1) * (r - 0.32)]);
      ring.push([Math.cos(a0 + Math.PI * 2 / FL - 0.035) * r, Math.sin(a0 + Math.PI * 2 / FL - 0.035) * r]);
    }
    return ring;
  };
  const STEPS = 6;
  for (let k = 0; k < STEPS; k++) {
    const ya = H0 + (H1 - H0) * k / STEPS, yb = H0 + (H1 - H0) * (k + 1) / STEPS;
    g.loft(fluted(R0 + (R1 - R0) * k / STEPS), ya - 2.5 * (k === 0), fluted(R0 + (R1 - R0) * (k + 1) / STEPS), yb);
  }
  // ---- observation stage: plain drum with 12 tall round-arched windows
  const D0 = H1, D1 = 55.5, RD = 5.25;
  g.lathe([[RD, D0], [RD, D1]], 48, { flat: false });
  const NW = 12;
  for (let i = 0; i < NW; i++) {
    const a = (i + 0.5) / NW * Math.PI * 2;
    archPanel(op, a, RD + 0.02, D0 + 1.6, D1 - 1.4, 0.75);
  }
  // cornice
  g.lathe([[RD, D1], [RD + 0.55, D1 + 0.35], [RD + 0.55, D1 + 1.0], [RD + 0.2, D1 + 1.15]], 48);
  g.cap(circleRing(RD + 0.2, 48), D1 + 1.15, 1);
  // ---- set-back crown with small arches and a parapet
  const C0 = D1 + 1.15, C1 = 61.6, RC = 4.55;
  g.lathe([[RC, C0], [RC, C1]], 40);
  for (let i = 0; i < 16; i++) archPanel(op, (i + 0.25) / 16 * Math.PI * 2, RC + 0.02, C0 + 0.9, C1 - 0.8, 0.42);
  g.lathe([[RC, C1], [RC + 0.3, C1 + 0.25], [RC + 0.3, 63.3], [RC + 0.05, 63.3], [RC + 0.05, 63.9]], 40);
  g.lathe([[RC - 0.35, 63.9], [RC - 0.35, 62.4]], 40); // inner face of the parapet
  g.cap(circleRing(RC - 0.35, 40), 62.4, 1);
  g.cap(circleRing(RC + 0.05, 40).concat([]), 63.9, 1);

  // ---- base: the OSM lobby footprints as plain concrete blocks with a cornice line
  const lowGeo = new Geo();
  const colliders = [{ p: worldRing(circleRing(R0, 16), (x, z) => [C[0] + x, C[1] + z]), b: base, h: 64 }];
  for (const { b } of lower) {
    const ring = [];
    for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i] - C[0], b.p[i + 1] - C[1]]);
    const y0 = b.b - base - 3, y1 = b.b - base + b.h;
    lowGeo.prism(ring, y0, y1 - 0.6, { top: false });
    lowGeo.prism(ring, y1 - 0.6, y1, { top: true });
    colliders.push({ p: b.p, b: b.b, h: b.h });
  }
  // a band of small windows on the lobby walls is skipped: the murals are inside

  const meshes = [mesh(g, concrete), mesh(op, dark, { cast: false }), mesh(lowGeo, concrete)];
  group.add(...meshes);
  const suppress = [{ x: C[0], z: C[1], r: 16 }];
  console.info(`[lm] coit tower at ${C.map(v => v.toFixed(1))} base ${base.toFixed(1)} (${lower.length} base parts)`);
  return { group, suppress, colliders, update: null };
}

// a dark round-arched window panel facing outward at angle a, on a cylinder of radius r
function archPanel(geo, a, r, y0, y1, hw) {
  const c = Math.cos(a), s = Math.sin(a), tx = -s, tz = c;
  const P = (u, y) => [c * r + tx * u, y, s * r + tz * u];
  const spring = y1 - hw;
  geo.quad(P(hw, y0), P(-hw, y0), P(-hw, spring), P(hw, spring), 0, 0, 1, 1, [c, 0, s]);
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI * i / N, t1 = Math.PI * (i + 1) / N;
    geo.tri(P(0, spring), P(Math.cos(t0) * hw, spring + Math.sin(t0) * hw), P(Math.cos(t1) * hw, spring + Math.sin(t1) * hw), [0, 0], [1, 0], [0, 1], [c, 0, s]);
  }
}
