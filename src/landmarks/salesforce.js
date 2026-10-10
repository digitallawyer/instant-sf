// Salesforce Tower (2018): 326 m, a rounded-square obelisk that tapers gently and curves in at the top,
// clad in glass with pale horizontal sunshades and vertical fins; the facade runs on past the 61st floor as
// an open lattice crown hiding an LED screen (Jim Campbell's "Day for Night") that plays slow moving
// images at night.
import * as THREE from 'three';
import { Geo, makeMat, mesh, worldRing, centroid, frame, GLSL_HASH, shared } from './common.js';

const H_ROOF = 270;     // top occupied floor / start of the crown
const H_TOP = 326;
const HALF0 = 26.5, HALF1 = 22.0; // half-width at the base and at the roof
const FLOOR = 4.2;

// low-resolution LED grid playing slow drifting figures and waves (vFac in metres; y relative to the roof)
const LED_GLSL = /* glsl */`
  float sfLed(vec2 fac, float t) {
    vec2 px = floor(vec2(fac.x / 1.52, fac.y / 1.4));
    float wave = 0.5 + 0.5 * sin(px.x * 0.11 + t * 1.3 + sin(px.y * 0.21 + t) * 2.0);
    float figs = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 c = vec2(mod(t * (6.0 + fi * 2.0) + fi * 37.0, 120.0), 12.0 + 6.0 * sin(t * 0.3 + fi));
      vec2 d = (px - c) / vec2(2.2, 7.0);
      figs = max(figs, 1.0 - smoothstep(0.6, 1.0, length(d)));
    }
    return mix(wave * 0.3 + 0.08, 1.0, figs) * (0.75 + 0.25 * lmHash(px));
  }
`;

