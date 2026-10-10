// Every OSM building extruded to its measured height and merged into chunk meshes. The facades are
// procedural: a shader lays out floors, window bays, shopfronts and curtain-wall glass in world metres,
// reflects the sky in the glass and switches random windows on at night.
import * as THREE from 'three';
import { GLSL_NOISE, addHook, useShared } from './fog.js';

const CHUNK = 500;

// Façade palettes. SF: pastel stucco Victorians and Edwardians, warm beige and grey downtown masonry,
// pale concrete and glass towers.
const PAL_HOUSE = ['#e8dccb', '#d9c7a7', '#c9d3d1', '#e3c6b5', '#b9c4cf', '#efe6d2', '#d4b99a', '#c2cbb4', '#e6d3c2', '#a9b8c4', '#f0e2c4', '#cfbfb0', '#dcb7a1', '#b7c7bb'];
const PAL_CITY = ['#cfc6b8', '#b8ad9c', '#d8d2c6', '#a59a8a', '#c4b49c', '#8f8a84', '#e0dbd2', '#b3aca2', '#c9b8a2', '#9fa3a6'];
const PAL_INDUSTRIAL = ['#a89c8c', '#8e8a84', '#b4a48e', '#9a7e6a', '#c2b8a8', '#7d7770'];
const PAL_BRICK = ['#9a5a44', '#8c4c3a', '#a8664e', '#7e4a3c'];

function rand(seed) { let s = seed | 0; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; }; }
const tmpColor = new THREE.Color();
function parseColour(c) {
  if (!c) return null;
  try { tmpColor.set(c.replace(/;.*/, '').trim()); return tmpColor.clone(); } catch { return null; }
}

