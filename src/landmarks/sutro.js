// Sutro Tower (1973): the 298 m three-legged TV mast on Mount Sutro. Three lattice legs splay out from a
// wide triangular base, pinch in to a waist about half way up, then fan out again to the trident top:
// the triangular antenna deck and the three masts with their antennas. Painted in red and white
// aviation bands; red obstruction lights blink at night (and stay visible above Karl the Fog).
// All lattice members are one InstancedMesh with per-instance colour.
import * as THREE from 'three';
import { makeMat, glowPoints, worldRing, centroid, circleRing, shared } from './common.js';

const H = 298;
// fitted to the OSM building:parts of the tower (leg centroids per 26 m band)
const R_BASE = 27.2;   // leg circumradius at the ground
const Y_WAIST = 172, R_WAIST = 10.3;
const Y_DECK = 228, R_DECK = 17.8;   // the trident's crossarm; the masts rise vertically above it
let LEG_ROT = Math.PI;               // one leg points west (overridden by OSM)

// centre line of a leg (radius from the axis) as a function of height
function legR(y) {
  if (y <= Y_WAIST) return R_BASE + (R_WAIST - R_BASE) * (y / Y_WAIST);
  if (y <= Y_DECK) return R_WAIST + (R_DECK - R_WAIST) * ((y - Y_WAIST) / (Y_DECK - Y_WAIST));
  return R_DECK;
}
// half-size (circumradius) of the triangular lattice section of a leg
function legW(y) { return y < Y_WAIST ? 2.6 - 0.9 * (y / Y_WAIST) : y < Y_DECK ? 1.7 : 1.7 - 1.0 * (y - Y_DECK) / (H - Y_DECK); }

