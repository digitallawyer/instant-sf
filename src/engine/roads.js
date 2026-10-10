// Streets as ribbons draped over the hills (or carried on bridge decks), with markings painted by a
// shader in road-space metres: double yellow centre lines, dashed lanes, gutters, crosswalks at
// junctions, cobbles, steps and pier planks. Rails (cable car, streetcar) are drawn on top.
import * as THREE from 'three';
import { GLSL_NOISE, addHook, useShared } from './fog.js';

const LIFT = { 1: 0.34, 2: 0.32, 3: 0.3, 4: 0.28, 5: 0.26, 6: 0.24, 7: 0.22, 8: 0.2, 9: 0.2, 10: 0.2, 11: 0.1 };
const CAR = k => k <= 6;

function densify(p, ys, maxSeg) {
  const out = [], oy = ys ? [] : null;
  for (let i = 0; i < p.length - 2; i += 2) {
    const x0 = p[i], z0 = p[i + 1], x1 = p[i + 2], z1 = p[i + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / maxSeg));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      out.push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, s === 0 ? i / 2 : -1);
      if (oy) oy.push(ys[i / 2] + (ys[i / 2 + 1] - ys[i / 2]) * t);
    }
  }
  out.push(p[p.length - 2], p[p.length - 1], p.length / 2 - 1);
  if (oy) oy.push(ys[ys.length - 1]);
  return { pts: out, ys: oy };
}

const key = (x, z) => x.toFixed(1) + ',' + z.toFixed(1);

