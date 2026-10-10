// Rooftop clutter on flat roofs: HVAC units, elevator / stair penthouses, SF's wooden water tanks on
// steel stands, antennas, skylights, solar arrays, vent stacks and brick chimneys. Placed
// deterministically per building (inset from the parapet, aligned with the footprint), drawn as one
// InstancedMesh per kind; the instance sets are refilled from a coarse grid as the camera moves so
// only the clutter within each kind's view range is drawn.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, addHook, useShared } from './fog.js';

function rand(seed) { let s = seed | 0; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; }; }
function insidePoly(x, z, p) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function edgeDist(x, z, p) {
  let best = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j], az = p[j + 1], dx = p[i] - ax, dz = p[i + 1] - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// geometry with a per-vertex part id in aPart (used by the shader)
function withPart(g, part) {
  g = g.index ? g.toNonIndexed() : g;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
  return g;
}
const openBox = () => { const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); return g; };
function tankGeometry() {
  // unit tank: 1 m radius, staves from 0 to 1 (scaled later), conical roof, four legs, a deck
  const legH = 1;
  const parts = [
    withPart(new THREE.CylinderGeometry(1, 1.04, 1, 14, 1, true).translate(0, legH + 0.5, 0), 0),
    withPart(new THREE.ConeGeometry(1.08, 0.38, 14, 1, true).translate(0, legH + 1.19, 0), 1),
    withPart(new THREE.CylinderGeometry(1.1, 1.1, 0.08, 14).translate(0, legH - 0.04, 0), 2),
  ];
  for (const [x, z] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) parts.push(withPart(new THREE.BoxGeometry(0.09, legH, 0.09).translate(x, legH / 2, z), 2));
  parts.push(withPart(new THREE.BoxGeometry(1.5, 0.05, 0.05).translate(0, legH * 0.45, 0.7), 2), withPart(new THREE.BoxGeometry(1.5, 0.05, 0.05).translate(0, legH * 0.45, -0.7), 2));
  return mergeGeometries(parts);
}
function ventGeometry() {
  return mergeGeometries([
    withPart(new THREE.CylinderGeometry(0.5, 0.5, 1, 7, 1, true).translate(0, 0.5, 0), 0),
    withPart(new THREE.ConeGeometry(0.95, 0.35, 7).translate(0, 1.12, 0), 1),
  ]);
}
function antennaGeometry() {
  return mergeGeometries([
    withPart(new THREE.CylinderGeometry(0.035, 0.06, 1, 5, 1, true).translate(0, 0.5, 0), 0),
    withPart(new THREE.BoxGeometry(0.9, 0.025, 0.025).translate(0, 0.72, 0), 1),
    withPart(new THREE.BoxGeometry(0.025, 0.025, 0.6).translate(0, 0.86, 0), 1),
    withPart(new THREE.BoxGeometry(0.12, 0.28, 0.08).translate(0.05, 0.62, 0.06), 2),
  ]);
}
function skylightGeometry() {
  // curb box with a shallow glass hip on top (unit footprint)
  const curb = withPart(new THREE.BoxGeometry(1, 0.3, 1).translate(0, 0.15, 0), 0);
  const top = new THREE.ConeGeometry(0.71, 0.22, 4, 1, true).rotateY(Math.PI / 4).scale(1, 1, 1).translate(0, 0.41, 0);
  return mergeGeometries([curb, withPart(top, 1)]);
}
function solarGeometry() {
  // one row of panels tilted 20 degrees towards +z, on a low frame (unit length along x)
  const panel = withPart(new THREE.BoxGeometry(1, 0.04, 1).rotateX(0.35).translate(0, 0.42, 0), 1);
  const legs = withPart(mergeGeometries([new THREE.BoxGeometry(0.04, 0.5, 0.04).translate(-0.45, 0.25, -0.35), new THREE.BoxGeometry(0.04, 0.5, 0.04).translate(0.45, 0.25, -0.35)].map(g => g.toNonIndexed())), 2);
  return mergeGeometries([panel, legs]);
}
const boxGeometry = () => withPart(openBox(), 0);
function chimneyGeometry() {
  return mergeGeometries([withPart(openBox(), 0), withPart(new THREE.BoxGeometry(1.15, 0.1, 1.15).translate(0, 1.0, 0), 1)]);
}