export function buildSutro(ctx) {
  const { map, project, hf } = ctx;
  let C = project(37.75520, -122.45280);
  // OSM maps the tower as steel building:parts (legs in 26 m colour bands, platforms, masts): centre on the
  // three masts and take the leg orientation from them, then replace all the steel parts
  const steelParts = map.buildings.map(b => ({ b, c: centroid(b.p) })).filter(o => o.b.part && o.b.mat === 'steel' && Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 50 && o.b.h > 20);
  const masts = steelParts.filter(o => o.b.h > 280 && (o.b.m || 0) > 200);
  if (masts.length === 3) {
    C = [masts.reduce((a, o) => a + o.c[0], 0) / 3, masts.reduce((a, o) => a + o.c[1], 0) / 3];
    const m0 = masts.reduce((best, o) => (Math.atan2(-(o.c[1] - C[1]), o.c[0] - C[0]) + Math.PI * 2) % (Math.PI * 2) < best[0] ? [(Math.atan2(-(o.c[1] - C[1]), o.c[0] - C[0]) + Math.PI * 2) % (Math.PI * 2), o] : best, [99, null]);
    LEG_ROT = m0[0];
  }
  const osm = steelParts;
  const ground = (x, z) => (hf.inside(x, z) ? hf.at(x, z) : 250);
  const legAng = i => LEG_ROT + i * Math.PI * 2 / 3;
  // base elevation: the highest of the three leg feet (legs are extended down to their own ground)
  const feet = [0, 1, 2].map(i => ground(C[0] + Math.cos(legAng(i)) * R_BASE, C[1] - Math.sin(legAng(i)) * R_BASE));
  const centreG = ground(C[0], C[1]);
  const base = Math.max(centreG, ...feet);

  const group = new THREE.Group();
  group.name = 'sutro-tower';
  group.position.set(C[0], base, C[1]);

  // positions in local space: x east, z south; leg i points at angle legAng(i) (counter-clockwise from east, seen from above)
  const P = (i, y, dr = 0, da = 0) => {
    const a = legAng(i), r = legR(y);
    return [Math.cos(a) * r + dr * Math.cos(a + da), y, -Math.sin(a) * r - dr * Math.sin(a + da)];
  };
  const chord = (i, k, y) => { const w = legW(y); const a = legAng(i) + k * Math.PI * 2 / 3; const c = P(i, y); return [c[0] + Math.cos(a) * w, y, c[2] - Math.sin(a) * w]; };

  const beams = []; // [a, b, thickness]
  const footY = i => feet[i] - base - 1.5;
  // ---- the three lattice legs
  const SEG = 6.2;
  for (let i = 0; i < 3; i++) {
    let y0 = footY(i);
    while (y0 < H - 0.1) {
      const y1 = Math.min(H, y0 + SEG);
      for (let k = 0; k < 3; k++) {
        const a0 = chord(i, k, Math.max(0, y0)), a1 = chord(i, k, y1);
        if (y0 < 0) a0[1] = y0;
        beams.push([a0, a1, 0.85]);
        const b1 = chord(i, (k + 1) % 3, y1);
        beams.push([a0, b1, 0.34]);           // diagonal on each face
        beams.push([a1, b1, 0.3]);            // horizontal ring
      }
      y0 = y1;
    }
  }
  // ---- bracing between the legs: horizontal triangles + X diagonals on the three faces
  const levels = [0, 28, 55, 85, 114.5, 142, Y_WAIST, 198.3, Y_DECK];
  for (let li = 0; li < levels.length; li++) {
    const y = levels[li];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (y > 0) beams.push([P(i, y), P(j, y), 0.8]);
      if (li < levels.length - 1) {
        const yn = levels[li + 1];
        beams.push([P(i, y), P(j, yn), 0.45]);
        beams.push([P(j, y), P(i, yn), 0.45]);
      }
    }
  }
  // ---- equipment platforms at the waist and below the deck (a ring of girders + radial spokes)
  for (const y of [55, 114.5, Y_WAIST, 198.3]) {
    for (let i = 0; i < 3; i++) {
      beams.push([[0, y, 0], P(i, y), 0.7]);
      const j = (i + 1) % 3;
      for (const t of [0.33, 0.66]) {
        const a = P(i, y), b = P(j, y);
        const m = [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
        beams.push([[0, y, 0], m, 0.35]);
      }
    }
  }
  // ---- the crossarm deck: a deep triangular truss between the leg tops
  for (const y of [Y_DECK, Y_DECK + 4]) for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    beams.push([P(i, y), P(j, y), 1.0]);
    beams.push([[0, y, 0], P(i, y), 0.6]);
  }
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    for (let s = 0; s < 6; s++) {
      const t0 = s / 6, t1 = (s + 1) / 6;
      const a = P(i, Y_DECK), b = P(j, Y_DECK);
      const pa = [a[0] + (b[0] - a[0]) * t0, Y_DECK, a[2] + (b[2] - a[2]) * t0], pb = [a[0] + (b[0] - a[0]) * t1, Y_DECK + 4, a[2] + (b[2] - a[2]) * t1];
      beams.push([pa, pb, 0.3]);
    }
  }
  // ---- antenna whips on the mast tops
  for (let i = 0; i < 3; i++) {
    const top = P(i, H);
    beams.push([top, [top[0], H + 6, top[2]], 0.35]);
  }

  // per-instance colour: aviation bands, 7 red / 7 white, red at the top
  const red = new THREE.Color('#c4362e'), white = new THREE.Color('#e9e7e1');
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const steel = makeMat(ctx, { color: '#ffffff', roughness: 0.55, metalness: 0.2 }, {
    worldPos: true, name: 'sutro-steel', hook: shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.03;`);
      // keep members at least ~0.8 px thick on screen so the lattice reads on the skyline instead of shimmering away
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          vec4 sw = modelMatrix * instanceMatrix * vec4(0.0, 0.0, transformed.z, 1.0);
          float d = length(cameraPosition - sw.xyz);
          float w = length(instanceMatrix[0].xyz);
          transformed.xy *= max(1.0, d * 0.00085 / w);
        }
        #endif`);
    },
  });
  const im = new THREE.InstancedMesh(geo, steel, beams.length);
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  beams.forEach(([a, b, w], n) => {
    Z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = Z.length(); Z.divideScalar(len || 1);
    const up = Math.abs(Z.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    X.crossVectors(up, Z).normalize(); Y.crossVectors(Z, X);
    m.makeBasis(X.multiplyScalar(w), Y.multiplyScalar(w), Z.multiplyScalar(len + w * 0.5));
    m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    im.setMatrixAt(n, m);
    const ym = (a[1] + b[1]) / 2;
    let isRed;
    if (ym < Y_DECK + 4) { const k = Math.floor(Math.max(0, ym) / 26); isRed = k >= 2 && k % 2 === 0; }
    else isRed = Math.floor((H - ym) / 11) % 2 === 0;
    im.setColorAt(n, isRed ? red : white);
  });
  im.castShadow = true; im.receiveShadow = true;
  im.computeBoundingSphere();
  group.add(im);

  // panel antennas clustered on the upper masts (white drums)
  const ant = [];
  for (let i = 0; i < 3; i++) for (let y = Y_DECK + 10; y < H - 4; y += 7) ant.push(P(i, y));
  for (let y = Y_DECK + 8; y < Y_DECK + 40; y += 8) for (let i = 0; i < 3; i++) ant.push(P(i, y, 2.4, i * 2));
  const antGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const antMesh = new THREE.InstancedMesh(antGeo, makeMat(ctx, { color: '#d8d6d0', roughness: 0.6 }, { name: 'sutro-antenna' }), ant.length);
  ant.forEach((p, n) => antMesh.setMatrixAt(n, new THREE.Matrix4().makeScale(1.3, 4.5, 1.3).setPosition(p[0], p[1], p[2])));
  antMesh.castShadow = true; antMesh.computeBoundingSphere();
  group.add(antMesh);

  // red obstruction lights: mast tops and the corners of each bracing level
  const lightPos = [];
  for (let i = 0; i < 3; i++) {
    const t = P(i, H); lightPos.push([t[0], H + 6.5, t[2]]);
    for (const y of [55, 114.5, Y_WAIST, Y_DECK + 4, 265]) lightPos.push(P(i, y, legW(y) + 0.4, 0));
  }
  const beacons = glowPoints(lightPos, new THREE.Color(1.0, 0.05, 0.02), 7);
  beacons.material.fog = false; // aviation lights cut through the fog layer
  group.add(beacons);

  const colliders = [0, 1, 2].map(i => {
    const c = P(i, 0);
    return { p: worldRing(circleRing(legW(0) + 0.6, 6, c[0], c[2]), (x, z) => [C[0] + x, C[1] + z]), b: feet[i] - 2, h: base - feet[i] + 60 };
  });
  const suppress = osm.map(o => ({ x: o.c[0], z: o.c[1], r: 1.2 }));
  let t = 0;
  const update = dt => {
    t += dt;
    const night = shared.uNight.value;
    // FAA style: slow synchronous flash, a faint glow by day too (they run 24/7)
    const on = (t % 2.0) < 1.1 ? 1 : 0.06;
    beacons.material.color.copy(beacons.material.userData.base).multiplyScalar((0.35 + night * 3.2) * on);
  };
  console.info(`[lm] sutro tower at ${C.map(v => v.toFixed(1))} base ${base.toFixed(1)} (feet ${feet.map(f => f.toFixed(0))}), ${beams.length} members`);
  return { group, suppress, colliders, update };
}