export function createRoads(map, hf, csm) {
  // junctions: OSM nodes shared by two or more car roads (same node -> same projected coordinate)
  const count = new Map(), radius = new Map();
  map.roads.forEach((r, ri) => {
    if (!CAR(r.k)) return;
    const seen = new Set();
    for (let i = 0; i < r.p.length; i += 2) {
      const k = key(r.p[i], r.p[i + 1]);
      if (seen.has(k)) continue; seen.add(k);
      count.set(k, (count.get(k) || 0) + 1);
      radius.set(k, Math.max(radius.get(k) || 0, r.w / 2));
    }
  });

  const pos = [], nrm = [], uv = [], info = [], idx = [];
  let n = 0;
  const side = { pos: [], nrm: [], idx: [], n: 0 };

  for (const r of map.roads) {
    const { pts, ys } = densify(r.p, r.y, 5);
    const m = pts.length / 3;
    if (m < 2) continue;
    // distance along, and distance to the nearest junction
    const along = new Float32Array(m), jd = new Float32Array(m).fill(1e4);
    for (let i = 1; i < m; i++) along[i] = along[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
    if (CAR(r.k)) {
      let last = -1e4;
      for (let i = 0; i < m; i++) { if (pts[i * 3 + 2] >= 0 && (count.get(key(pts[i * 3], pts[i * 3 + 1])) || 0) >= 2) last = along[i]; jd[i] = along[i] - last; }
      last = 1e9;
      for (let i = m - 1; i >= 0; i--) { if (pts[i * 3 + 2] >= 0 && (count.get(key(pts[i * 3], pts[i * 3 + 1])) || 0) >= 2) last = along[i]; jd[i] = Math.min(jd[i], last - along[i]); }
    }
    const hw = r.w / 2;
    const lift = LIFT[r.k] || 0.2;
    const flags = (r.ow ? 1 : 0) + (r.sf ? 2 : 0);
    const start = n;
    for (let i = 0; i < m; i++) {
      const x = pts[i * 3], z = pts[i * 3 + 1];
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
      let tx = pts[b * 3] - pts[a * 3], tz = pts[b * 3 + 1] - pts[a * 3 + 1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      // miter: scale the offset by the turn so corners keep their width
      let s = 1;
      if (i > 0 && i < m - 1) {
        const ux = pts[i * 3] - pts[i * 3 - 3], uz = pts[i * 3 + 1] - pts[i * 3 - 2], ul = Math.hypot(ux, uz) || 1;
        const cos = (ux / ul) * tx + (uz / ul) * tz;
        s = Math.min(2.5, 1 / Math.max(0.4, Math.sqrt((1 + cos) / 2) || 1));
      }
      const lx = -tz * hw * s, lz = tx * hw * s; // left side
      for (const sgn of [1, -1]) {
        const px = x + lx * sgn, pz = z + lz * sgn;
        const y = ys ? ys[i] + 0.15 : hf.at(px, pz) + lift;
        pos.push(px, y, pz);
        nrm.push(0, 1, 0);
        uv.push(sgn > 0 ? 0 : 1, along[i]);
        info.push(r.k, r.w, jd[i], flags);
        n++;
      }
      if (ys) { // deck fascia
        for (const sgn of [1, -1]) {
          const px = x + lx * sgn, pz = z + lz * sgn;
          side.pos.push(px, ys[i] + 0.15, pz, px, ys[i] - 1.6, pz);
          side.nrm.push(lx * sgn / hw, 0, lz * sgn / hw, lx * sgn / hw, 0, lz * sgn / hw);
        }
      }
    }
    for (let i = 0; i < m - 1; i++) {
      const a = start + i * 2, b = a + 1, c = a + 2, d = a + 3; // a,c one side; b,d the other
      idx.push(a, c, b, b, c, d);
    }
    if (ys) {
      const s0 = side.n;
      for (let i = 0; i < m - 1; i++) {
        const L = s0 + i * 4, R = L + 2, L2 = L + 4, R2 = L + 6;
        side.idx.push(L, L2, L + 1, L + 1, L2, L2 + 1); // left fascia
        side.idx.push(R, R + 1, R2, R + 1, R2 + 1, R2); // right fascia
        side.idx.push(L + 1, L2 + 1, R + 1, R + 1, L2 + 1, R2 + 1); // underside
      }
      side.n += m * 4;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(info, 4));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.name = 'roads';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad;\nvarying vec4 vRoad;\nvarying vec2 vRUV;\nvarying vec3 vRW;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = aRoad;\nvRUV = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vRoad;\nvarying vec2 vRUV;\nvarying vec3 vRW;\nfloat gRR;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float k = vRoad.x, w = vRoad.y, jd = vRoad.z, fl = vRoad.w;
        bool oneway = mod(fl, 2.0) > 0.5;
        bool cobble = mod(floor(fl / 2.0), 2.0) > 0.5;
        float x = vRUV.x * w;          // metres from the left edge
        float a = vRUV.y;              // metres along
        float cx = abs(x - w * 0.5);   // metres from the centre line
        float big = fbm(vRW.xz * 0.08);
        float fine = vnoise(vRW.xz * 3.0);
        vec3 c;
        gRR = 0.86;
        if (k <= 6.5) {
          // asphalt: patched, sun-bleached, darker oil line in each lane
          c = mix(vec3(0.13, 0.13, 0.13), vec3(0.21, 0.205, 0.2), big) * (0.9 + 0.2 * fine);
          float patchy = smoothstep(0.55, 0.6, fbm(vRW.xz * 0.05 + 9.0));
          c = mix(c, c * 0.72, patchy * 0.6);
          float crack = smoothstep(0.015, 0.0, abs(fbm(vRW.xz * 0.6) - 0.5)) * 0.5;
          c *= 1.0 - crack * 0.5;
          // gutter + curb
          float edge = min(x, w - x);
          c = mix(c, vec3(0.42, 0.41, 0.39), smoothstep(0.45, 0.35, edge));
          float paint = 0.0; vec3 pc = vec3(0.92);
          float fade = smoothstep(9.0, 12.0, jd);
          if (cobble) { vec2 q = vec2(x, a) / vec2(0.22, 0.14); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5; vec2 e = abs(fract(q) - 0.5); c = mix(vec3(0.32, 0.3, 0.28), vec3(0.16), smoothstep(0.42, 0.5, max(e.x, e.y))); }
          if (k <= 4.5 && !oneway && w > 7.0) {
            float yl = smoothstep(0.07, 0.04, abs(cx - 0.17)) ;
            paint = max(paint, yl * fade); pc = vec3(0.95, 0.72, 0.12);
          }
          if (k <= 4.5 && w > 10.0) {
            float lane = 3.5;
            float off = oneway ? x : cx;
            float lf = fract(off / lane);
            float ll = smoothstep(0.04, 0.02, min(lf, 1.0 - lf) * lane - 0.0) * step(1.2, min(x, w - x)) * step(1.0, off);
            ll *= step(fract(a / 10.0), 0.35);
            if (ll * fade > paint) { paint = ll * fade; pc = vec3(0.93); }
          }
          // continental crosswalks at junctions
          if (jd > 2.5 && jd < 6.0 && k <= 5.5) {
            float zebra = step(0.5, fract(x / 1.2)) * step(0.6, min(x, w - x));
            if (zebra > paint) { paint = zebra; pc = vec3(0.93); }
          }
          // stop line
          if (jd > 6.0 && jd < 6.5 && k <= 5.5 && x < w * 0.5 + 0.2 && !oneway) { paint = 1.0; pc = vec3(0.93); }
          paint *= 0.85 + 0.15 * fine;
          c = mix(c, pc, paint);
          gRR = mix(0.95, 0.7, paint);
        } else if (k > 10.5) { // pier planks
          float pl = fract(a / 0.25);
          c = mix(vec3(0.33, 0.27, 0.2), vec3(0.24, 0.19, 0.14), hash12(vec2(floor(a / 0.25), floor(x / 3.0))));
          c *= 1.0 - smoothstep(0.92, 1.0, pl) * 0.5;
        } else if (k > 9.5) { // steps
          float st = fract(a / 0.32);
          c = vec3(0.55, 0.53, 0.5) * (0.85 + 0.15 * fine) * (1.0 - smoothstep(0.8, 1.0, st) * 0.4);
        } else { // footways, paths, plazas: concrete with joints, or packed earth on paths
          vec2 q = vec2(x, a) / 1.5; vec2 e = abs(fract(q) - 0.5);
          c = vec3(0.6, 0.59, 0.56) * (0.88 + 0.16 * big + 0.06 * fine);
          c *= 1.0 - smoothstep(0.47, 0.5, max(e.x, e.y)) * 0.25;
          if (k > 7.5 && k < 8.5 && w < 2.5) c = mix(vec3(0.42, 0.36, 0.27), vec3(0.5, 0.44, 0.33), big);
        }
        diffuseColor.rgb = c * (1.0 - uWet * 0.35);
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(gRR, 0.12 + 0.2 * vnoise(vRW.xz * 0.4), uWet);');
  });

  const group = new THREE.Group();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  group.add(mesh);

  if (side.n) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(side.pos, 3));
    sg.setAttribute('normal', new THREE.Float32BufferAttribute(side.nrm, 3));
    sg.setIndex(side.idx);
    const smat = new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 0.8, side: THREE.DoubleSide });
    if (csm) csm.setupMaterial(smat);
    const sm = new THREE.Mesh(sg, smat);
    sm.castShadow = true; sm.receiveShadow = true;
    group.add(sm);
  }

  group.add(createRails(map, hf, csm));
  group.add(createSidewalks(map, hf, csm, count, radius));
  return group;
}

