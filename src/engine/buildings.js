// Every OSM building extruded to its measured height and merged into chunk meshes. The facades are
// procedural: a shader lays out floors, window bays, shopfronts and curtain-wall glass in world metres,
// reflects the sky in the glass and switches random windows on at night.
import * as THREE from 'three';
import { GLSL_NOISE, addHook, useShared } from './fog.js';

const CHUNK = 900;

// Façade palettes. SF: pastel stucco Victorians and Edwardians, warm beige and grey downtown masonry,
// pale concrete and glass towers.
const PAL_HOUSE = ['#e8dccb', '#d9c7a7', '#c9d3d1', '#e3c6b5', '#b9c4cf', '#efe6d2', '#d4b99a', '#c2cbb4', '#e6d3c2', '#a9b8c4', '#f0e2c4', '#cfbfb0', '#dcb7a1', '#b7c7bb'];
const PAL_CITY = ['#cfc6b8', '#b8ad9c', '#d8d2c6', '#a59a8a', '#c4b49c', '#8f8a84', '#e0dbd2', '#b3aca2', '#c9b8a2', '#9fa3a6'];
const PAL_INDUSTRIAL = ['#a89c8c', '#8e8a84', '#b4a48e', '#9a7e6a', '#c2b8a8', '#7d7770'];
const PAL_BRICK = ['#9a5a44', '#8c4c3a', '#a8664e', '#7e4a3c', '#93604a', '#a35b45', '#7a5546', '#b07457'];
const PAL_STONE = ['#cfc3a8', '#bfb39a', '#d8cdb6', '#a9a196', '#c8b28e', '#e3d6bd', '#b8afa2', '#d2c4a4'];
const PAL_CONCRETE = ['#b5b1aa', '#a7a49f', '#c4c0b8', '#9c9993', '#bab4a8', '#cdc9c0'];
const PAL_CURTAIN = ['#5f6f7a', '#7d8a92', '#4d5a63', '#8e9aa0', '#6b7378', '#93a3ab', '#55646b'];

function rand(seed) { let s = seed | 0; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; }; }
const tmpColor = new THREE.Color();
function parseColour(c) {
  if (!c) return null;
  try { tmpColor.set(c.replace(/;.*/, '').trim()); return tmpColor.clone(); } catch { return null; }
}

// Façade materials (shader ids): wood lap siding, stucco, brick, stone/terracotta, concrete, curtain wall.
// Encoded in the high bits of aInfo.y (kind + 16 * material).
export const M_WOOD = 0, M_STUCCO = 1, M_BRICK = 2, M_STONE = 3, M_CONCRETE = 4, M_CURTAIN = 5;
function facadeMaterial(b, kind, index) {
  const m = (b.mat || '').toLowerCase();
  if (/glass|steel|metal/.test(m)) return M_CURTAIN;
  if (/^brick/.test(m)) return M_BRICK;
  if (/stone|granite|marble|limestone/.test(m)) return M_STONE;
  if (/concrete/.test(m)) return M_CONCRETE;
  if (/stucco|plaster/.test(m)) return M_STUCCO;
  if (/wood/.test(m)) return M_WOOD;
  const r = Math.abs(Math.sin(index * 91.17 + 3.3) * 43758.5453) % 1;
  const house = kind === 1 || (kind === 0 && b.h < 16);
  if (house) return r < 0.6 ? M_WOOD : r < 0.93 ? M_STUCCO : M_BRICK;
  if (kind === 3 || kind === 4 || kind === 5) return r < 0.4 ? M_CONCRETE : r < 0.75 ? M_BRICK : M_STUCCO;
  if (b.h > 48) return r < 0.5 ? M_CURTAIN : r < 0.8 ? M_CONCRETE : M_STONE;
  if (b.h > 22) return r < 0.28 ? M_BRICK : r < 0.52 ? M_STONE : r < 0.76 ? M_CONCRETE : r < 0.86 ? M_CURTAIN : M_STUCCO;
  return r < 0.36 ? M_STUCCO : r < 0.66 ? M_BRICK : r < 0.82 ? M_CONCRETE : M_STONE;
}

// kind codes in the shader: 1 house, 2 commercial, 3 industrial, 4 small/garage, 5 roof/canopy, 6 church, 7 civic, 0 generic
function wallStyle(b, rnd, mat) {
  const k = b.k || 0;
  const pick = pal => new THREE.Color(pal[Math.floor(rnd() * pal.length)]);
  const own = parseColour(b.c);
  if (own) return own;
  if (mat === M_BRICK) return rnd() < 0.82 ? pick(PAL_BRICK) : pick(PAL_CITY); // some brick is painted
  if (mat === M_CURTAIN) return pick(PAL_CURTAIN);
  if (mat === M_STONE) return pick(PAL_STONE);
  if (mat === M_CONCRETE) return pick(PAL_CONCRETE);
  if (k === 1 || (k === 0 && b.h < 14)) return pick(PAL_HOUSE);
  if (k === 3) return pick(PAL_INDUSTRIAL);
  if (b.h > 60) return pick(['#9aa6ae', '#b7bcbd', '#8d9aa3', '#c9c6bd', '#7f8b93']);
  return pick(PAL_CITY);
}

