// Shared helpers for the hand-built landmarks: a small triangle-soup geometry builder, material setup
// (CSM shadows + shared night/time uniforms) and a few footprint utilities.
import * as THREE from 'three';
import { addHook, shared } from '../engine/fog.js';

export { shared, addHook };

const DECL = '\nuniform float uTime;\nuniform float uNight;\n';
// Adds uTime/uNight to a shader (without pulling every shared uniform in).
export function useNight(shader) {
  shader.uniforms.uTime = shared.uTime;
  shader.uniforms.uNight = shared.uNight;
  if (!shader.vertexShader.includes('uniform float uNight;'))
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>' + DECL);
  if (!shader.fragmentShader.includes('uniform float uNight;'))
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + DECL);
}

// Standard PBR material wired into the cascaded shadow maps. `hook(shader)` runs inside onBeforeCompile
// (after CSM's own hook); `worldPos: true` adds a `vLmWorld` varying (world position) to both stages.
export function makeMat(ctx, params, { hook, worldPos = false, name } = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  m.name = name || 'landmark';
  if (ctx.csm) ctx.csm.setupMaterial(m);
  if (hook || worldPos) {
    addHook(m, shader => {
      useNight(shader);
      if (worldPos) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLmWorld;\nvarying vec3 vLmNormal;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLmNormal = normalize(mat3(modelMatrix) * objectNormal);');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLmWorld;\nvarying vec3 vLmNormal;');
      }
      if (hook) hook(shader);
    });
    // the program cache key must differ per distinct hook body
    const prev = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => prev() + '|' + m.name;
  }
  return m;
}

export const GLSL_HASH = /* glsl */`
float lmHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lmNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lmHash(i), lmHash(i + vec2(1, 0)), u.x), mix(lmHash(i + vec2(0, 1)), lmHash(i + vec2(1, 1)), u.x), u.y); }
`;

// Unlit glowing material for lamps/beacons: colour scaled every frame by day/night in update().
export function glowMat(color) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });
  m.userData.base = new THREE.Color(color);
  return m;
}