// kind: id, geometry, view range (m), casts shadow
const KINDS = [
  { id: 0, name: 'hvac', geo: boxGeometry, range: 1400, shadow: true },
  { id: 1, name: 'penthouse', geo: boxGeometry, range: 2600, shadow: true },
  { id: 2, name: 'tank', geo: tankGeometry, range: 1600, shadow: true },
  { id: 3, name: 'vent', geo: ventGeometry, range: 380, shadow: false },
  { id: 4, name: 'antenna', geo: antennaGeometry, range: 1500, shadow: true },
  { id: 5, name: 'skylight', geo: skylightGeometry, range: 800, shadow: false },
  { id: 6, name: 'solar', geo: solarGeometry, range: 1000, shadow: false },
  { id: 7, name: 'chimney', geo: chimneyGeometry, range: 700, shadow: true },
];

const ROOF_GLSL = /* glsl */`
varying vec3 vRP;      // object-space position (unit geometry)
varying vec3 vRN;      // object-space normal
varying vec3 vRS;      // instance scale
varying float vPart;
varying vec3 vRW;
${GLSL_NOISE}
float gRR; float gRM; vec3 gRE;
`;

function roofMaterial(csm, kind) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: kind.id === 5 ? THREE.FrontSide : THREE.FrontSide });
  mat.name = 'rooftop-' + kind.name;
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.defines = shader.defines || {};
    shader.defines.RT = kind.id;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying vec3 vRP;\nvarying vec3 vRN;\nvarying vec3 vRS;\nvarying float vPart;\nvarying vec3 vRW;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRP = position; vRN = normal; vPart = aPart;
        #ifdef USE_INSTANCING
          vRS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #else
          vRS = vec3(1.0);
        #endif`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ROOF_GLSL)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vec3 c = diffuseColor.rgb;
        gRR = 0.75; gRM = 0.0; gRE = vec3(0.0);
        vec3 m = vRP * vRS;                 // metres in the unit's own frame
        float px = fwidth(m.x) + fwidth(m.y) + fwidth(m.z) + 1e-4;
        float grime = 0.85 + 0.25 * vnoise(vRW.xz * 0.8 + vRW.y);
        bool top = vRN.y > 0.5;
        #if RT == 0
          // packaged HVAC unit: louvred sides, fan grilles on top
          if (top) {
            float nf = vRS.x > vRS.z * 1.6 ? 2.0 : 1.0;
            float cell = vRS.x / nf;
            vec2 q = vec2(mod(m.x + vRS.x * 0.5, cell) - cell * 0.5, m.z);
            float r = length(q), R = min(cell, vRS.z) * 0.36;
            float fan = 1.0 - smoothstep(R - px, R + px, r);
            float ring = step(0.5, fract(r * 14.0)) * fan;
            c = mix(c, vec3(0.12, 0.12, 0.12) + ring * 0.12, fan);
          } else {
            float lv = step(0.55, fract(m.y * 16.0)) * step(m.y, vRS.y * 0.62) * step(0.12, m.y);
            c *= 1.0 - 0.35 * lv * (1.0 - smoothstep(0.02, 0.06, px));
            c *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 0.25, m.y));
          }
          gRR = 0.55; gRM = 0.3;
        #elif RT == 1
          // penthouse / bulkhead: a door, a louvre band, a dark membrane roof
          if (top) { c = vec3(0.32, 0.31, 0.3) * (0.9 + 0.2 * vnoise(m.xz * 2.0)); gRR = 0.92; }
          else {
            vec3 an = abs(vRN);
            float u = an.x > an.z ? m.z : m.x;
            float door = step(abs(u - 0.3), 0.45) * step(m.y, min(2.1, vRS.y - 0.4)) * step(0.5, vRN.z);
            c = mix(c, vec3(0.25, 0.27, 0.28), door);
            float louv = step(vRS.y - 1.1, m.y) * step(m.y, vRS.y - 0.4) * step(0.5, -vRN.x) * step(0.5, fract(m.y * 12.0));
            c = mix(c, c * 0.55, louv);
            c *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.6, m.y));
            c *= 1.0 - 0.12 * smoothstep(0.55, 0.8, vnoise(vec2(u * 2.0, m.y * 0.2)));
            gRR = 0.85;
          }
        #elif RT == 2
          // redwood water tank: vertical staves with steel hoops, a tar-paper cone, black steel stand
          if (vPart < 0.5) {
            float ang = atan(vRP.z, vRP.x) * vRS.x;
            float stave = abs(fract(ang / 0.14) - 0.5);
            c = mix(vec3(0.36, 0.25, 0.17), vec3(0.5, 0.38, 0.26), hash12(vec2(floor(ang / 0.14), 3.0))) * grime;
            c *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.08 + px * 2.0, stave)) * (1.0 - smoothstep(0.03, 0.1, px));
            float hoop = 1.0 - smoothstep(0.0, 0.03 + px, abs(fract(m.y / 0.55) - 0.5) * 0.55 - 0.0);
            c = mix(c, vec3(0.12, 0.11, 0.1), hoop * 0.9);
            c *= 0.8 + 0.2 * smoothstep(0.5, 2.0, vRP.y);
            gRR = 0.9;
          } else if (vPart < 1.5) { c = vec3(0.2, 0.19, 0.18) * grime; gRR = 0.8; }
          else { c = vec3(0.1, 0.1, 0.1); gRR = 0.6; gRM = 0.5; }
        #elif RT == 3
          c = vec3(0.42, 0.42, 0.41) * grime; gRR = 0.45; gRM = 0.6;
        #elif RT == 4
          c = vec3(0.55, 0.56, 0.57); gRR = 0.4; gRM = 0.8;
          if (vPart > 1.5) c = vec3(0.8, 0.8, 0.78);
          // red-and-white bands on the tall masts
          if (vPart < 0.5 && vRS.y > 9.0) c = mix(c, vec3(0.7, 0.12, 0.08), step(0.5, fract(vRP.y * 6.0)) * step(0.66, vRP.y));
          gRE = vec3(1.0, 0.08, 0.04) * step(0.985, vRP.y) * step(0.5, fract(uTime * 0.5 + vRW.x * 0.01)) * 6.0 * uNight * step(9.0, vRS.y);
        #elif RT == 5
          if (vPart > 0.5) { c = vec3(0.06, 0.08, 0.09); gRR = 0.05; gRM = 0.0; }
          else { c *= grime; gRR = 0.7; }
        #elif RT == 6
          if (vPart > 0.5 && top) {
            vec2 q = vec2(m.x, vRP.z * 1.06) / vec2(0.99, 0.165) ;
            vec2 g = abs(fract(q) - 0.5);
            float frameL = 1.0 - smoothstep(0.44, 0.47, max(g.x * 0.99 / 0.165 * 0.08, g.y));
            c = mix(vec3(0.7, 0.72, 0.74), vec3(0.03, 0.05, 0.1) + 0.03 * hash12(floor(q)), frameL);
            gRR = mix(0.4, 0.12, frameL); gRM = mix(0.8, 0.1, frameL);
          } else { c = vec3(0.6, 0.62, 0.63); gRR = 0.4; gRM = 0.8; }
        #elif RT == 7
          // brick chimney with a concrete cap
          if (vPart < 0.5) {
            vec2 q = vec2((abs(vRN.x) > 0.5 ? m.z : m.x) / 0.225, m.y / 0.076);
            q.x += mod(floor(q.y), 2.0) * 0.5;
            vec2 g = abs(fract(q) - 0.5);
            float mort = smoothstep(0.42, 0.48, max(g.x, g.y * 0.33 / 0.33)) * (1.0 - smoothstep(0.02, 0.05, px));
            c = mix(c * (0.85 + 0.3 * hash12(floor(q))), vec3(0.6, 0.58, 0.55), mort);
            c *= 1.0 - 0.35 * smoothstep(0.6, 1.0, vRP.y);   // soot near the top
            gRR = 0.9;
          } else { c = vec3(0.55, 0.54, 0.52); gRR = 0.85; }
        #endif
        diffuseColor.rgb = c;
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gRM;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gRE;');
  });
  return mat;
}