class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.info = []; this.idx = []; this.n = 0; }
  vert(x, y, z, nx, ny, nz, u, v, c, info) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(u, v); this.col.push(c.r, c.g, c.b); this.info.push(info[0], info[1], info[2], info[3]);
    return this.n++;
  }
  // pushes a triangle wound so its face points along (nx, ny, nz)
  tri(a, b, c, nx, ny, nz) {
    const P = this.pos;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nx + cy * ny + cz * nz >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// SF row-house dressing on the street side: an angled bay window running up the upper floors and a
// bracketed cornice along the roofline.
function addHouseFront(gb, b, seed, wall, edge, eaveTop, cornice, kindCode) {
  const p = b.p, n = p.length / 2, i = edge, j = (i + 1) % n;
  const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
  const len = Math.hypot(x1 - x0, z1 - z0);
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len, nx = dz, nz = -dx;
  const top = eaveTop, colW = 2.2 + seed * 0.5;
  const trimRnd = (seed * 977) % 1;
  const trim = trimRnd < 0.6 ? new THREE.Color(0.93, 0.92, 0.88) : trimRnd < 0.8 ? new THREE.Color(0.32, 0.36, 0.4) : wall.clone().multiplyScalar(0.7);
  // part 3 = painted house trim: the shader picks the house's colour scheme (trim + accent) for it
  const infoW = [seed, kindCode, b.h, 0], infoT = [seed, kindCode, b.h, 3];
  const quad = (ax, az, bx, bz, y0, y1, u0, u1, col, info) => {
    const fx = bz - az, fz = -(bx - ax), fl = Math.hypot(fx, fz) || 1;
    const q = [gb.vert(ax, y0, az, fx / fl, 0, fz / fl, u0, y0 - b.b, col, info), gb.vert(bx, y0, bz, fx / fl, 0, fz / fl, u1, y0 - b.b, col, info),
      gb.vert(bx, y1, bz, fx / fl, 0, fz / fl, u1, y1 - b.b, col, info), gb.vert(ax, y1, az, fx / fl, 0, fz / fl, u0, y1 - b.b, col, info)];
    gb.idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
  };
  const cap = (pts, y, up, col, info) => {
    const base = gb.n;
    for (const [x, z] of pts) gb.vert(x, y, z, 0, up, 0, x, z, col, info);
    for (let k = 1; k < pts.length - 1; k++) gb.tri(base, base + k, base + k + 1, 0, up, 0);
  };
  // bay window: off-centre on wide lots (door beside it), centred on narrow ones
  if (len > 4.2 && b.h > 6.5) {
    const W = Math.min(3.6, len * 0.55), Wf = W * 0.56, D = 0.85;
    const off = len > 6.5 ? len * 0.22 : 0;
    const cx = (x0 + x1) / 2 + dx * off, cz = (z0 + z1) / 2 + dz * off;
    const A = [cx - dx * W / 2, cz - dz * W / 2], B = [cx + dx * W / 2, cz + dz * W / 2];
    const A2 = [cx - dx * Wf / 2 + nx * D, cz - dz * Wf / 2 + nz * D], B2 = [cx + dx * Wf / 2 + nx * D, cz + dz * Wf / 2 + nz * D];
    const y0 = b.b + (b.h > 10.5 ? 3.3 : 0.7), y1 = top - 0.95;
    const k0 = 1000;
    quad(A[0], A[1], A2[0], A2[1], y0, y1, k0 * colW, (k0 + 1) * colW, wall, infoW);
    quad(A2[0], A2[1], B2[0], B2[1], y0, y1, (k0 + 2) * colW, (k0 + 3) * colW, wall, infoW);
    quad(B2[0], B2[1], B[0], B[1], y0, y1, (k0 + 4) * colW, (k0 + 5) * colW, wall, infoW);
    cap([A, A2, B2, B], y1, 1, trim, infoT);
    cap([A, B, B2, A2], y0, -1, trim, infoT);
  }
  if (!cornice) return;
  // cornice: a projecting box along the roofline
  const o = 0.42, h0 = top - 0.62, h1 = top + 0.06;
  const C0 = [x0 + nx * o, z0 + nz * o], C1 = [x1 + nx * o, z1 + nz * o];
  quad(C0[0], C0[1], C1[0], C1[1], h0, h1, 0, len, trim, infoT);
  cap([[x0, z0], [x1, z1], C1, C0], h1, 1, trim, infoT);
  cap([[x0, z0], C0, C1, [x1, z1]], h0, -1, trim, infoT);
  quad(x0, z0, C0[0], C0[1], h0, h1, 0, o, trim, infoT);
  quad(C1[0], C1[1], x1, z1, h0, h1, 0, o, trim, infoT);
}

function addBuilding(gb, b, index, frontOf) {
  const rnd = rand(index * 7919 + 13);
  const p = b.p;
  const n = p.length / 2;
  const bottom = b.b + (b.m || 0) - (b.m ? 0 : 2.5); // sink walls into the slope
  const top = b.b + b.h;
  const kind = b.k || 0;
  const fmat = facadeMaterial(b, kind, index);
  const wall = wallStyle(b, rnd, fmat);
  const seed = rnd();
  const kindCode = kind + 16 * fmat;
  const infoW = [seed, kindCode, b.h, 0];
  const infoR = [seed, kindCode, b.h, 1];
  const vBase = b.b - bottom; // façade v is metres above the ground line, so floors line up with the street

  // pitched roofs: ridge along the longer side of the footprint's oriented box (so on SF row houses
  // the gable faces the street), eaves lowered so the total height stays the mapped one
  let roof = null;
  if (/^(gabled|hipped|half-hipped|gambrel|saltbox|mansard)$/.test(b.rs || '') && n >= 4 && b.h > 4) {
    let bestL = 0, ax = 1, az = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1], L = Math.hypot(dx, dz);
      if (L > bestL) { bestL = L; ax = dx / L; az = dz / L; }
    }
    let px = -az, pz = ax;
    const ext = (ux, uz) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { const v = p[i * 2] * ux + p[i * 2 + 1] * uz; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
    let [a0, a1] = ext(ax, az), [p0, p1] = ext(px, pz);
    if (p1 - p0 > a1 - a0) { [ax, az, px, pz] = [px, pz, ax, az]; [a0, a1, p0, p1] = [p0, p1, a0, a1]; }
    const halfW = (p1 - p0) / 2;
    const rh = Math.min(b.h * 0.42, halfW * (0.85 + seed * 0.35));
    roof = { px, pz, pc: (p0 + p1) / 2, halfW, rh, eave: top - rh };
  }
  const topAt = (x, z) => roof ? roof.eave + roof.rh * Math.max(0, 1 - Math.abs(x * roof.px + z * roof.pz - roof.pc) / roof.halfW) : top;

  // walls (rings are normalised so the signed area is positive in x/z, i.e. clockwise seen from above:
  // the outward normal of an edge is (dz, -dx))
  let u = 0;
  const wallQuad = (x0, z0, x1, z1, u0, u1, nx, nz) => {
    const t0 = topAt(x0, z0), t1 = topAt(x1, z1);
    const a = gb.vert(x0, bottom, z0, nx, 0, nz, u0, -vBase + (b.m || 0), wall, infoW);
    const bb = gb.vert(x1, bottom, z1, nx, 0, nz, u1, -vBase + (b.m || 0), wall, infoW);
    const c = gb.vert(x1, t1, z1, nx, 0, nz, u1, t1 - b.b, wall, infoW);
    const d = gb.vert(x0, t0, z0, nx, 0, nz, u0, t0 - b.b, wall, infoW);
    gb.idx.push(a, c, bb, a, d, c);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len;
    if (roof) { // split the wall where it passes under the ridge, so the gable peaks there
      const s0 = x0 * roof.px + z0 * roof.pz - roof.pc, s1 = x1 * roof.px + z1 * roof.pz - roof.pc;
      if ((s0 < 0) !== (s1 < 0) && Math.abs(s0 - s1) > 1e-6) {
        const t = s0 / (s0 - s1), xm = x0 + dx * t, zm = z0 + dz * t;
        wallQuad(x0, z0, xm, zm, u, u + len * t, nx, nz);
        wallQuad(xm, zm, x1, z1, u + len * t, u + len, nx, nz);
        u += len; continue;
      }
    }
    wallQuad(x0, z0, x1, z1, u, u + len, nx, nz);
    u += len;
  }
  if (frontOf && (kind === 1 || kind === 0) && b.h > 5 && b.h < 16 && !b.part) {
    const e = frontOf(b);
    if (e >= 0) addHouseFront(gb, b, seed, wall, e, roof ? roof.eave : top, !roof, kindCode);
  }

  // roof
  const roofCol = parseColour(b.rc) || (kind === 1 ? new THREE.Color(['#6b6560', '#7a746c', '#5d5853', '#8a8277', '#9a948a'][Math.floor(rnd() * 5)])
    : new THREE.Color(['#8a8580', '#9c9690', '#6f6b67', '#b5b0a8', '#c9c4bc', '#7c7671'][Math.floor(rnd() * 6)]));
  const contour = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
  if (roof) {
    const shingles = parseColour(b.rc) || new THREE.Color(['#4a4744', '#5a5550', '#3f4246', '#6b5f55', '#54504c'][Math.floor(rnd() * 5)]);
    const k = roof.rh / roof.halfW;
    for (const side of [1, -1]) {
      const f = (x, z) => side * (x * roof.px + z * roof.pz - roof.pc);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const cx = p[i * 2], cz = p[i * 2 + 1], ii = (i + n - 1) % n, qx = p[ii * 2], qz = p[ii * 2 + 1];
        const fc = f(cx, cz), fp = f(qx, qz);
        if ((fc >= 0) !== (fp >= 0)) { const t = fp / (fp - fc); pts.push([qx + (cx - qx) * t, qz + (cz - qz) * t]); }
        if (fc >= 0) pts.push([cx, cz]);
      }
      if (pts.length < 3) continue;
      let tr;
      try { tr = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []); } catch { continue; }
      const nx = side * roof.px * k, nz = side * roof.pz * k, nl = Math.hypot(nx, 1, nz);
      const base = gb.n;
      for (const [x, z] of pts) gb.vert(x, topAt(x, z), z, nx / nl, 1 / nl, nz / nl, x, z, shingles, infoR);
      for (const t of tr) gb.tri(base + t[0], base + t[1], base + t[2], 0, 1, 0);
    }
    return;
  }
  const pyramid = b.rs === 'pyramidal' || b.rs === 'spire' || b.rs === 'cone';
  const dome = b.rs === 'dome' || b.rs === 'onion';
  // flat roofs sit a little below a parapet (SF's false fronts and downtown parapets)
  const parapet = !pyramid && !dome && !b.part && b.h > 4 && kind !== 4 && kind !== 5 ? (b.h > 40 ? 1.4 : 0.8) : 0;
  const roofTop = top - parapet;
  if (parapet) {
    const infoP = [seed, kindCode, b.h, 2]; // (the coping along the top is painted by the shader on both faces)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = -dz / len, nz = dx / len;
      const a = gb.vert(x0, roofTop, z0, nx, 0, nz, 0, 0, roofCol, infoP);
      const bb = gb.vert(x1, roofTop, z1, nx, 0, nz, len, 0, roofCol, infoP);
      const c = gb.vert(x1, top, z1, nx, 0, nz, len, parapet, roofCol, infoP);
      const d = gb.vert(x0, top, z0, nx, 0, nz, 0, parapet, roofCol, infoP);
      gb.idx.push(a, bb, c, a, c, d);
    }
  }
  if ((pyramid || dome) && n >= 3) {
    let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; } cx /= n; cz /= n;
    let r = 0; for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(p[i * 2] - cx, p[i * 2 + 1] - cz));
    const rh = pyramid ? (b.rs === 'spire' ? r * 4 : r * 1.2) : r;
    if (pyramid) {
      const apex = [cx, roofTop + rh, cz];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
        const e1 = new THREE.Vector3(bx - ax, 0, bz - az), e2 = new THREE.Vector3(apex[0] - ax, apex[1] - roofTop, apex[2] - az);
        const nn = new THREE.Vector3().crossVectors(e2, e1).normalize();
        if (nn.y < 0) nn.negate();
        const v0 = gb.vert(ax, roofTop, az, nn.x, nn.y, nn.z, 0, 0, roofCol, infoR);
        const v1 = gb.vert(bx, roofTop, bz, nn.x, nn.y, nn.z, 1, 0, roofCol, infoR);
        const v2 = gb.vert(apex[0], apex[1], apex[2], nn.x, nn.y, nn.z, 0.5, 1, roofCol, infoR);
        gb.tri(v0, v1, v2, nn.x, nn.y, nn.z);
      }
      return;
    }
    // dome: rings of the outline shrinking towards the centre
    const R = 6;
    const rings = [];
    for (let k = 0; k <= R; k++) {
      const t = k / R, ang = t * Math.PI / 2, s = Math.cos(ang), y = roofTop + Math.sin(ang) * rh;
      rings.push(Array.from({ length: n }, (_, i) => {
        const x = cx + (p[i * 2] - cx) * s, z = cz + (p[i * 2 + 1] - cz) * s;
        const nn = new THREE.Vector3((p[i * 2] - cx) * Math.cos(ang), Math.sin(ang) * r, (p[i * 2 + 1] - cz) * Math.cos(ang)).normalize();
        return gb.vert(x, y, z, nn.x, nn.y, nn.z, i, t, roofCol, infoR);
      }));
    }
    for (let k = 0; k < R; k++) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ox = (p[i * 2] + p[j * 2]) / 2 - cx, oz = (p[i * 2 + 1] + p[j * 2 + 1]) / 2 - cz;
      gb.tri(rings[k][i], rings[k + 1][i], rings[k][j], ox, 0.5, oz);
      gb.tri(rings[k][j], rings[k + 1][i], rings[k + 1][j], ox, 0.5, oz);
    }
    return;
  }
  const base = gb.n;
  for (let i = 0; i < n; i++) gb.vert(p[i * 2], roofTop, p[i * 2 + 1], 0, 1, 0, p[i * 2], p[i * 2 + 1], roofCol, infoR);
  for (const t of tris) gb.tri(base + t[0], base + t[1], base + t[2], 0, 1, 0);
}

