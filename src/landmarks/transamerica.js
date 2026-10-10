// The Transamerica Pyramid (1972): a 260 m four-sided pyramid of white quartz-aggregate panels with
// a regular grid of deep-set pivoting windows, the two vertical "wings" (elevators east, stairs west)
// that break out of the slope from the 29th floor, the aluminium-clad spire with its beacon, and the
// base truss of raked columns around a recessed glass lobby.
import * as THREE from 'three';
import { Geo, makeMat, glowPoints, frame, mesh, worldRing, centroid, GLSL_HASH, shared } from './common.js';

const BASE_HALF = 26.6;   // half-width at street level (175 ft square)
const APEX = 256;         // where the faces would meet (above the base)
const TOP_FLOOR = 196;    // the spire starts above the 48th floor
const TRUSS = 16;         // height of the raked-column base
const FLOOR = 4.0, COL = 1.55;

export function buildTransamerica(ctx) {
  const { map, project } = ctx;
  // footprint from OSM: the pyramidal part, else the published coordinates
  let C = project(37.79519, -122.40279), dir = [1, 0], b0 = 5.4;
  const tp = map.buildings.filter(b => b.rs === 'pyramidal' && b.h > 200 && b.p.length === 8)
    .map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 60);
  if (tp.length) {
    const b = tp[0].b; C = tp[0].c; b0 = b.b;
    // the most east-pointing edge gives the orientation of the east-west axis
    let best = null;
    for (let i = 0; i < 4; i++) {
      const ex = b.p[((i + 1) % 4) * 2] - b.p[i * 2], ez = b.p[((i + 1) % 4) * 2 + 1] - b.p[i * 2 + 1];
      const l = Math.hypot(ex, ez); const e = [ex / l, ez / l];
      if (!best || e[0] > best[0]) best = e;
    }
    dir = best;
  }
  // frame: local +x = east axis of the building, local -z = north axis
  const F = frame(C[0], C[1], dir[1], -dir[0]);
  const group = new THREE.Group();
  group.name = 'transamerica';
  F.apply(group);
  group.position.y = b0;

  const slope = BASE_HALF / APEX;
  const hw = y => BASE_HALF - slope * y; // half-width at height y above the base

  // ---------------------------------------------------------------- materials
  const facade = makeMat(ctx, { color: '#e9e6de', roughness: 0.62, metalness: 0 }, {
    name: 'ta-facade', hook: shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFac;\nfloat gR; float gM; vec3 gE;\n' + GLSL_HASH + '\nfloat hash12b(vec2 p) { return lmHash(p * 0.731 + 11.3); }\n')
        .replace('#include <color_fragment>', /* glsl */`
          #include <color_fragment>
          gR = 0.62; gM = 0.0; gE = vec3(0.0);
          vec2 f = vFac;
          float halfW = ${BASE_HALF.toFixed(2)} - ${slope.toFixed(5)} * f.y;
          vec3 quartz = diffuseColor.rgb * (0.95 + 0.06 * lmNoise(f * vec2(0.7, 0.5)));
          // grid of pivoting windows: one per 5-ft module per floor, none in the corner piers
          vec2 g = vec2(f.x / ${COL.toFixed(2)} + 0.5, (f.y - ${TRUSS.toFixed(1)}) / ${FLOOR.toFixed(1)});
          vec2 id = floor(g);
          vec2 l = (fract(g) - vec2(0.5, 0.0)) * vec2(${COL.toFixed(2)}, ${FLOOR.toFixed(1)});
          float px = max(fwidth(g.x), fwidth(g.y));
          float aa = 1.0 - smoothstep(0.25, 0.6, px);
          float inside = step(abs(f.x) + 1.4, halfW) * step(${TRUSS.toFixed(1)} + 0.5, f.y) * step(f.y, ${TOP_FLOOR.toFixed(1)} - 1.0);
          float wx = 0.48, w0 = 1.05, w1 = 3.05;
          float dx = abs(l.x) - wx, dy = max(w0 - l.y, l.y - w1);
          float e = fwidth(l.x) * 0.8 + 0.01;
          float win = (1.0 - smoothstep(-e, e, max(dx, dy))) * inside;
          float reveal = (1.0 - smoothstep(-e, e, max(dx - 0.12, dy - 0.16))) * inside - win;
          float joint = (1.0 - smoothstep(0.0, e * 1.5, abs(l.y - 0.02))) * step(${TRUSS.toFixed(1)}, f.y);
          float lit = step(hash12b(id + 3.1), 0.36);
          vec3 glass = vec3(0.045, 0.06, 0.075);
          vec3 room = mix(vec3(1.0, 0.78, 0.52), vec3(0.85, 0.9, 1.0), step(0.75, hash12b(id * 1.7)));
          vec3 detail = mix(quartz, quartz * 0.55, reveal * 0.8);
          detail *= 1.0 - joint * 0.25;
          detail = mix(detail, glass, win);
          // far away: the average of white panels and dark glass
          vec3 avg = mix(quartz, glass, 0.26 * inside) * 0.98;
          diffuseColor.rgb = mix(avg, detail, aa);
          float glassAmt = win * aa + 0.26 * inside * (1.0 - aa);
          gR = mix(0.62, 0.12, glassAmt);
          gM = glassAmt * 0.6;
          gE = room * win * (lit * uNight * 1.6 + 0.02) * aa + room * 0.26 * inside * (1.0 - aa) * 0.36 * uNight * 1.2;
        `)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gR;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gM;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gE;');
    },
  });
  const quartz = makeMat(ctx, { color: '#e6e2d9', roughness: 0.7 }, {
    worldPos: true, name: 'ta-quartz', hook: shader => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_HASH)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 0.94 + 0.08 * lmNoise(vLmWorld.xz * 0.8 + vLmWorld.y * 0.6);
          float jy = abs(fract((vLmWorld.y - ${b0.toFixed(1)} - ${TRUSS.toFixed(1)}) / ${FLOOR.toFixed(1)} + 0.5) - 0.5) * ${FLOOR.toFixed(1)};
          diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.04 + fwidth(jy), jy)) * (1.0 - abs(vLmNormal.y));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.05;`);
    },
  });
  const alu = makeMat(ctx, { color: '#dcdedd', roughness: 0.45, metalness: 0.25 }, {
    worldPos: true, name: 'ta-spire', hook: shader => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // the spire is floodlit at night
          totalEmissiveRadiance += vec3(0.95, 0.93, 0.88) * uNight * (0.12 + 0.1 * smoothstep(${(b0 + 250).toFixed(1)}, ${(b0 + TOP_FLOOR).toFixed(1)}, vLmWorld.y));`);
    },
  });
  const glassMat = makeMat(ctx, { color: '#1b2328', roughness: 0.08, metalness: 0.8 }, {
    name: 'ta-lobby', hook: shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.85, 0.65) * (0.05 + uNight * 0.7);');
    },
  });

  // ---------------------------------------------------------------- body: four sloping faces
  const body = new Geo();
  const sq = (h) => [[-h, -h], [h, -h], [h, h], [-h, h]]; // x, z
  // each face: a trapezoid from y0 to y1 with u = metres from the face centreline, v = height
  const face = (geo, y0, y1) => {
    const a = hw(y0), b = hw(y1);
    // outward normals: -z (north), +x (east), +z (south), -x (west)
    const faces = [
      [[a, y0, -a], [-a, y0, -a], [-b, y1, -b], [b, y1, -b]],
      [[a, y0, a], [a, y0, -a], [b, y1, -b], [b, y1, b]],
      [[-a, y0, a], [a, y0, a], [b, y1, b], [-b, y1, b]],
      [[-a, y0, -a], [-a, y0, a], [-b, y1, b], [-b, y1, -b]],
    ];
    const outs = [[0, 0.1, -1], [1, 0.1, 0], [0, 0.1, 1], [-1, 0.1, 0]];
    faces.forEach((q, i) => {
      geo.tri(q[0], q[1], q[2], [-a, y0], [a, y0], [b, y1], outs[i]);
      geo.tri(q[0], q[2], q[3], [-a, y0], [b, y1], [-b, y1], outs[i]);
    });
  };
  face(body, TRUSS, TOP_FLOOR);

  // the wings: vertical shafts on the east (elevators) and west (stairs) faces, from where the slope
  // passes them (~29th floor) up past the top floor
  const wings = new Geo();
  const WING_HALF = 13.6, WING_W = 3.3, WING_TOP = 212;
  const yEmerge = (BASE_HALF - WING_HALF) / slope;
  for (const s of [-1, 1]) {
    const x0 = s * (hw(WING_TOP) - 1.0), x1 = s * WING_HALF;
    wings.box(Math.min(x0, x1), yEmerge - 4, -WING_W, Math.max(x0, x1), WING_TOP, WING_W, { bottom: false, top: false });
    // hipped cap
    const xi = s * (hw(WING_TOP) - 1.0);
    wings.loft([[Math.min(xi, x1), -WING_W], [Math.max(xi, x1), -WING_W], [Math.max(xi, x1), WING_W], [Math.min(xi, x1), WING_W]], WING_TOP,
      [[Math.min(xi, x1 - s * 1.2), -WING_W + 1.2], [Math.max(xi, x1 - s * 1.2), -WING_W + 1.2], [Math.max(xi, x1 - s * 1.2), WING_W - 1.2], [Math.min(xi, x1 - s * 1.2), WING_W - 1.2]], WING_TOP + 3.5);
    const xc0 = Math.min(xi, x1 - s * 1.2), xc1 = Math.max(xi, x1 - s * 1.2);
    wings.box(xc0, WING_TOP + 3.5, -WING_W + 1.2, xc1, WING_TOP + 3.51, WING_W - 1.2, { sides: false, bottom: false });
    // a vertical strip of narrow windows on the outer face of each wing
  }

  // ---------------------------------------------------------------- spire
  const spire = new Geo();
  const sTop = 250;
  spire.loft(sq(hw(TOP_FLOOR)), TOP_FLOOR, sq(hw(sTop)), sTop);
  // panel seams: thin ribs up the four hips of the spire
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const r0 = hw(TOP_FLOOR) + 0.05, r1 = hw(sTop) + 0.05;
    spire.quad([sx * r0 - 0.15 * sx, TOP_FLOOR, sz * r0], [sx * r0, TOP_FLOOR, sz * r0 - 0.15 * sz], [sx * r1, sTop, sz * r1 - 0.1 * sz], [sx * r1 - 0.1 * sx, sTop, sz * r1], 0, 0, 1, 1, [sx, 0.2, sz]);
  }
  spire.lathe([[hw(sTop) * 0.9, sTop], [0.5, sTop + 2], [0.35, 259], [0.08, 262]], 8, { flat: true });
  // a thin parapet ring at the top floor where the spire begins
  spire.loft(sq(hw(TOP_FLOOR) + 0.35), TOP_FLOOR - 1.2, sq(hw(TOP_FLOOR) + 0.35), TOP_FLOOR);
  spire.loft(sq(hw(TOP_FLOOR) + 0.35), TOP_FLOOR, sq(hw(TOP_FLOOR)), TOP_FLOOR + 0.01);

  // ---------------------------------------------------------------- base: lobby glass + raked columns
  const lobby = new Geo();
  const inset = 5.5;
  lobby.prism(sq(BASE_HALF - inset), -3, TRUSS - 0.5, { top: false });
  const truss = new Geo();
  // the horizontal ring beam the faces sit on
  {
    const a = hw(TRUSS), a2 = hw(TRUSS - 2.2);
    truss.loft(sq(a2), TRUSS - 2.2, sq(a), TRUSS);
    truss.loft(sq(a - 2.2), TRUSS - 2.2, sq(a2), TRUSS - 2.2); // underside
  }
  // raked columns on each face in a zig-zag, plus heavy corner piers
  const box = new THREE.BoxGeometry(1, 1, 1);
  const M = new THREE.Matrix4();
  const beam = (p, q, w, d) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz);
    const zA = new THREE.Vector3(dx, dy, dz).normalize();
    const up = Math.abs(zA.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const xA = new THREE.Vector3().crossVectors(up, zA).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
    M.makeBasis(xA.multiplyScalar(w), yA.multiplyScalar(d), zA.multiplyScalar(L)).setPosition((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
    truss.add(box, M);
  };
  const NB = 8;
  for (let fi = 0; fi < 4; fi++) {
    const rot = new THREE.Matrix4().makeRotationY(-fi * Math.PI / 2);
    truss.push(rot);
    // face at z = -hw (north), u along +x
    const pt = (u, y) => [u, y, -hw(y) + 0.6];
    const top = TRUSS - 2.2;
    for (let i = 0; i < NB; i++) {
      const u0 = -hw(0) + 2.2 + (2 * hw(0) - 4.4) * i / NB, u1 = -hw(0) + 2.2 + (2 * hw(0) - 4.4) * (i + 1) / NB;
      const ut0 = u0 * hw(top) / hw(0), ut1 = u1 * hw(top) / hw(0), um = (ut0 + ut1) / 2;
      beam(pt(u0, -0.2), pt(um, top), 1.3, 1.3);
      beam(pt(u1, -0.2), pt(um, top), 1.3, 1.3);
    }
    // corner pier
    truss.loft([[hw(0) - 3.4, -hw(0)], [hw(0), -hw(0)], [hw(0), -hw(0) + 3.4], [hw(0) - 3.4, -hw(0) + 3.4]], -1,
      [[hw(top) - 3.0, -hw(top)], [hw(top), -hw(top)], [hw(top), -hw(top) + 3.0], [hw(top) - 3.0, -hw(top) + 3.0]], top);
    truss.pop();
  }

  const meshes = [mesh(body, facade), mesh(wings, quartz), mesh(spire, alu), mesh(lobby, glassMat, { cast: false }), mesh(truss, quartz)];
  group.add(...meshes);

  // beacon on the tip
  const tip = glowPoints([[0, 262.4, 0]], new THREE.Color(1.0, 0.1, 0.05), 6);
  group.add(tip);

  const colliders = [{ p: worldRing(sq(BASE_HALF - 0.5), F.toWorld), b: b0, h: 256 }];
  const suppress = [{ x: C[0], z: C[1], r: 30 }];
  let t = 0;
  const update = dt => {
    t += dt;
    const night = shared.uNight.value;
    tip.visible = night > 0.05;
    tip.material.color.copy(tip.material.userData.base).multiplyScalar(night * 3 * (0.4 + 0.6 * (Math.sin(t * 1.6) > 0 ? 1 : 0.15)));
  };
  const tris = meshes.reduce((a, m) => a + m.geometry.attributes.position.count / 3, 0);
  console.info(`[lm] transamerica at ${C.map(v => v.toFixed(1))} base ${b0}, ~${Math.round(tris / 1000)}k tris`);
  return { group, suppress, colliders, update };
}