export function createRooftops(map, csm) {
  const lists = KINDS.map(() => []);   // per kind: [x, z, m(16), c(3)]
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const add = (k, x, y, z, yaw, sx, sy, sz, col) => {
    q.setFromAxisAngle(up, yaw);
    m4.compose(pos.set(x, y, z), q, scl.set(sx, sy, sz));
    lists[k].push({ x, z, m: m4.toArray(new Float32Array(16)), c: col });
  };
  const grey = (r, v) => { const l = v * (0.9 + r() * 0.2); return [l, l * (0.99 + r() * 0.02), l * (0.97 + r() * 0.04)]; };

  map.buildings.forEach((b, index) => {
    if (b.part || (b.rs && b.rs !== 'flat') || b.h <= 8) return;
    const p = b.p, n = p.length / 2;
    if (n < 3) return;
    let A = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { A += p[j] * p[i + 1] - p[i] * p[j + 1]; x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    A = Math.abs(A) / 2;
    if (A < 45) return;
    const kind = b.k || 0;
    const parapet = kind !== 4 && kind !== 5 ? (b.h > 40 ? 1.4 : 0.8) : 0;
    const roofY = b.b + b.h - parapet - 0.02;
    const r = rand(index * 3571 + 77);
    // align with the longest edge
    let bestL = 0, yaw = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1], L = Math.hypot(dx, dz); if (L > bestL) { bestL = L; yaw = Math.atan2(-dz, dx); } }
    const placed = [];
    // find a free spot for a footprint of radius rad, inset from the roof edge
    const spot = (rad, inset = 0.9, tries = 12) => {
      for (let t = 0; t < tries; t++) {
        const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
        if (!insidePoly(x, z, p)) continue;
        if (edgeDist(x, z, p) < rad + inset) continue;
        if (placed.some(s => Math.hypot(s[0] - x, s[1] - z) < s[2] + rad + 0.5)) continue;
        placed.push([x, z, rad]);
        return [x, z];
      }
      return null;
    };
    const tall = b.h > 48, mid = b.h > 14;
    const oldish = !tall && b.h < 60 && b.mat !== 'glass';
    const big = A > 600, huge = A > 2000;
    // elevator / stair penthouse, or a mechanical penthouse on towers
    if (tall && A > 250) {
      const w = Math.sqrt(A) * (0.35 + r() * 0.2), d = w * (0.6 + r() * 0.4), h = 3.5 + r() * 3.5;
      const s = spot(Math.hypot(w, d) / 2, 1.5, 20);
      if (s) add(1, s[0], roofY, s[1], yaw, w, h, d, grey(r, 0.55 + r() * 0.2));
    } else if ((mid && A > 180 && r() < 0.7) || (A > 120 && r() < 0.25)) {
      const w = 2.4 + r() * (big ? 3.5 : 1.5), d = 2.2 + r() * 1.6, h = 2.4 + r() * (big ? 1.6 : 0.8);
      const s = spot(Math.hypot(w, d) / 2, 1.0);
      if (s) add(1, s[0], roofY, s[1], yaw, w, h, d, grey(r, 0.5 + r() * 0.25));
    }
    // water tank
    if (oldish && mid && A > 150 && r() < (big ? 0.45 : 0.25)) {
      const rad = 1.6 + r() * 1.2, th = 3.0 + r() * 1.6;
      const s = spot(rad + 0.3, 1.2);
      // unit tank: stand 0..1, staves 1..2, roof cone above; one vertical scale for stand and tank
      if (s) add(2, s[0], roofY, s[1], r() * 6.28, rad, th, rad, [1, 1, 1]);
    }
    // HVAC units
    const nh = huge ? 4 + Math.floor(r() * 7) : big ? 2 + Math.floor(r() * 4) : A > 200 ? Math.floor(r() * 3) : r() < 0.3 ? 1 : 0;
    for (let i = 0; i < nh; i++) {
      const w = 1.2 + r() * (big ? 2.8 : 1.4), d = 0.9 + r() * 1.3, h = 0.8 + r() * 1.0;
      const s = spot(Math.hypot(w, d) / 2, 0.8);
      if (s) add(0, s[0], roofY, s[1], yaw + (r() < 0.2 ? Math.PI / 2 : 0), w, h, d, grey(r, 0.62 + r() * 0.2));
    }
    // antennas and masts
    if ((tall && r() < 0.55) || (mid && big && r() < 0.25) || (b.h > 25 && r() < 0.15)) {
      const na = 1 + Math.floor(r() * (tall ? 3 : 2));
      for (let i = 0; i < na; i++) {
        const h = tall ? 5 + r() * 12 : 3 + r() * 5;
        const s = spot(0.4, 1.0);
        if (s) add(4, s[0], roofY, s[1], r() * 6.28, 1, h, 1, [1, 1, 1]);
      }
    }
    // skylights
    const ns = A < 200 ? (r() < 0.4 ? 1 : 0) : Math.floor(r() * (big ? 5 : 3));
    for (let i = 0; i < ns; i++) {
      const w = 0.9 + r() * 1.4, d = 0.9 + r() * 1.2;
      const s = spot(Math.hypot(w, d) / 2, 0.6);
      if (s) add(5, s[0], roofY, s[1], yaw, w, 1, d, grey(r, 0.7));
    }
    // solar array: rows facing south (+z)
    if (!tall && r() < (A < 400 ? 0.1 : 0.14)) {
      const rows = 1 + Math.floor(r() * (A < 400 ? 2 : 5)), len = 2 + r() * Math.min(10, Math.sqrt(A) * 0.4);
      const s = spot(Math.hypot(len, rows * 1.6) / 2, 1.0);
      if (s) for (let i = 0; i < rows; i++) add(6, s[0], roofY, s[1] + (i - (rows - 1) / 2) * 1.6, 0, len, 1, 1.0, [1, 1, 1]);
    }
    // vent stacks
    const nv = 1 + Math.floor(r() * (big ? 6 : 3));
    for (let i = 0; i < nv; i++) {
      const rr = 0.08 + r() * 0.12, h = 0.4 + r() * 0.8;
      const s = spot(rr * 2, 0.4, 6);
      if (s) add(3, s[0], roofY, s[1], 0, rr * 2, h, rr * 2, [1, 1, 1]);
    }
    // brick chimneys on small residential blocks
    if (!tall && b.h < 22 && A < 600 && r() < 0.35) {
      const w = 0.6 + r() * 0.5, d = 0.5 + r() * 0.6, h = 1.0 + r() * 1.3;
      const s = spot(0.6, 0.35, 8);
      const brick = [[0.6, 0.33, 0.25], [0.52, 0.3, 0.24], [0.66, 0.4, 0.3]][Math.floor(r() * 3)];
      if (s) add(7, s[0], roofY, s[1], yaw, w, h, d, brick);
    }
  });

  // grid buckets for range queries
  const CELL = 200;
  const group = new THREE.Group();
  group.name = 'rooftops';
  const types = KINDS.map((k, i) => {
    const list = lists[i];
    const cells = new Map();
    list.forEach((it, j) => { const key = Math.floor(it.x / CELL) + ',' + Math.floor(it.z / CELL); let c = cells.get(key); if (!c) cells.set(key, c = []); c.push(j); });
    const mesh = new THREE.InstancedMesh(k.geo(), roofMaterial(csm, k), Math.max(1, list.length));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3).fill(1), 3);
    mesh.count = 0;
    mesh.castShadow = k.shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return { k, list, cells, mesh };
  });

  let lastX = Infinity, lastZ = Infinity;
  function update(cam) {
    if (Math.hypot(cam.x - lastX, cam.z - lastZ) < 30) return;
    lastX = cam.x; lastZ = cam.z;
    for (const t of types) {
      const R = t.k.range, R2 = R * R;
      const ma = t.mesh.instanceMatrix.array, ca = t.mesh.instanceColor.array;
      let n = 0;
      const cx0 = Math.floor((cam.x - R) / CELL), cx1 = Math.floor((cam.x + R) / CELL);
      const cz0 = Math.floor((cam.z - R) / CELL), cz1 = Math.floor((cam.z + R) / CELL);
      for (let gx = cx0; gx <= cx1; gx++) for (let gz = cz0; gz <= cz1; gz++) {
        const cell = t.cells.get(gx + ',' + gz);
        if (!cell) continue;
        for (const j of cell) {
          const it = t.list[j];
          if ((it.x - cam.x) ** 2 + (it.z - cam.z) ** 2 > R2) continue;
          ma.set(it.m, n * 16); ca.set(it.c, n * 3); n++;
        }
      }
      t.mesh.count = n;
      t.mesh.instanceMatrix.needsUpdate = true;
      t.mesh.instanceColor.needsUpdate = true;
    }
  }
  group.userData.update = update;
  group.userData.counts = Object.fromEntries(types.map(t => [t.k.name, t.list.length]));
  return group;
}