// ---------------------------------------------------------------------------------------------
// Geometry builder: triangle soup with position / normal / uv, with a transform stack.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.m = new THREE.Matrix4(); this.nm = new THREE.Matrix3(); this.stack = []; }
  push(m) { this.stack.push(this.m.clone()); this.m = this.m.clone().multiply(m); this.nm.getNormalMatrix(this.m); return this; }
  pop() { this.m = this.stack.pop(); this.nm.getNormalMatrix(this.m); return this; }
  // raw vertex in local space with its own normal
  vert(x, y, z, nx, ny, nz, u, v) {
    _a.set(x, y, z).applyMatrix4(this.m); this.p.push(_a.x, _a.y, _a.z);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize(); this.n.push(_n.x, _n.y, _n.z);
    this.uv.push(u, v);
  }
  // flat triangle; if `face` ([x,y,z]) is given the winding is flipped as needed so the normal points that way
  tri(a, b, c, ua = [0, 0], ub = [1, 0], uc = [0, 1], face) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b);
    const l = _n.length();
    if (l < 1e-12) return this;
    if (face && _n.x * face[0] + _n.y * face[1] + _n.z * face[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; _n.negate(); }
    _n.divideScalar(l);
    const nx = _n.x, ny = _n.y, nz = _n.z;
    this.vert(a[0], a[1], a[2], nx, ny, nz, ua[0], ua[1]);
    this.vert(b[0], b[1], b[2], nx, ny, nz, ub[0], ub[1]);
    this.vert(c[0], c[1], c[2], nx, ny, nz, uc[0], uc[1]);
    return this;
  }
  // quad a,b,c,d (in order around the edge); `face` orients it, otherwise counter-clockwise = front
  quad(a, b, c, d, u0 = 0, v0 = 0, u1 = 1, v1 = 1, face) {
    if (!face) { // derive from the winding once so both halves agree
      _a.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); _b.set(d[0] - b[0], d[1] - b[1], d[2] - b[2]);
      // (a->c) x (b->d) is the quad's normal for a counter-clockwise a,b,c,d
      _n.crossVectors(_a, _b); face = [_n.x, _n.y, _n.z];
    }
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1], face);
    this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1], face);
    return this;
  }
  // axis-aligned box (in the current transform)
  box(x0, y0, z0, x1, y1, z1, { top = true, bottom = true, sides = true } = {}) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    const dx = x1 - x0, dz = z1 - z0;
    if (sides) {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], x0, y0, x1, y1, [0, 0, 1]);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], -x1, y0, -x0, y1, [0, 0, -1]);
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], -z1, y0, -z0, y1, [1, 0, 0]);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], z0, y0, z1, y1, [-1, 0, 0]);
    }
    if (top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], x0, z1, x1, z0, [0, 1, 0]);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], x0, z0, x1, z1, [0, -1, 0]);
    void dx; void dz;
    return this;
  }
  // vertical prism from a 2D ring [[x,z],...] (either winding); u runs along the perimeter in metres, v = y
  prism(ring, y0, y1, { top = true, bottom = false, u0 = 0, walls = true } = {}) {
    const r = ringCW(ring);
    const n = r.length;
    let u = u0;
    if (walls) for (let i = 0; i < n; i++) {
      const a = r[i], b = r[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      // CW from above => outward normal of edge a->b is (dz, -dx)
      const face = [(b[1] - a[1]), 0, -(b[0] - a[0])];
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], u, y0, u + len, y1, face);
      u += len;
    }
    if (top) this.cap(r, y1, 1);
    if (bottom) this.cap(r, y0, -1);
    return this;
  }
  cap(ring, y, dir = 1) {
    const pts = ring.map(q => new THREE.Vector2(q[0], q[1]));
    let tris = [];
    try { tris = THREE.ShapeUtils.triangulateShape(pts, []); } catch { tris = []; }
    for (const t of tris) {
      const A = ring[t[0]], B = ring[t[1]], C = ring[t[2]];
      this.tri([A[0], y, A[1]], [B[0], y, B[1]], [C[0], y, C[1]], [A[0], A[1]], [B[0], B[1]], [C[0], C[1]], [0, dir, 0]);
    }
    return this;
  }
  // frustum between two rings with the same vertex count (ring A at yA, ring B at yB), flat shaded
  loft(ringA, yA, ringB, yB, { u0 = 0 } = {}) {
    const flip = signedArea(ringA) < 0;
    const A = flip ? ringA.slice().reverse() : ringA, B = flip ? ringB.slice().reverse() : ringB;
    const n = A.length;
    let u = u0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const len = Math.hypot(A[j][0] - A[i][0], A[j][1] - A[i][1]);
      const face = [(A[j][1] - A[i][1]), 0, -(A[j][0] - A[i][0])];
      const up = yB > yA ? 1 : -1;
      // tilt the facing hint with the slope so steep roofs orient correctly
      const mx = (B[i][0] + B[j][0] - A[i][0] - A[j][0]) / 2, mz = (B[i][1] + B[j][1] - A[i][1] - A[j][1]) / 2;
      const inward = -(mx * face[0] + mz * face[2]);
      face[1] = inward > 0 ? up * inward / (Math.abs(yB - yA) + 1e-6) : 0;
      this.quad([A[i][0], yA, A[i][1]], [A[j][0], yA, A[j][1]], [B[j][0], yB, B[j][1]], [B[i][0], yB, B[i][1]], u, yA, u + len, yB, face);
      u += len;
    }
    return this;
  }
  // surface of revolution around (cx, cz): profile [[r, y], ...] bottom to top; smooth normals
  lathe(profile, seg = 24, { a0 = 0, a1 = Math.PI * 2, cx = 0, cz = 0, flat = false } = {}) {
    for (let k = 0; k < profile.length - 1; k++) {
      const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
      const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
      const nr = dy / l, ny = -dr / l; // outward for a profile climbing upward
      for (let i = 0; i < seg; i++) {
        const t0 = a0 + (a1 - a0) * i / seg, t1 = a0 + (a1 - a0) * (i + 1) / seg;
        const P = (r, y, t) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
        const tm = (t0 + t1) / 2;
        const N = t => flat ? [Math.cos(tm) * nr, ny, Math.sin(tm) * nr] : [Math.cos(t) * nr, ny, Math.sin(t) * nr];
        // angle increases from +x toward +z (clockwise seen from above): order (t1 -> t0) is counter-clockwise from outside
        const v = [[P(r0, y0, t1), N(t1), [i + 1, y0]], [P(r0, y0, t0), N(t0), [i, y0]], [P(r1, y1, t0), N(t0), [i, y1]],
          [P(r0, y0, t1), N(t1), [i + 1, y0]], [P(r1, y1, t0), N(t0), [i, y1]], [P(r1, y1, t1), N(t1), [i + 1, y1]]];
        if (r0 < 1e-6 && r1 < 1e-6) continue;
        for (const [p, nn, uv] of v) this.vert(p[0], p[1], p[2], nn[0], nn[1], nn[2], uv[0] / seg * (a1 - a0) * Math.max(r0, r1), uv[1]);
      }
    }
    return this;
  }
  add(geom, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const M = matrix ? this.m.clone().multiply(matrix) : this.m;
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    const v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M); this.p.push(v.x, v.y, v.z);
      if (N) { v.fromBufferAttribute(N, i).applyMatrix3(NM).normalize(); this.n.push(v.x, v.y, v.z); } else this.n.push(0, 1, 0);
      if (U) this.uv.push(U.getX(i), U.getY(i)); else this.uv.push(0, 0);
    }
    return this;
  }
  get count() { return this.p.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ring with positive (x,z) shoelace area = clockwise seen from above (x east, z south)
export function ringCW(ring) { return signedArea(ring) > 0 ? ring : ring.slice().reverse(); }

export function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// ring helpers -------------------------------------------------------------------------------
export function rectRing(x0, z0, x1, z1) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
export function roundRectRing(hx, hz, r, seg = 4, cx = 0, cz = 0) {
  const out = [];
  const corners = [[hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2], [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5]];
  for (const [x, z, a0] of corners) for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * i / seg; out.push([cx + x + Math.cos(a) * r, cz + z + Math.sin(a) * r]); }
  return out;
}
export function circleRing(r, seg = 24, cx = 0, cz = 0, a0 = 0) {
  return Array.from({ length: seg }, (_, i) => { const a = a0 + i / seg * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
}

// world footprint ring (flat [x0,z0,...], positive signed area as map.buildings uses) from local points
export function worldRing(pts, toWorld) {
  const flat = [];
  const w = pts.map(p => toWorld(p[0], p[1]));
  if (signedArea(w) < 0) w.reverse();
  for (const p of w) flat.push(+p[0].toFixed(2), +p[1].toFixed(2));
  return flat;
}

// A local frame: origin (ox, oz) and heading so that local +x = `right` and local -z = `fwd`
export function frame(ox, oz, fx, fz) {
  const l = Math.hypot(fx, fz); fx /= l; fz /= l;
  const rx = -fz, rz = fx; // right-hand of forward (x east, z south): rotate fwd by +90deg seen from above
  const theta = Math.atan2(-rz, rx);
  return {
    ox, oz, fx, fz, rx, rz, theta,
    // local (x right, z back) -> world
    toWorld: (x, z) => [ox + x * rx - z * fx, oz + x * rz - z * fz],
    toLocal: (wx, wz) => { const dx = wx - ox, dz = wz - oz; return [dx * rx + dz * rz, -(dx * fx + dz * fz)]; },
    apply(obj) { obj.position.set(ox, 0, oz); obj.rotation.set(0, theta, 0); return obj; },
  };
}

export function centroid(p) {
  let cx = 0, cz = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; }
  return [cx / (p.length / 2), cz / (p.length / 2)];
}

export function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo instanceof Geo ? geo.build() : geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

// Orients a unit box/cylinder (along local +Z for boxes) from point a to b. Returns a Matrix4.
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
export function beamMatrix(a, b, w, h, out = new THREE.Matrix4()) {
  _z.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _z.length(); _z.divideScalar(len || 1);
  const up = Math.abs(_z.y) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  _x.set(up[0], up[1], up[2]).cross(_z).normalize();
  _y.copy(_z).cross(_x);
  out.makeBasis(_x.multiplyScalar(w), _y.multiplyScalar(h), _z.multiplyScalar(len));
  out.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return out;
}

// Points that stay a few pixels wide at any distance: distant lamps, aviation lights, crowns at night.
let _dot;
function dotTexture() {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  _dot = new THREE.CanvasTexture(c);
  return _dot;
}
export function glowPoints(positions, color, size = 5) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions.flat(), 3));
  const m = new THREE.PointsMaterial({ color: new THREE.Color(color), size, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  m.userData.base = new THREE.Color(color);
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

// Vertex hook: pushes vertices out along their normal so thin cables/ropes never get thinner than
// about `px` pixels on screen (kills the dashed look of sub-pixel cylinders). `r` = true radius.
export function minWidthHook(r, px = 0.7) {
  return shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      {
        vec4 lmW = modelMatrix * vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lmW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #endif
        float lmD = length(cameraPosition - lmW.xyz);
        float lmMin = lmD * ${(px * 0.00107).toFixed(6)};
        #ifdef USE_INSTANCING
          float lmS = length(instanceMatrix[0].xyz);
          transformed.xz *= max(1.0, lmMin / lmS);
        #else
          transformed += normal * max(0.0, lmMin - ${r.toFixed(3)});
        #endif
      }`);
  };
}

// Soft additive light pools (decals) on the ground under street lamps, shown at night.
let _pool;
export function lightPools(spots, color, radius = 9) {
  if (!_pool) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    _pool = new THREE.CanvasTexture(c);
  }
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), map: _pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  m.userData.base = new THREE.Color(color);
  const im = new THREE.InstancedMesh(geo, m, spots.length);
  const mt = new THREE.Matrix4();
  spots.forEach((p, i) => { mt.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, mt); });
  im.computeBoundingSphere();
  im.renderOrder = 2;
  return im;
}