export function buildSalesforce(ctx) {
  const { map, project } = ctx;
  let C = project(37.78974, -122.39687), b0 = 4.5, dir = [1, 0];
  const parts = map.buildings.filter(b => b.h > 300).map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 70);
  if (parts.length) {
    // the centre: average of all tower parts weighted by vertex extents
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const { b } of parts) for (let i = 0; i < b.p.length; i += 2) { x0 = Math.min(x0, b.p[i]); x1 = Math.max(x1, b.p[i]); z0 = Math.min(z0, b.p[i + 1]); z1 = Math.max(z1, b.p[i + 1]); }
    C = [(x0 + x1) / 2, (z0 + z1) / 2];
    b0 = Math.min(...parts.map(o => o.b.b));
  }
  const F = frame(C[0], C[1], 0, -1);
  void dir;
  const group = new THREE.Group();
  group.name = 'salesforce-tower';
  F.apply(group);
  group.position.y = b0;

  // plan: rounded square whose half-width tapers with height; corners radius ~ 30% of the half-width
  const halfAt = y => {
    if (y <= H_ROOF) return HALF0 + (HALF1 - HALF0) * (y / H_ROOF);
    // the crown keeps tapering and curves in towards the top
    const t = (y - H_ROOF) / (H_TOP - H_ROOF);
    return HALF1 - 1.5 * t - 9.5 * Math.pow(t, 3.2);
  };
  const SEG = 6;
  const plan = (y, inset = 0) => {
    const h = halfAt(y) - inset, r = h * 0.34;
    const out = [];
    const corners = [[h - r, h - r, 0], [-(h - r), h - r, Math.PI / 2], [-(h - r), -(h - r), Math.PI], [h - r, -(h - r), Math.PI * 1.5]];
    for (const [x, z, a0] of corners) for (let i = 0; i <= SEG; i++) { const a = a0 + (Math.PI / 2) * i / SEG; out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
    return out;
  };
  // perimeter coordinate (u) of each plan vertex, normalised to the perimeter at that height
  const perim = ring => { const u = [0]; for (let i = 1; i <= ring.length; i++) { const a = ring[i - 1], b = ring[i % ring.length]; u.push(u[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); } return u; };

  // ---------------------------------------------------------------- materials
  const glass = makeMat(ctx, { color: '#9fb0bb', roughness: 0.15, metalness: 0.55 }, {
    worldPos: true, name: 'sf-facade', hook: shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;\nfloat gR; float gM; vec3 gE;\n' + GLSL_HASH)
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          vec2 f = vFac; // u: metres around the perimeter, v: metres above the base
          float fy = f.y / ${FLOOR.toFixed(1)};
          float fl = floor(fy);
          float ly = fract(fy) * ${FLOOR.toFixed(1)};
          float col = f.x / 1.52;
          float lx = abs(fract(col) - 0.5) * 1.52;
          float aa = 1.0 - smoothstep(0.2, 0.55, max(fwidth(fy), fwidth(col)));
          // pale sunshade band at each slab and a thinner one at mid-height, slim vertical fins
          float e = fwidth(ly) + 0.01;
          float shade = 1.0 - smoothstep(0.55 - e, 0.55 + e, abs(ly - 0.25));
          float shade2 = (1.0 - smoothstep(0.08 - e, 0.08 + e, abs(ly - 2.6))) * 0.8;
          float fin = 1.0 - smoothstep(0.05, 0.05 + fwidth(f.x) + 0.02, lx);
          float metal = clamp(max(max(shade, shade2), fin), 0.0, 1.0);
          float metalAvg = 0.5;
          float m = mix(metalAvg, metal, aa);
          vec3 glassC = vec3(0.5, 0.58, 0.64) * (0.9 + 0.15 * lmHash(vec2(floor(col), fl)));
          vec3 white = vec3(0.9, 0.9, 0.88);
          diffuseColor.rgb = mix(glassC, white, m) * (1.0 - 0.5 * uNight);
          gR = mix(0.08, 0.45, m);
          gM = mix(0.5, 0.05, m);
          // offices at night
          vec2 id = vec2(floor(col / 2.0), fl);
          float lit = step(lmHash(id * 0.917 + 4.2), 0.42) * step(f.y, ${(H_ROOF - 2).toFixed(1)}) * step(4.5, f.y);
          vec3 warm = mix(vec3(0.95, 0.85, 0.7), vec3(0.8, 0.88, 1.0), step(0.6, lmHash(id * 1.3)));
          float farLit = 0.045 * (0.6 + 0.8 * lmNoise(vec2(f.x * 0.05, f.y * 0.12)));
          gE = warm * (1.0 - m) * uNight * mix(farLit, lit * 1.3, aa);
        `)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gR;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gM;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gE;');
    },
  });
  const uCrown = { value: 0 };
  const crownMat = makeMat(ctx, { color: '#e2e3e0', roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }, {
    name: 'sf-crown', hook: shader => {
      shader.uniforms.uCrown = uCrown;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCrown;\n' + GLSL_HASH + LED_GLSL)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(1.0, 0.97, 0.92) * sfLed(vFac - vec2(0.0, ${H_ROOF.toFixed(1)}), uTime * 0.35) * uCrown * 1.4 * step(vFac.y, ${(H_ROOF + 44).toFixed(1)});`);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;\n')
        .replace('#include <alphatest_fragment>', /* glsl */`
          // open lattice: horizontal louvres every 1.4 m and vertical fins every 1.52 m
          float ly = abs(fract(vFac.y / 1.4) - 0.5) * 1.4;
          float lx = abs(fract(vFac.x / 1.52) - 0.5) * 1.52;
          float bar = max(1.0 - step(0.2, ly), 1.0 - step(0.09, lx));
          float far = smoothstep(0.25, 0.7, max(fwidth(vFac.y / 1.4), fwidth(vFac.x / 1.52)));
          if (max(bar, far * 0.6) < 0.5) discard;
        `);
    },
  });
  const screenMat = makeMat(ctx, { color: '#5d646a', roughness: 0.7, metalness: 0.2 }, {
    name: 'sf-screen', hook: shader => {
      shader.uniforms.uCrown = uCrown;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;\nuniform float uCrown;\n' + GLSL_HASH + LED_GLSL)
        .replace('#include <emissivemap_fragment>', /* glsl */`
          #include <emissivemap_fragment>
          vec2 px = floor(vec2(vFac.x / 1.52, vFac.y / 1.4));
          float led = sfLed(vFac, uTime * 0.35);
          float dotMask = 0.55 + 0.45 * step(0.25, fract(vFac.x / 1.52)) * step(0.25, fract(vFac.y / 1.4));
          totalEmissiveRadiance += vec3(1.0, 0.97, 0.92) * led * dotMask * uCrown * 2.2;
        `);
    },
  });

  // ---------------------------------------------------------------- tower body
  const body = new Geo();
  const LEVELS = 12;
  for (let k = 0; k < LEVELS; k++) {
    const y0 = H_ROOF * k / LEVELS, y1 = H_ROOF * (k + 1) / LEVELS;
    const A = plan(y0), B = plan(y1), uA = perim(A), uB = perim(B);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      // u in metres around the perimeter (scaled to the lower ring so fins stay vertical-ish)
      const ua0 = uA[i], ua1 = uA[i + 1], ub0 = uB[i] * uA[A.length] / uB[B.length], ub1 = uB[i + 1] * uA[A.length] / uB[B.length];
      const nx = (A[i][0] + A[j][0]) / 2, nz = (A[i][1] + A[j][1]) / 2;
      body.tri([A[i][0], y0 - (k === 0 ? 2 : 0), A[i][1]], [A[j][0], y0 - (k === 0 ? 2 : 0), A[j][1]], [B[j][0], y1, B[j][1]], [ua0, y0], [ua1, y0], [ub1, y1], [nx, 0, nz]);
      body.tri([A[i][0], y0 - (k === 0 ? 2 : 0), A[i][1]], [B[j][0], y1, B[j][1]], [B[i][0], y1, B[i][1]], [ua0, y0], [ub1, y1], [ub0, y1], [nx, 0, nz]);
    }
  }
  // roof slab (inside the crown) and the base canopy line
  body.cap(plan(H_ROOF, 0.6), H_ROOF, 1);
  // street-level glass is set back a little under a white canopy band
  const base = new Geo();
  const P0 = plan(0), P1 = plan(10);
  base.loft(plan(9.6, -0.5), 9.6, plan(10.6, -0.5), 10.6);
  base.cap(plan(10.6, -0.5), 10.6, 1);
  void P0; void P1;

  // ---------------------------------------------------------------- crown: lattice shell + LED screen inside
  const crown = new Geo(), screen = new Geo();
  const CL = 10;
  for (let k = 0; k < CL; k++) {
    const y0 = H_ROOF + (H_TOP - H_ROOF) * k / CL, y1 = H_ROOF + (H_TOP - H_ROOF) * (k + 1) / CL;
    const A = plan(y0), B = plan(y1), uA = perim(A);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      crown.quad([A[i][0], y0, A[i][1]], [A[j][0], y0, A[j][1]], [B[j][0], y1, B[j][1]], [B[i][0], y1, B[i][1]], uA[i], y0, uA[i + 1], y1, [(A[i][0] + A[j][0]), 0, (A[i][1] + A[j][1])]);
      if (y1 < H_ROOF + 42) {
        const Ai = plan(y0, 3.2), Bi = plan(y1, 3.2), ui = perim(Ai);
        screen.quad([Ai[i][0], y0, Ai[i][1]], [Ai[j][0], y0, Ai[j][1]], [Bi[j][0], y1, Bi[j][1]], [Bi[i][0], y1, Bi[i][1]], ui[i], y0 - H_ROOF, ui[i + 1], y1 - H_ROOF, [(A[i][0] + A[j][0]), 0, (A[i][1] + A[j][1])]);
      }
    }
  }
  // the screen's top and a maintenance deck
  screen.cap(plan(H_ROOF + 42, 3.2), H_ROOF + 42, 1);
  // a crown ring at the roofline
  crown.loft(plan(H_ROOF - 0.6, -0.3), H_ROOF - 0.6, plan(H_ROOF + 0.6, -0.3), H_ROOF + 0.6);

  const white = makeMat(ctx, { color: '#e6e6e2', roughness: 0.5 }, { name: 'sf-white' });
  const meshes = [mesh(body, glass), mesh(base, white), mesh(crown, crownMat), mesh(screen, screenMat, { cast: false })];
  group.add(...meshes);

  const colliders = [{ p: worldRing(plan(0), F.toWorld), b: b0, h: H_TOP }];
  const suppress = parts.length ? [{ x: C[0], z: C[1], r: 34 }] : [];
  const update = () => { uCrown.value = shared.uNight.value; };
  console.info(`[lm] salesforce tower at ${C.map(v => v.toFixed(1))} base ${b0}, ${parts.length} OSM parts replaced`);
  return { group, suppress, colliders, update };
}