// Raised sidewalks with a curb on both sides of city streets, stopping short of junctions.
function createSidewalks(map, hf, csm, count, radius) {
  const SW = 3.0, CURB = 0.16;
  const pos = [], nrm = [], uv = [], idx = [];
  let n = 0;
  for (const r of map.roads) {
    if (r.k > 5 || r.br) continue;
    const { pts } = densify(r.p, null, 4);
    const m = pts.length / 3;
    if (m < 2) continue;
    const along = new Float32Array(m);
    for (let i = 1; i < m; i++) along[i] = along[i - 1] + Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2]);
    // clearance from the nearest junction box (negative = inside a crossing street)
    const clear = new Float32Array(m).fill(1e4);
    let lastA = -1e4, lastR = 0;
    for (let i = 0; i < m; i++) {
      if (pts[i * 3 + 2] >= 0) { const k = key(pts[i * 3], pts[i * 3 + 1]); if ((count.get(k) || 0) >= 2) { lastA = along[i]; lastR = radius.get(k); } }
      clear[i] = along[i] - lastA - lastR - 1.2;
    }
    lastA = 1e9; lastR = 0;
    for (let i = m - 1; i >= 0; i--) {
      if (pts[i * 3 + 2] >= 0) { const k = key(pts[i * 3], pts[i * 3 + 1]); if ((count.get(k) || 0) >= 2) { lastA = along[i]; lastR = radius.get(k); } }
      clear[i] = Math.min(clear[i], lastA - along[i] - lastR - 1.2);
    }
    const hw = r.w / 2, lift = LIFT[r.k] || 0.2;
    for (const sgn of [1, -1]) {
      const start = n;
      for (let i = 0; i < m; i++) {
        const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
        let tx = pts[b * 3] - pts[a * 3], tz = pts[b * 3 + 1] - pts[a * 3 + 1];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const ox = -tz * sgn, oz = tx * sgn;
        const x = pts[i * 3], z = pts[i * 3 + 1];
        const ix = x + ox * hw, iz = z + oz * hw, ex = x + ox * (hw + SW), ez = z + oz * (hw + SW);
        const yRoad = hf.at(ix, iz) + lift, yTop = Math.max(yRoad + CURB, hf.at(ex, ez) + lift + CURB * 0.6);
        const yIn = yRoad + CURB;
        pos.push(ix, yRoad, iz, ix, yIn, iz, ex, yTop, ez);
        nrm.push(-ox, 0, -oz, 0, 1, 0, 0, 1, 0);
        uv.push(0, along[i], 0, along[i], SW, along[i]);
        n += 3;
      }
      for (let i = 0; i < m - 1; i++) {
        if (clear[i] < 0 || clear[i + 1] < 0) continue;
        const a = start + i * 3, b = a + 3;
        // curb face (a0-a1-b1-b0) and walk surface (a1-a2-b2-b1); winding depends on the side
        if (sgn > 0) { idx.push(a, a + 1, b, b, a + 1, b + 1); idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2); }
        else { idx.push(a, b, a + 1, b, b + 1, a + 1); idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  mat.name = 'sidewalks';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSUV;\nvarying vec3 vSW;\nvarying float vUp;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSUV = uv; vUp = normal.y;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSUV;\nvarying vec3 vSW;\nvarying float vUp;\n' + GLSL_NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float x = vSUV.x, a = vSUV.y;
        float big = fbm(vSW.xz * 0.1), fine = vnoise(vSW.xz * 4.0);
        vec3 c = mix(vec3(0.5, 0.49, 0.46), vec3(0.62, 0.6, 0.57), big) * (0.9 + 0.12 * fine);
        float px = fwidth(a) + 0.002;
        float joint = 1.0 - smoothstep(0.0, px * 1.5 + 0.015, min(fract(a / 1.5), 1.0 - fract(a / 1.5)) * 1.5);
        joint = max(joint, 1.0 - smoothstep(0.0, 0.02, abs(x - 0.25)));
        c *= 1.0 - joint * 0.3;
        // the curb: a lighter, worn concrete edge, painted red near some corners
        float curb = (1.0 - smoothstep(0.2, 0.25, x)) * step(0.5, vUp) + (1.0 - step(0.5, vUp));
        c = mix(c, vec3(0.66, 0.65, 0.62) * (0.9 + 0.1 * fine), curb);
        // gum spots and stains
        c *= 1.0 - smoothstep(0.75, 0.8, vnoise(vSW.xz * 1.7)) * 0.15;
        diffuseColor.rgb = c * (1.0 - uWet * 0.3);
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.9, 0.25, uWet);');
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function createRails(map, hf, csm) {
  const pos = [], idx = [];
  let n = 0;
  for (const r of map.rails) {
    if (r.k === 'rail' && !r.br) continue;
    const gauge = r.k === 'cable_car' ? 1.067 : 1.435;
    const lines = r.k === 'cable_car' ? [-gauge / 2, 0, gauge / 2] : [-gauge / 2, gauge / 2];
    const { pts } = densify(r.p, null, 3);
    const m = pts.length / 3;
    for (const off of lines) {
      const hw = off === 0 ? 0.03 : 0.045;
      const start = n;
      for (let i = 0; i < m; i++) {
        const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
        let tx = pts[b * 3] - pts[a * 3], tz = pts[b * 3 + 1] - pts[a * 3 + 1];
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const x = pts[i * 3] - tz * off, z = pts[i * 3 + 1] + tx * off;
        for (const s of [1, -1]) {
          const px = x - tz * hw * s, pz = z + tx * hw * s;
          pos.push(px, hf.at(px, pz) + 0.36, pz); n++;
        }
      }
      for (let i = 0; i < m - 1; i++) { const a = start + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.25, metalness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  if (csm) csm.setupMaterial(mat);
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}