const facadeGLSL = /* glsl */`
varying vec2 vFacade;
varying vec4 vInfo;
varying vec3 vWorldPos;
varying vec3 vObjN;
${GLSL_NOISE}
float gGlass; float gRough; float gMetal; vec3 gEmit; vec3 gNW; float gBump; float gDirOcc;
// Painted Ladies: trim and accent paints (the body colour comes from the vertex colour)
const vec3 TRIM_PAL[6] = vec3[6](vec3(0.93, 0.90, 0.82), vec3(0.95, 0.95, 0.93), vec3(0.17, 0.30, 0.22), vec3(0.42, 0.12, 0.14), vec3(0.16, 0.21, 0.33), vec3(0.27, 0.27, 0.29));
const vec3 ACCENT_PAL[7] = vec3[7](vec3(0.80, 0.62, 0.26), vec3(0.14, 0.42, 0.42), vec3(0.58, 0.15, 0.12), vec3(0.40, 0.20, 0.36), vec3(0.20, 0.34, 0.20), vec3(0.95, 0.94, 0.90), vec3(0.12, 0.13, 0.16));
float stuccoH(vec2 p) { return vnoise(p * 9.0) * 0.55 + vnoise(p * 26.0 + 7.3) * 0.3 + vnoise(p * 61.0 + 3.1) * 0.15; }
// outward direction of a box SDF at l (box half size hb)
vec2 boxDir(vec2 l, vec2 hb) { vec2 d = abs(l) - hb; return d.x > d.y ? vec2(sign(l.x), 0.0) : vec2(0.0, sign(l.y)); }
`;

// Sun light is multiplied by gDirOcc: small-scale self shadowing the shadow map can't resolve
// (siding drip edges, mortar joints, window reveals, sills and cornices), so it only darkens direct sun.
const DIRECT_OCC = /* glsl */`
void RE_Direct_Facade(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  IncidentLight dl = directLight;
  dl.color *= gDirOcc;
  RE_Direct_Physical(dl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Facade
`;