// kind codes in the shader: 1 house, 2 commercial, 3 industrial, 4 small/garage, 5 roof/canopy, 6 church, 7 civic, 0 generic
function wallStyle(b, rnd) {
  const k = b.k || 0;
  if (b.mat === 'brick') return new THREE.Color(PAL_BRICK[Math.floor(rnd() * PAL_BRICK.length)]);
  if (b.mat === 'glass') return new THREE.Color('#6f7f8c');
  const own = parseColour(b.c);
  if (own) return own;
  if (k === 1 || (k === 0 && b.h < 14)) return new THREE.Color(PAL_HOUSE[Math.floor(rnd() * PAL_HOUSE.length)]);
  if (k === 3) return new THREE.Color(PAL_INDUSTRIAL[Math.floor(rnd() * PAL_INDUSTRIAL.length)]);
  if (b.h > 60) return new THREE.Color(['#9aa6ae', '#b7bcbd', '#8d9aa3', '#c9c6bd', '#7f8b93'][Math.floor(rnd() * 5)]);
  return new THREE.Color(PAL_CITY[Math.floor(rnd() * PAL_CITY.length)]);
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

function addBuilding(gb, b, index) {
  const rnd = rand(index * 7919 + 13);
  const p = b.p;
  const n = p.length / 2;
  const bottom = b.b + (b.m || 0) - (b.m ? 0 : 2.5); // sink walls into the slope
  const top = b.b + b.h;
  const wall = wallStyle(b, rnd);
  const seed = rnd();
  const kind = b.k || 0;
  const infoW = [seed, kind, b.h, 0];
  const infoR = [seed, kind, b.h, 1];
  const vBase = b.b - bottom; // façade v is metres above the ground line, so floors line up with the street

  // walls (rings are normalised so the signed area is positive in x/z, i.e. clockwise seen from above:
  // the outward normal of an edge is (dz, -dx))
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[j * 2], z1 = p[j * 2 + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len;
    const a = gb.vert(x0, bottom, z0, nx, 0, nz, u, -vBase + (b.m || 0), wall, infoW);
    const bb = gb.vert(x1, bottom, z1, nx, 0, nz, u + len, -vBase + (b.m || 0), wall, infoW);
    const c = gb.vert(x1, top, z1, nx, 0, nz, u + len, b.h, wall, infoW);
    const d = gb.vert(x0, top, z0, nx, 0, nz, u, b.h, wall, infoW);
    gb.idx.push(a, c, bb, a, d, c);
    u += len + 0.0;
  }

  // roof
  const roofCol = parseColour(b.rc) || (kind === 1 ? new THREE.Color(['#6b6560', '#7a746c', '#5d5853', '#8a8277', '#9a948a'][Math.floor(rnd() * 5)])
    : new THREE.Color(['#8a8580', '#9c9690', '#6f6b67', '#b5b0a8', '#c9c4bc', '#7c7671'][Math.floor(rnd() * 6)]));
  const contour = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { tris = []; }
  const pyramid = b.rs === 'pyramidal' || b.rs === 'spire' || b.rs === 'cone';
  const dome = b.rs === 'dome' || b.rs === 'onion';
  // flat roofs sit a little below a parapet (SF's false fronts and downtown parapets)
  const parapet = !pyramid && !dome && !b.part && b.h > 4 && kind !== 4 && kind !== 5 ? (b.h > 40 ? 1.4 : 0.8) : 0;
  const roofTop = top - parapet;
  if (parapet) {
    const infoP = [seed, kind, b.h, 2];
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
      .replace('#include <common>', '#include <common>\n' + facadeGLSL + '\nfloat gGlass; float gLit; float gRough; float gMetal; vec3 gEmit;')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        gGlass = 0.0; gLit = 0.0; gRough = 0.88; gMetal = 0.0; gEmit = vec3(0.0);
        float seed = vInfo.x, kind = vInfo.y, H = vInfo.z;
        vec3 base = diffuseColor.rgb;
        if (vInfo.w < 0.5) {
          vec2 f = vFacade;
          float grain = vnoise(f * vec2(2.3, 3.1)) * 0.05 + vnoise(f * 0.25 + seed * 50.0) * 0.08;
          base *= 0.93 + grain - smoothstep(3.5, 0.0, f.y) * 0.1;
          bool tower = H > 48.0;
          bool house = (kind == 1.0 || kind == 0.0) && H < 16.0;
          bool shed = kind == 3.0 || kind == 4.0 || kind == 5.0;
          float floorH = tower ? 3.9 : house ? 3.2 : 3.45;
          float colW = tower ? (1.55 + seed * 0.8) : house ? (2.2 + seed * 0.5) : (2.7 + seed * 1.3);
          float winW = tower ? 1.0 - 0.12 / colW : house ? 0.95 : 1.1 + seed * 0.6;   // metres
          float winH = tower ? floorH - 0.9 : house ? 1.9 : 1.6 + seed * 0.3;
          float groundH = house ? 0.9 : 4.3;
          float topClear = tower ? 2.2 : 1.2;
          bool hasWin = !shed || (kind == 3.0 && H > 8.0);
          if (kind == 3.0) { colW = 4.2; winW = 2.6; winH = 1.1; floorH = 4.6; }
          float px = max(fwidth(f.x), fwidth(f.y)) * 0.75;

          // --- upper-floor windows ---
          vec2 cell = vec2(f.x / colW, (f.y - groundH) / floorH);
          vec2 id = floor(cell);
          vec2 local = (fract(cell) - 0.5) * vec2(colW, floorH);
          vec2 halfWin = 0.5 * vec2(min(winW, colW - 0.3), winH);
          float dWin = max(abs(local.x) - halfWin.x, abs(local.y) - halfWin.y);
          float rows = step(groundH, f.y) * step(f.y, H - topClear) * (hasWin ? 1.0 : 0.0);
          float win = (1.0 - smoothstep(-px, px, dWin)) * rows;
          float frameT = house ? 0.13 : tower ? 0.05 : 0.07;
          float frame = (1.0 - smoothstep(-px, px, dWin - frameT)) * rows - win;
          float sill = (1.0 - smoothstep(-px, px, abs(local.y + halfWin.y + 0.07) - 0.06)) * (1.0 - smoothstep(-px, px, abs(local.x) - halfWin.x - 0.1)) * rows * (tower ? 0.0 : 1.0);
          if (house) {
            vec3 trim = mix(vec3(0.94, 0.93, 0.89), vec3(0.32, 0.36, 0.4), step(0.8, hash12(vec2(seed * 91.0, 3.0))));
            base = mix(base, trim, clamp(frame + sill, 0.0, 1.0));
            // bay-window rhythm and horizontal belt courses
            base *= 0.95 + 0.07 * step(0.5, fract(id.x * 0.5 + seed));
            float belt = 1.0 - smoothstep(-px, px, abs(fract((f.y - groundH) / floorH) * floorH - 0.12) - 0.08);
            base = mix(base, trim, belt * 0.5 * step(groundH + 1.0, f.y));
          } else {
            base = mix(base, base * 0.62, frame);
            base = mix(base, base * 1.12 + 0.03, sill);
          }
          if (!tower && !house && !shed) {
            float cornice = smoothstep(H - 1.3, H - 1.1, f.y) * (1.0 - smoothstep(H - 0.55, H - 0.35, f.y));
            base = mix(base, base * 1.2 + 0.05, cornice);
            float band = (1.0 - smoothstep(-px, px, abs(f.y - groundH + 0.1) - 0.18)) ;
            base = mix(base, base * 0.8, band);
          }
          if (tower) { // spandrel panels between floors read darker, mullions bright
            base = mix(base, base * 0.55, (1.0 - win) * step(groundH, f.y) * 0.6);
          }

          // --- ground floor: shopfronts, or doors and garages on houses ---
          float shop = 0.0; vec2 sLocal = vec2(0.0); vec2 sId = vec2(0.0); float sW = 5.5, sH = 3.4;
          if (!house && !shed && H > 6.0) {
            sId = vec2(floor(f.x / sW), 0.0);
            sLocal = vec2((fract(f.x / sW) - 0.5) * sW, f.y - 2.05);
            float d = max(abs(sLocal.x) - (sW * 0.5 - 0.35), abs(sLocal.y) - 1.55);
            shop = 1.0 - smoothstep(-px, px, d);
            float awning = step(3.7, f.y) * step(f.y, 4.15) * step(0.45, hash12(sId + seed));
            vec3 awnC = mix(vec3(0.5, 0.12, 0.1), vec3(0.12, 0.2, 0.18), step(0.5, hash12(sId * 3.0 + seed)));
            base = mix(base, awnC, awning);
            base = mix(base, base * 0.5, (1.0 - smoothstep(-px, px, d - 0.12)) - shop);
          } else if (house) {
            // garage door + entry stair door on the ground floor of SF row houses
            float gx = fract(f.x / 7.5) * 7.5;
            float garage = step(1.0, gx) * step(gx, 3.6) * step(f.y, 2.3) * step(0.0, f.y);
            float door = step(5.0, gx) * step(gx, 6.0) * step(0.4, f.y) * step(f.y, 2.8);
            vec3 gc = mix(vec3(0.85, 0.84, 0.8), vec3(0.3, 0.28, 0.26), step(0.6, hash12(vec2(floor(f.x / 7.5), seed))));
            float rib = 0.9 + 0.1 * step(0.5, fract(f.y * 3.0));
            base = mix(base, gc * rib, garage);
            base = mix(base, vec3(0.22, 0.13, 0.08), door);
          }

          // --- glass with a room behind it (interior mapping) ---
          float glass = max(win, shop);
          vec3 N = normalize(vObjN);
          vec3 T = vec3(-N.z, 0.0, N.x);
          vec3 V = normalize(vWorldPos - cameraPosition);
          vec3 rd = vec3(dot(V, T), V.y, -dot(V, N));
          bool isShop = shop > win;
          vec2 L = isShop ? sLocal : local;
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
            // a shelf / picture / sofa silhouette on the back wall
            float furn = step(abs(hit.x - (rr - 0.5) * box.x * 0.5), box.x * 0.22) * step(hit.y, -box.y * 0.5 + 0.9);
            room = mix(room, vec3(0.18, 0.15, 0.13) + rr * 0.15, furn);
            if (isShop) { // shelves of goods
              float shelf = step(0.6, fract(hit.y * 1.6)) * step(abs(hit.x), box.x * 0.45);
              room = mix(room, vec3(hash12(floor(hit.xy * 3.0) + rr), hash12(floor(hit.xy * 3.0) + 2.0), hash12(floor(hit.xy * 3.0) + 5.0)) * 0.7, shelf * 0.8);
            }
          } else if (t == tf.y) {
            room = rd.y > 0.0 ? vec3(0.86, 0.85, 0.82) : mix(vec3(0.3, 0.21, 0.14), vec3(0.42, 0.4, 0.38), step(0.5, rr));
            if (tower && rd.y > 0.0) room += vec3(1.2) * step(0.85, fract(hit.z * 0.4)) * step(abs(hit.x), box.x * 0.3);
          } else room = wallC * 0.7;
          room *= 1.0 - 0.55 * clamp(hit.z / depth, 0.0, 1.0);
          float litShare = (isShop ? 0.85 : tower ? 0.32 : house ? 0.42 : 0.34) * (0.35 + 1.3 * hash12(vec2(seed * 17.0, 1.0)));
          float lit = step(hash12(rid * 1.31 + seed), litShare);
          vec3 warm = mix(vec3(1.0, 0.74, 0.46), vec3(0.86, 0.92, 1.0), step(0.72, hash12(rid * 1.7 + seed)) + (tower ? 0.6 : 0.0));
          float day = (isShop ? 0.32 : 0.18) * (1.0 - uNight);
          float night = lit * uNight * (isShop ? 2.4 : 1.5);
          vec3 interior = room * (day + night * warm);
          // blinds/curtains on some windows: drawn from the top
          float bl = step(0.68, hash12(rid * 2.3 + seed)) * (isShop ? 0.0 : 1.0);
          float blDrop = mix(0.25, 0.9, hash12(rid * 5.1 + seed));
          float blinds = bl * step(halfWin.y - blDrop * 2.0 * halfWin.y, L.y);
          vec3 blindC = mix(vec3(0.82, 0.78, 0.68), vec3(0.6, 0.45, 0.35), step(0.5, hash12(rid * 7.3)));
          interior = mix(interior, blindC * (day * 1.6 + night * warm * 0.7), blinds);
          vec3 tint = tower ? mix(vec3(0.05, 0.08, 0.1), vec3(0.1, 0.12, 0.1), seed) : vec3(0.0);
          base = mix(base, tint, glass);
          gRough = mix(0.86 - grain, 0.03, glass);
          gMetal = glass * (tower ? 0.6 : 0.0);
          gEmit = interior * glass * (tower ? 0.55 : 1.0);
          gGlass = glass;
          if (H > 120.0) gEmit += vec3(1.0, 0.05, 0.02) * step(H - 1.2, f.y) * step(0.5, fract(uTime * 0.5)) * 6.0 * uNight;
        } else if (vInfo.w > 1.5) {
          // inner face of a parapet
          base *= 0.75 + 0.1 * vnoise(vWorldPos.xz * 2.0);
          gRough = 0.9;
        } else {
          float g = fbm(vWorldPos.xz * 0.35 + seed * 30.0);
          base *= 0.8 + 0.35 * g;
          float seams = smoothstep(0.03, 0.0, abs(fract(vWorldPos.x * 0.5 + seed) - 0.5) - 0.47) * 0.06;
          base *= 1.0 - seams;
          gRough = 0.92;
        }
        diffuseColor.rgb = base;
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;');
  });

  const chunks = new Map();
  map.buildings.forEach((b, i) => {
    const p = b.p;
    let cx = 0, cz = 0; for (let k = 0; k < p.length; k += 2) { cx += p[k]; cz += p[k + 1]; }
    cx /= p.length / 2; cz /= p.length / 2;
    const key = Math.floor(cx / CHUNK) + ',' + Math.floor(cz / CHUNK);
    let gb = chunks.get(key);
    if (!gb) chunks.set(key, gb = new GeoBuilder());
    addBuilding(gb, b, i);
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