const FACADE_FRAG = /* glsl */`
#include <color_fragment>
gGlass = 0.0; gRough = 0.88; gMetal = 0.0; gEmit = vec3(0.0); gBump = 0.0; gDirOcc = 1.0; gNW = vec3(0.0, 1.0, 0.0);
float seed = vInfo.x, H = vInfo.z;
float matId = floor(vInfo.y / 16.0 + 0.001);
float kind = vInfo.y - matId * 16.0;
vec3 base = diffuseColor.rgb;
vec3 N = normalize(vObjN);
vec3 T = vec3(-N.z, 0.0, N.x);
vec3 V = normalize(vWorldPos - cameraPosition);
bool house = (kind == 1.0 || kind == 0.0) && H < 16.0;
// house paint scheme: most get white or cream trim; about a third of the wooden ones are Painted
// Ladies with a richer body, a contrasting trim and an accent colour on sashes, sills and brackets
float pl = hash12(vec2(seed * 71.3, 9.1));
bool ladies = house && matId == 0.0 && pl < 0.36;
vec3 trimC = TRIM_PAL[int(hash12(vec2(seed * 13.7, 2.0)) * (ladies ? 5.99 : 1.99))];
if (!ladies && pl > 0.86) trimC = TRIM_PAL[5];
vec3 accentC = ladies ? ACCENT_PAL[int(hash12(vec2(seed * 5.3, 4.0)) * 6.99)] : trimC;
if (ladies) { float l0 = dot(base, vec3(0.3, 0.55, 0.15)); base = clamp(mix(vec3(l0), base, 1.35) * 0.96, 0.0, 1.0); }
if (vInfo.w < 0.5) {
  vec2 f = vFacade;
  float px = max(fwidth(f.x), fwidth(f.y)) * 0.75;
  float micro = 1.0 - smoothstep(0.008, 0.04, px);   // fine relief fades out with distance
  vec2 grad = vec2(0.0);                              // façade height gradient (dh/du, dh/dv)
  float ao = 1.0;
  vec3 sunT = vec3(dot(uSunDir, T), uSunDir.y, dot(uSunDir, N));   // towards the sun (u, v, out of the wall)
  float sunZ = max(sunT.z, 0.04), sunUp = max(sunT.y, 0.0);
  vec3 rd = vec3(dot(V, T), V.y, -dot(V, N));                         // view ray (u, v, into the wall)
  bool cw = matId == 5.0;
  bool tower = H > 48.0;
  bool shed = kind == 3.0 || kind == 4.0 || kind == 5.0;
  float big = vnoise(f * 0.25 + seed * 50.0);
  base *= 0.93 + vnoise(f * vec2(2.3, 3.1)) * 0.05 + big * 0.08;
  float matRough = 0.88;

  // ---- layout ----
  float floorH = cw ? 3.9 : tower ? 3.6 : house ? 3.2 : 3.45;
  float colW = cw ? (1.55 + seed * 0.8) : tower ? (1.8 + seed * 0.8) : house ? (2.2 + seed * 0.5) : (2.7 + seed * 1.3);
  float winW = cw ? colW - 0.12 : tower ? colW * 0.58 : house ? 0.95 : 1.1 + seed * 0.6;
  float winH = cw ? floorH - 0.9 : tower ? floorH - 1.5 : house ? 1.9 : 1.6 + seed * 0.3;
  float groundH = house ? 0.9 : 4.3;
  float topClear = tower || cw ? 2.2 : 1.2;
  bool hasWin = !shed || (kind == 3.0 && H > 8.0);
  if (kind == 3.0) { colW = 4.2; winW = 2.6; winH = 1.1; floorH = 4.6; }
  if (matId == 3.0 && !house && !tower) { winW = min(winW, colW * 0.5); winH = max(winH, 2.0); }
  vec2 cell = vec2(f.x / colW, (f.y - groundH) / floorH);
  vec2 id = floor(cell);
  vec2 local = (fract(cell) - 0.5) * vec2(colW, floorH);
  vec2 halfWin = 0.5 * vec2(min(winW, colW - 0.3), winH);
  float dWin = max(abs(local.x) - halfWin.x, abs(local.y) - halfWin.y);
  float rows = step(groundH, f.y) * step(f.y, H - topClear) * (hasWin ? 1.0 : 0.0)
             * step(groundH + (id.y + 0.5) * floorH + halfWin.y, H - 0.3);   // no windows cut by the roofline
  float frameT = house ? 0.13 : cw ? 0.05 : matId == 3.0 ? 0.17 : 0.08;

  // ---- wall material: micro relief and colour ----
  if (matId == 0.0) {
    // horizontal lap siding (or cedar shingles): each board's drip edge throws a thin shadow line
    float shingle = (house && hash12(vec2(seed * 3.1, 7.0)) > 0.86) ? 1.0 : 0.0;
    float ex = shingle > 0.5 ? 0.19 : 0.13 + 0.05 * hash12(vec2(seed, 5.0));
    float t = fract(f.y / ex), row = floor(f.y / ex);
    float dist = (1.0 - t) * ex;
    float sl = clamp(0.014 * sunUp / sunZ, 0.0, ex * 0.7);
    float sh = 1.0 - smoothstep(sl - px, sl + px, dist);
    float line = 1.0 - smoothstep(0.0, 0.006 + px, dist);
    grad.y += (-0.1 + 0.9 * (1.0 - smoothstep(0.0, 0.22, t))) * micro;
    if (shingle > 0.5) {
      float sw = 0.12 + 0.2 * hash12(vec2(row, seed * 9.0));
      float sx = f.x / sw + hash12(vec2(row * 1.3, seed));
      float gap = 1.0 - smoothstep(0.0, 0.006 + px, min(fract(sx), 1.0 - fract(sx)) * sw);
      line = max(line, gap * 0.7);
      vec3 cedar = mix(vec3(0.33, 0.22, 0.14), vec3(0.48, 0.34, 0.21), hash12(vec2(floor(sx), row) + seed));
      base = mix(cedar * (0.85 + 0.3 * big), base, step(0.6, hash12(vec2(seed, 31.0))) * 0.85);
    }
    gDirOcc *= 1.0 - sh * micro;
    ao *= 1.0 - line * 0.45 * micro - 0.07 * (1.0 - micro);
    matRough = 0.72;
  } else if (matId == 1.0) {
    // hand-trowelled stucco
    float e = 0.012;
    float h0 = stuccoH(f);
    if (micro > 0.01) grad += vec2(stuccoH(f + vec2(e, 0.0)) - h0, stuccoH(f + vec2(0.0, e)) - h0) / e * 0.005 * micro;
    base *= 0.95 + 0.1 * h0;
    base *= 0.96 + 0.08 * smoothstep(0.45, 0.55, vnoise(f * 0.6 + seed * 20.0));   // patched, repainted areas
    matRough = 0.93;
  } else if (matId == 2.0) {
    // brick, American common bond (a header course every sixth), recessed mortar
    vec2 bsz = vec2(0.225, 0.076);
    float row = floor(f.y / bsz.y);
    float header = step(mod(row, 6.0), 0.5);
    float bl = mix(bsz.x, bsz.x * 0.5, header);
    float xb = f.x / bl + mod(row, 2.0) * 0.5 + header * 0.25;
    vec2 bid = vec2(floor(xb), row);
    vec2 g = vec2(fract(xb) - 0.5, fract(f.y / bsz.y) - 0.5);
    vec2 dm = (0.5 - abs(g)) * vec2(bl, bsz.y);
    float e = min(dm.x, dm.y);
    float hj = 0.0055;
    float bmicro = 1.0 - smoothstep(0.006, 0.028, px);
    float mortar = (1.0 - smoothstep(hj - px, hj + px, e)) * bmicro;
    float bev = (1.0 - smoothstep(hj, hj + 0.008, e)) * (1.0 - mortar);
    vec2 dir = dm.x < dm.y ? vec2(-sign(g.x), 0.0) : vec2(0.0, -sign(g.y));
    grad += dir * bev * 0.9 * bmicro;
    float hb = hash12(bid + seed * 13.0), hb2 = hash12(bid * 1.7 + 3.0);
    vec3 bc = base * (0.8 + 0.34 * hb) * vec3(1.0 + 0.1 * (hb2 - 0.5), 1.0, 1.0 - 0.12 * (hb2 - 0.5));
    bc *= 1.0 - 0.35 * step(0.93, hb2);
    vec3 mortarC = vec3(0.62, 0.6, 0.56) * (0.9 + 0.1 * big);
    base = mix(mix(base * 0.97, mortarC, 0.12), mix(bc, mortarC, mortar), bmicro);
    gDirOcc *= 1.0 - mortar * 0.6;
    ao *= 1.0 - mortar * 0.25;
    matRough = mix(0.85, 0.95, mortar);
  } else if (matId == 3.0) {
    // ashlar stone or terracotta; rusticated base with deep V-grooves on the ground floor
    float rust = (f.y < groundH && !house) ? 1.0 : 0.0;
    float ch = rust > 0.5 ? 0.5 : 0.62;
    float course = floor(f.y / ch);
    float bl = rust > 0.5 ? 1.6 : 0.8 + 0.6 * hash12(vec2(course, seed));
    float xb = f.x / bl + hash12(vec2(course * 1.7, seed));
    vec2 bid = vec2(floor(xb), course);
    vec2 g = vec2(fract(xb) - 0.5, fract(f.y / ch) - 0.5);
    vec2 dm = (0.5 - abs(g)) * vec2(bl, ch);
    float hj = rust > 0.5 ? 0.012 : 0.004;
    float chamf = rust > 0.5 ? 0.05 : 0.01;
    float smicro = 1.0 - smoothstep(0.01, 0.06, px);
    float e = rust > 0.5 ? dm.y : min(dm.x, dm.y);
    float joint = (1.0 - smoothstep(hj - px, hj + px, e)) * smicro;
    float bev = (1.0 - smoothstep(hj, hj + chamf, e)) * (1.0 - joint);
    vec2 dir = (dm.x < dm.y && rust < 0.5) ? vec2(-sign(g.x), 0.0) : vec2(0.0, -sign(g.y));
    grad += dir * bev * (rust > 0.5 ? 1.0 : 0.6) * smicro;
    if (rust > 0.5) { // the groove under each course lies in the shadow of the block above
      float gsh = 1.0 - smoothstep(0.0, clamp(0.03 * sunUp / sunZ, 0.0, 0.25) + px, (0.5 - g.y) * ch);
      gDirOcc *= 1.0 - gsh * 0.85 * smicro;
    }
    base *= 0.92 + 0.14 * hash12(bid + seed * 7.0) * smicro + 0.05 * vnoise(f * 3.0);
    base = mix(base, base * 0.7, joint);
    matRough = hash12(vec2(seed, 17.0)) < 0.3 ? 0.5 : 0.8;   // glazed terracotta
  } else if (matId == 4.0) {
    // cast concrete: panel joints at floor lines and every few bays, form-tie holes, patchy pours
    float sy = fract((f.y - groundH) / floorH + 0.5) - 0.5;
    float pw = colW * (1.0 + floor(hash12(vec2(seed, 3.0)) * 3.0));
    float sx = fract(f.x / pw + 0.5) - 0.5;
    float jy = abs(sy) * floorH, jx = abs(sx) * pw;
    float j = min(jy, jx);
    float cmicro = 1.0 - smoothstep(0.01, 0.05, px);
    float joint = (1.0 - smoothstep(0.01 - px, 0.01 + px, j)) * cmicro;
    vec2 dir = jy < jx ? vec2(0.0, sign(sy)) : vec2(sign(sx), 0.0);
    grad += dir * (1.0 - smoothstep(0.01, 0.025, j)) * (1.0 - joint) * 0.8 * cmicro;
    vec2 tie = (fract(f / vec2(0.6, 0.45)) - 0.5) * vec2(0.6, 0.45);
    float holes = (1.0 - smoothstep(0.012, 0.012 + px, length(tie))) * cmicro * step(0.5, hash12(vec2(seed, 41.0)));
    vec2 pid = floor(vec2(f.x / pw, (f.y - groundH) / floorH));
    base *= (0.92 + 0.12 * hash12(pid + seed)) * (0.95 + 0.1 * vnoise(f * 1.3));
    base = mix(base, base * 0.6, max(joint, holes * 0.8));
    gDirOcc *= 1.0 - joint * 0.5;
    matRough = 0.92;
  } else {
    // curtain-wall spandrels: ribbed metal panels
    float s = fract(f.x / 0.35) - 0.5;
    grad.x += sign(s) * (1.0 - smoothstep(0.0, 0.025, abs(s) * 0.35)) * 0.5 * micro;
    matRough = 0.42; gMetal = 0.45;
  }

  // ---- weathering ----
  float paint = (matId == 0.0 || matId == 1.0) ? 1.0 : 0.0;
  // sun-faded paint on south and west faces (z points south, x east)
  float fade = clamp(0.6 * N.z - 0.45 * N.x, 0.0, 1.0) * (0.3 + 0.7 * hash12(vec2(seed, 23.0))) * paint;
  float lum = dot(base, vec3(0.3, 0.55, 0.15));
  base = mix(base, mix(vec3(lum), base, 0.6) * 1.1 + 0.03, fade * 0.45);
  float grimeK = matId == 0.0 ? 0.5 : matId == 2.0 ? 0.7 : cw ? 0.3 : 1.0;
  float splash = (1.0 - smoothstep(0.0, 1.8, f.y)) * (0.6 + 0.4 * vnoise(f * vec2(1.5, 5.0)));
  float soot = smoothstep(0.55, 0.85, vnoise(vec2(f.x * 1.7, f.y * 0.06 + seed * 9.0))) * smoothstep(H - 9.0, H - 0.5, f.y);
  float dirt = smoothstep(0.45, 0.8, vnoise(f * vec2(0.3, 0.08) + seed * 11.0) * 0.7 + vnoise(f * vec2(1.1, 0.3)) * 0.3);
  base *= 1.0 - grimeK * (0.22 * splash + 0.14 * soot + 0.1 * dirt);

  // ---- windows: casing on the façade, a recessed opening with reveals, sash and glass ----
  float win = (1.0 - smoothstep(-px, px, dWin)) * rows;
  float frame = (1.0 - smoothstep(-px, px, dWin - frameT)) * rows - win;
  float noSill = cw ? 0.0 : 1.0;
  float sillY = local.y + halfWin.y + 0.07;
  float sillX = 1.0 - smoothstep(-px, px, abs(local.x) - halfWin.x - 0.1);
  float sill = (1.0 - smoothstep(-px, px, abs(sillY) - 0.06)) * sillX * rows * noSill;
  // rain streaks washing down from the sills
  float below = -(sillY + 0.06);
  float streak = rows * noSill * step(0.0, below) * (1.0 - smoothstep(0.0, 0.9, below)) * step(abs(local.x), halfWin.x + 0.06)
               * smoothstep(0.3, 0.75, vnoise(vec2(f.x * 9.0, f.y * 0.35 + id.x * 3.1)));
  base *= 1.0 - streak * 0.25 * grimeK;
  // sill: the top catches the sky, the wall below it sits in its shadow
  grad.y += -2.2 * sill * smoothstep(-0.01, 0.03, sillY);
  float sillSh = sillX * rows * noSill * step(0.0, below) * (1.0 - smoothstep(0.0, clamp(0.07 * sunUp / sunZ, 0.0, 0.6) + px, below));
  gDirOcc *= 1.0 - sillSh * 0.9;
  ao *= 1.0 - 0.25 * sillX * rows * noSill * step(0.0, below) * (1.0 - smoothstep(0.0, 0.06, below));
  // casing / surround, proud of the wall with a bevelled outer edge
  vec2 od = boxDir(local, halfWin);
  vec3 frameC = base * 0.62;
  if (house) frameC = trimC;
  else if (matId == 3.0) frameC = base * 1.12 + 0.04;
  else if (matId == 2.0) frameC = local.y > halfWin.y ? mix(base, vec3(0.74, 0.71, 0.65), step(0.5, hash12(vec2(seed, 61.0)))) * 0.92 : base;
  else if (matId == 1.0 || matId == 4.0) frameC = base * 0.96;
  else if (cw) frameC = vec3(0.16, 0.17, 0.18);
  float bevel = frame * smoothstep(frameT - 0.035, frameT, dWin);
  grad -= od * bevel * (house || matId == 3.0 ? 1.2 : cw ? 0.8 : 0.3);
  base = mix(base, frameC, clamp(frame, 0.0, 1.0));
  base = mix(base, house ? accentC : base * 1.12 + 0.03, sill);
  if (cw) { gMetal = mix(gMetal, 0.7, frame); matRough = mix(matRough, 0.35, frame); }
  else if (house) matRough = mix(matRough, 0.55, frame + sill);

  // houses: belt courses at the floor lines (with a shadow under the moulding); bay rhythm
  if (house) {
    base *= 0.96 + 0.06 * step(0.5, fract(id.x * 0.5 + seed));
    float yb = (f.y - groundH) - floor((f.y - groundH) / floorH + 0.5) * floorH;   // metres from the nearest floor line
    float belt = (1.0 - smoothstep(-px, px, abs(yb - 0.12) - 0.08)) * step(groundH + 1.0, f.y);
    base = mix(base, trimC, belt * 0.85);
    grad.y += -1.5 * belt * smoothstep(0.1, 0.2, yb);
    float bsh = step(groundH + 1.0, f.y) * step(yb, 0.04) * (1.0 - smoothstep(0.0, clamp(0.05 * sunUp / sunZ, 0.0, 0.4) + px, 0.04 - yb));
    gDirOcc *= 1.0 - bsh * 0.85;
    if (ladies) base = mix(base, accentC, (1.0 - smoothstep(-px, px, abs(yb - 0.12) - 0.018)) * step(groundH + 1.0, f.y));
  }
  // masonry blocks: projecting cornice under the parapet and a belt over the shopfronts, both
  // throwing a sun shadow down the wall
  if (!tower && !house && !shed && !cw) {
    float cornice = smoothstep(H - 1.3, H - 1.1, f.y) * (1.0 - smoothstep(H - 0.55, H - 0.35, f.y));
    base = mix(base, base * 1.18 + 0.05, cornice);
    grad.y += cornice * mix(1.6, -2.0, smoothstep(H - 1.0, H - 0.7, f.y));
    float csh = step(f.y, H - 1.3) * (1.0 - smoothstep(0.0, clamp(0.4 * sunUp / sunZ, 0.0, 3.0) + px, H - 1.3 - f.y));
    gDirOcc *= 1.0 - csh * 0.9;
    ao *= 1.0 - 0.25 * step(f.y, H - 1.3) * (1.0 - smoothstep(0.0, 0.35, H - 1.3 - f.y));
    float band = 1.0 - smoothstep(-px, px, abs(f.y - groundH + 0.1) - 0.18);
    base = mix(base, base * 0.8, band);
    grad.y += band * mix(1.2, -1.5, smoothstep(groundH - 0.2, groundH, f.y));
    float bsh = step(f.y, groundH - 0.28) * (1.0 - smoothstep(0.0, clamp(0.12 * sunUp / sunZ, 0.0, 1.0) + px, groundH - 0.28 - f.y));
    gDirOcc *= 1.0 - bsh * 0.85;
  }
  if (cw) base = mix(base, base * 0.55, (1.0 - win) * step(groundH, f.y) * 0.6);
  // coping along the parapet top: a lighter cap with a drip edge that shades a sliver of wall
  if (!house && !shed) {
    float cope = smoothstep(H - 0.13 - px, H - 0.13 + px, f.y);
    base = mix(base, cw || tower ? vec3(0.5, 0.52, 0.53) : mix(base, vec3(0.78, 0.76, 0.71), 0.65), cope);
    grad.y += cope * smoothstep(H - 0.05, H, f.y) * -2.5;
    float dsh = step(f.y, H - 0.13) * (1.0 - smoothstep(0.0, clamp(0.04 * sunUp / sunZ, 0.0, 0.3) + px, H - 0.13 - f.y));
    gDirOcc *= 1.0 - dsh * 0.8;
    matRough = mix(matRough, 0.6, cope);
  }

  // the opening: trace the view ray into the recess; it either meets a reveal or the glass plane
  float rev = cw ? 0.0 : house ? 0.11 : matId == 3.0 ? 0.3 : matId == 2.0 ? 0.22 : tower ? 0.18 : 0.15;
  vec2 Lg = local;
  float revealHit = 0.0, revDepth = 0.0, revLit = 1.0, glassSh = 0.0;
  vec3 revN = N;
  if (win > 0.001 && rev > 0.0) {
    vec2 ird = rd.xy / max(rd.z, 0.02);
    vec2 sgn = sign(ird + 1e-6);
    vec2 zc = (halfWin - local * sgn) / max(abs(ird), vec2(1e-4));
    float zHit = min(zc.x, zc.y);
    vec2 sunShift = sunT.xy / sunZ;
    if (zHit < rev) {
      revealHit = 1.0; revDepth = zHit;
      vec2 hp = local + ird * zHit;
      revN = zc.x < zc.y ? -sgn.x * T : vec3(0.0, -sgn.y, 0.0);
      vec2 ps = hp + sunShift * zHit;
      revLit = step(max(abs(ps.x) - halfWin.x, abs(ps.y) - halfWin.y), 0.003);
    } else {
      Lg = local + ird * rev;
      vec2 ps = Lg + sunShift * rev;
      glassSh = step(0.0, max(abs(ps.x) - halfWin.x, abs(ps.y) - halfWin.y));
    }
    if (sunT.z <= 0.0) { revLit = 1.0; glassSh = 0.0; }
  }
  // sash and glazing bars at the glass plane
  float sash = 0.0;
  vec3 sashC = house ? accentC : mix(vec3(0.13, 0.12, 0.11), vec3(0.86, 0.85, 0.82), step(0.55, hash12(vec2(seed, 71.0))));
  if (!cw && win > 0.001) {
    float dS = max(abs(Lg.x) - halfWin.x, abs(Lg.y) - halfWin.y);
    float sw = house ? 0.065 : 0.045;
    sash = smoothstep(-sw - px, -sw + px, dS);
    bool hung = house || matId == 2.0 || matId == 3.0 || (matId == 1.0 && seed > 0.5);
    if (hung) sash = max(sash, 1.0 - smoothstep(-px, px, abs(Lg.y) - 0.035));
    if (halfWin.x > 0.7) sash = max(sash, 1.0 - smoothstep(-px, px, abs(Lg.x) - 0.025));
    sash *= 1.0 - revealHit;
  }

  // ---- ground floor: shopfronts, or doors and garages on houses ----
  float shop = 0.0; vec2 sLocal = vec2(0.0); vec2 sId = vec2(0.0); float sW = 5.5, sH = 3.4;
  if (!house && !shed && H > 6.0) {
    sId = vec2(floor(f.x / sW), 0.0);
    sLocal = vec2((fract(f.x / sW) - 0.5) * sW, f.y - 2.05);
    float d = max(abs(sLocal.x) - (sW * 0.5 - 0.35), abs(sLocal.y) - 1.55);
    shop = 1.0 - smoothstep(-px, px, d);
    // stall riser under the display window, transom bar and mullions
    float riser = shop * (1.0 - smoothstep(-px, px, f.y - 0.95));
    float bars = max(1.0 - smoothstep(-px, px, abs(sLocal.y - 0.75) - 0.04), 1.0 - smoothstep(-px, px, abs(abs(sLocal.x) - sW * 0.17) - 0.035)) * shop;
    vec3 shopFrame = mix(vec3(0.12, 0.11, 0.1), vec3(0.45, 0.3, 0.18), step(0.6, hash12(sId + seed * 3.0)));
    float awning = step(3.7, f.y) * step(f.y, 4.15) * step(0.45, hash12(sId + seed));
    vec3 awnC = mix(vec3(0.5, 0.12, 0.1), vec3(0.12, 0.2, 0.18), step(0.5, hash12(sId * 3.0 + seed)));
    base = mix(base, awnC, awning);
    grad.y += awning * -1.2;
    float surround = (1.0 - smoothstep(-px, px, d - 0.12)) - shop;
    base = mix(base, shopFrame, surround);
    grad -= boxDir(sLocal, vec2(sW * 0.5 - 0.35, 1.55)) * surround * smoothstep(0.06, 0.12, d) * 1.0;
    base = mix(base, mix(vec3(0.1, 0.14, 0.12), vec3(0.3, 0.27, 0.25), hash12(sId * 1.3 + seed)), riser);
    base = mix(base, shopFrame, bars * (1.0 - riser));
    shop *= (1.0 - riser) * (1.0 - bars);
    matRough = mix(matRough, 0.5, max(surround, bars));
  } else if (house) {
    // garage door + entry stair door on the ground floor of SF row houses
    float gx = fract(f.x / 7.5) * 7.5;
    float garage = step(1.0, gx) * step(gx, 3.6) * step(f.y, 2.3) * step(0.0, f.y);
    float door = step(5.0, gx) * step(gx, 6.0) * step(0.4, f.y) * step(f.y, 2.8);
    vec3 gc = mix(vec3(0.85, 0.84, 0.8), vec3(0.3, 0.28, 0.26), step(0.6, hash12(vec2(floor(f.x / 7.5), seed))));
    if (ladies) gc = mix(gc, trimC, 0.7);
    float pr = fract(f.y * 2.0);
    base = mix(base, gc * (0.92 + 0.08 * step(0.12, pr)), garage);
    grad.y += garage * (pr < 0.12 ? 1.5 : 0.0) * micro;
    vec3 doorC = ladies ? accentC : vec3(0.22, 0.13, 0.08);
    vec2 dp = vec2(gx - 5.5, f.y - 1.6);
    float panel = step(max(abs(dp.x) - 0.32, abs(abs(dp.y) - 0.5) - 0.38), 0.0);
    base = mix(base, doorC * (1.0 - 0.15 * (1.0 - panel)), door);
    ao *= 1.0 - 0.3 * door;
  }

  // ---- glass with a room behind it (interior mapping) ----
  float winGlass = win * (1.0 - revealHit) * (1.0 - sash);
  float glass = max(winGlass, shop);
  bool isShop = shop > win;
  vec2 L = isShop ? sLocal : Lg;
  vec2 box = isShop ? vec2(sW, sH) : vec2(colW, floorH);
  vec2 rid = isShop ? sId + 50.0 : id;
  float depth = isShop ? 6.0 : (tower ? 7.0 : 4.5);
  vec3 ro = vec3(L, 0.0);
  vec3 bmax = vec3(box * 0.5, depth), bmin = vec3(-box * 0.5, 0.0);
  vec3 inv = 1.0 / (rd + vec3(1e-5));
  vec3 tf = max((bmax - ro) * inv, (bmin - ro) * inv);
  float t = min(min(tf.x, tf.y), tf.z);
  vec3 hit = ro + rd * t;
  float rr = hash12(rid + seed * 37.0);
  vec3 wallC = mix(vec3(0.78, 0.74, 0.66), vec3(0.62, 0.66, 0.7), rr) * (0.8 + 0.3 * hash12(rid + 1.7));
  if (isShop) wallC = mix(vec3(0.55, 0.35, 0.25), vec3(0.3, 0.38, 0.42), hash12(rid * 4.1)) + 0.15;
  vec3 room;
  if (t == tf.z) {
    room = wallC * 0.85;
    float furn = step(abs(hit.x - (rr - 0.5) * box.x * 0.5), box.x * 0.22) * step(hit.y, -box.y * 0.5 + 0.9);
    room = mix(room, vec3(0.18, 0.15, 0.13) + rr * 0.15, furn);
    if (isShop) {
      float shelf = step(0.6, fract(hit.y * 1.6)) * step(abs(hit.x), box.x * 0.45);
      room = mix(room, vec3(hash12(floor(hit.xy * 3.0) + rr), hash12(floor(hit.xy * 3.0) + 2.0), hash12(floor(hit.xy * 3.0) + 5.0)) * 0.7, shelf * 0.8);
    }
  } else if (t == tf.y) {
    room = rd.y > 0.0 ? vec3(0.86, 0.85, 0.82) : mix(vec3(0.3, 0.21, 0.14), vec3(0.42, 0.4, 0.38), step(0.5, rr));
    if (tower && rd.y > 0.0) room += vec3(0.25 + 0.95 * uNight) * step(0.85, fract(hit.z * 0.4)) * step(abs(hit.x), box.x * 0.3); // office ceiling strips, subtle by day
  } else room = wallC * 0.7;
  room *= 1.0 - 0.55 * clamp(hit.z / depth, 0.0, 1.0);
  float litShare = (isShop ? 0.85 : tower ? 0.32 : house ? 0.42 : 0.34) * (0.35 + 1.3 * hash12(vec2(seed * 17.0, 1.0)));
  float lit = step(hash12(rid * 1.31 + seed), litShare);
  vec3 warm = mix(vec3(1.0, 0.74, 0.46), vec3(0.86, 0.92, 1.0), step(0.72, hash12(rid * 1.7 + seed)) + (tower ? 0.6 : 0.0));
  float day = (isShop ? 0.32 : 0.18) * (1.0 - uNight);
  float night = lit * uNight * (isShop ? 2.4 : 1.5);
  vec3 interior = room * (day + night * warm);
  float bl = step(0.68, hash12(rid * 2.3 + seed)) * (isShop ? 0.0 : 1.0);
  float blDrop = mix(0.25, 0.9, hash12(rid * 5.1 + seed));
  float blinds = bl * step(halfWin.y - blDrop * 2.0 * halfWin.y, L.y);
  vec3 blindC = mix(vec3(0.82, 0.78, 0.68), vec3(0.6, 0.45, 0.35), step(0.5, hash12(rid * 7.3)));
  interior = mix(interior, blindC * (day * 1.6 + night * warm * 0.7), blinds);
  interior *= 1.0 - 0.35 * glassSh * (1.0 - uNight);
  // curtain-wall panes are never quite flat: a per-pane tilt and a slight bulge break up the reflections
  if (cw) {
    vec2 wob = (vec2(hash12(id + seed * 3.1), hash12(id * 1.9 + seed)) - 0.5) * 0.035;
    grad += (wob + local / max(halfWin, vec2(0.1)) * 0.012 * hash12(id * 2.7 + seed)) * winGlass;
  }

  // reveals: the jambs, head and sill of the opening, shaded by depth and by the sun's angle
  vec3 revC = house ? trimC : (matId == 2.0 ? base * 0.9 : base * 0.95);
  float rv = win * revealHit;
  base = mix(base, revC * (1.0 - 0.35 * revDepth / max(rev, 0.01)), rv);
  base = mix(base, sashC, win * sash);
  gDirOcc *= mix(1.0, revLit, rv);
  gDirOcc *= 1.0 - glassSh * win * (1.0 - revealHit) * 0.9;

  vec3 tint = cw ? mix(vec3(0.05, 0.08, 0.1), vec3(0.1, 0.12, 0.1), seed) : vec3(0.0);
  base = mix(base, tint, glass);
  float paneRough = 0.02 + 0.04 * hash12(id * 3.3 + seed) * (cw ? 1.0 : 0.3);
  gRough = mix(mix(matRough, 0.6, rv), max(paneRough, cw ? 0.09 : 0.03), glass);
  gMetal = mix(gMetal * (1.0 - rv), cw ? 0.38 : 0.0, glass);
  gEmit = interior * glass * (cw ? 0.55 : 1.0);
  gGlass = glass;
  if (H > 150.0) gEmit += vec3(1.0, 0.05, 0.02) * step(H - 0.9, f.y) * step(f.y, H - 0.3) * step(fract(f.x / 14.0), 0.025) * step(0.5, fract(uTime * 0.5 + seed)) * 14.0 * uNight;
  base *= ao;
  float spill = texture2D(uLamps, (vWorldPos.xz - uWorldRect.xy) / uWorldRect.zw).r;
  gEmit += base * (1.0 - glass) * uNight * (vec3(1.0, 0.75, 0.5) * spill * 0.9 * (1.0 - smoothstep(1.0, 10.0, f.y)) + vec3(0.55, 0.5, 0.48) * 0.03);
  gNW = rv > 0.5 ? revN : normalize(N - grad.x * T - vec3(0.0, grad.y, 0.0));
  gBump = 1.0;
} else if (vInfo.w < 1.5) {
  vec2 w = vWorldPos.xz;
  float px = fwidth(w.x) + fwidth(w.y) + 0.001;
  float rmicro = 1.0 - smoothstep(0.01, 0.05, px);
  if (N.y < 0.97) {
    // pitched: asphalt shingles in courses up the slope, with tab cut-outs and per-tab tone
    vec2 sd = normalize(N.xz + 1e-5);
    float along = dot(w, vec2(-sd.y, sd.x));
    float up = -dot(w, sd) / max(N.y, 0.3);
    float course = floor(up / 0.14), t = fract(up / 0.14);
    float tabX = along / 0.33 + mod(course, 2.0) * 0.5;
    float cut = (1.0 - smoothstep(0.0, 0.004 + px, min(fract(tabX), 1.0 - fract(tabX)) * 0.33)) * (1.0 - smoothstep(0.0, 0.55, t));
    float edge = 1.0 - smoothstep(0.0, 0.008 + px, t * 0.14);
    base *= mix(1.0, (0.82 + 0.3 * hash12(vec2(floor(tabX), course) + seed)) * (1.0 - 0.5 * max(cut, edge)), rmicro) * (0.9 - 0.08 * (1.0 - rmicro));
    base *= 0.85 + 0.3 * vnoise(w * 0.5 + seed * 20.0);
    gRough = 0.9;
  } else {
    float rt = hash12(vec2(seed * 7.7, 1.3));
    float g = vnoise(w * 0.35 + seed * 30.0) * 0.6 + vnoise(w * 1.3) * 0.4;
    float stain = smoothstep(0.55, 0.72, vnoise(w * 0.12 + seed * 9.0));
    if (rt < 0.4 && H > 6.0) {
      // white single-ply membrane in 1.8 m rolls: seams, dirt and ponding stains
      base = vec3(0.8, 0.8, 0.78) * (0.92 + 0.08 * g);
      float sl = (0.5 - abs(fract(w.x / 1.83 + seed) - 0.5)) * 1.83;
      base *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.02 + px, sl)) * rmicro;
      base *= 1.0 - 0.28 * stain - 0.12 * smoothstep(0.5, 0.9, vnoise(w * 0.5));
      gRough = 0.55;
    } else if (rt < 0.72) {
      // tar and gravel
      base = mix(vec3(0.3, 0.29, 0.27), vec3(0.44, 0.41, 0.37), g);
      base *= 1.0 + (hash12(floor(w * 40.0)) - 0.5) * 0.35 * rmicro;
      base *= 1.0 - 0.15 * stain;
      gRough = 0.96;
    } else {
      // granulated cap sheet in 1 m laps
      base *= 0.8 + 0.35 * g;
      float sl = fract(w.y + seed);
      base *= 1.0 - 0.15 * (1.0 - smoothstep(0.0, 0.03 + px, sl)) * rmicro;
      base *= 1.0 - 0.2 * stain;
      gRough = 0.9;
    }
  }
} else if (vInfo.w < 2.5) {
  // inner face of a parapet, coping along the top
  float ph = H > 40.0 ? 1.4 : 0.8;
  base *= 0.75 + 0.1 * vnoise(vWorldPos.xz * 2.0);
  base = mix(base, vec3(0.72, 0.71, 0.68), step(ph - 0.13, vFacade.y));
  gRough = 0.9;
} else if (vInfo.w < 3.5) {
  // painted house trim: cornices, bay window caps; brackets and dentils in the accent colour
  base = trimC;
  if (abs(N.y) < 0.5) {
    vec2 f = vFacade;
    float px = max(fwidth(f.x), fwidth(f.y)) * 0.75;
    float br = 1.0 - smoothstep(-px, px, abs(fract(f.x / 0.55) - 0.5) * 0.55 - 0.06);
    float dent = step(0.5, fract(f.x / 0.14)) * (1.0 - smoothstep(-px, px, abs(fract(f.y) - 0.92) - 0.04));
    base = mix(base, ladies ? accentC : trimC * 0.85, max(br * 0.85, dent * 0.6));
    gDirOcc *= 1.0 - 0.4 * dent;
  }
  base *= 0.95 + 0.08 * vnoise(vWorldPos.xz * 3.0 + vWorldPos.y);
  gRough = 0.6;
} else {
  // parapet coping
  base *= 0.92 + 0.12 * vnoise(vWorldPos.xz * 3.0);
  gRough = 0.7;
}
diffuseColor.rgb = base;
`;

export function createBuildings(map, csm) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  mat.name = 'buildings';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aInfo;\nvarying vec2 vFacade;\nvarying vec4 vInfo;\nvarying vec3 vWorldPos;\nvarying vec3 vObjN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacade = uv;\nvInfo = aInfo;\nvObjN = normal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + facadeGLSL)
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + DIRECT_OCC)
      .replace('#include <color_fragment>', FACADE_FRAG)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (gBump > 0.5) normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;');
  });

  // which edge of a row house faces the street: probe outwards from each edge's midpoint
  const RG = 30, roadGrid = new Map();
  for (const r of map.roads) {
    if (r.k > 6 || r.br) continue;
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const s = [r.p[i * 2], r.p[i * 2 + 1], r.p[i * 2 + 2], r.p[i * 2 + 3], r.w / 2];
      for (let gx = Math.floor(Math.min(s[0], s[2]) / RG); gx <= Math.floor(Math.max(s[0], s[2]) / RG); gx++)
        for (let gz = Math.floor(Math.min(s[1], s[3]) / RG); gz <= Math.floor(Math.max(s[1], s[3]) / RG); gz++) {
          const k = gx + ',' + gz; let l = roadGrid.get(k); if (!l) roadGrid.set(k, l = []); l.push(s);
        }
    }
  }
  const roadDist = (x, z) => {
    let best = Infinity;
    for (let gx = Math.floor(x / RG) - 1; gx <= Math.floor(x / RG) + 1; gx++) for (let gz = Math.floor(z / RG) - 1; gz <= Math.floor(z / RG) + 1; gz++)
      for (const s of roadGrid.get(gx + ',' + gz) || []) {
        const dx = s[2] - s[0], dz = s[3] - s[1], L = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L));
        best = Math.min(best, Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t) - s[4]);
      }
    return best;
  };
  const frontOf = b => {
    const p = b.p, n = p.length / 2;
    let best = -1, bd = 9;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 4 || len > 16) continue;
      const nx = (z1 - z0) / len, nz = -(x1 - x0) / len;
      const d = roadDist((x0 + x1) / 2 + nx * 2, (z0 + z1) / 2 + nz * 2);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const chunks = new Map();
  map.buildings.forEach((b, i) => {
    const p = b.p;
    let cx = 0, cz = 0; for (let k = 0; k < p.length; k += 2) { cx += p[k]; cz += p[k + 1]; }
    cx /= p.length / 2; cz /= p.length / 2;
    const key = Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
    let gb = chunks.get(key);
    if (!gb) chunks.set(key, gb = new GeoBuilder());
    addBuilding(gb, b, i, frontOf);
  });

  const group = new THREE.Group();
  for (const gb of chunks.values()) {
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.material = mat;
  return group;
}
