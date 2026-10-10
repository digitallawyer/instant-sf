// Vehicle models, built from extruded side profiles so they have real silhouettes. Each model is a
// single merged geometry with a per-vertex "part" code the shader uses for paint, glass, chrome,
// rubber and lamps; the paint colour comes from the instance colour.
// All models face +z, sit on y = 0, and are centred on their wheelbase.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addHook, useShared } from '../engine/fog.js';

// part codes
export const P = { PAINT: 0, GLASS: 1, DARK: 2, CHROME: 3, HEAD: 4, TAIL: 5, TRIM: 6, WOOD: 7, GOLD: 8, CREAM: 9 };

function tag(g, part) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
  return g;
}
// side profile in (z = length, y = height) extruded across x
function profile(points, width, part, bevel = 0.06) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape z -> world z, extrusion -> world x
  return tag(g, part);
}
const box = (w, h, d, x, y, z, part) => tag(new THREE.BoxGeometry(w, h, d).translate(x, y, z), part);
const cyl = (r, len, x, y, z, part, axis = 'x', seg = 14) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  return tag(g.translate(x, y, z), part);
};
function wheels(track, base, r = 0.33, width = 0.24, extra = []) {
  const out = [];
  for (const z of [-base / 2, base / 2, ...extra]) for (const s of [-1, 1]) {
    out.push(cyl(r, width, s * track / 2, r, z, P.DARK));
    out.push(cyl(r * 0.6, width + 0.02, s * track / 2, r, z, P.CHROME));
  }
  return out;
}

function sedan() {
  const W = 1.8;
  const body = profile([[-2.3, 0.3], [2.3, 0.3], [2.35, 0.55], [2.25, 0.82], [1.2, 0.92], [-1.9, 0.95], [-2.3, 0.86]], W, P.PAINT, 0.07);
  const cabin = profile([[1.15, 0.9], [0.45, 1.38], [-1.0, 1.4], [-1.75, 0.95]], W - 0.18, P.GLASS, 0.03);
  const roof = profile([[0.4, 1.37], [-0.95, 1.39], [-0.9, 1.44], [0.35, 1.42]], W - 0.24, P.PAINT, 0.02);
  return mergeGeometries([body, cabin, roof, ...wheels(1.56, 2.7, 0.32),
    box(0.35, 0.1, 0.04, -0.6, 0.72, 2.33, P.HEAD), box(0.35, 0.1, 0.04, 0.6, 0.72, 2.33, P.HEAD),
    box(0.4, 0.1, 0.04, -0.6, 0.78, -2.31, P.TAIL), box(0.4, 0.1, 0.04, 0.6, 0.78, -2.31, P.TAIL),
    box(1.5, 0.12, 0.06, 0, 0.36, 2.34, P.DARK), box(1.5, 0.12, 0.06, 0, 0.36, -2.33, P.DARK)]);
}
function suv() {
  const W = 1.92;
  const body = profile([[-2.35, 0.38], [2.35, 0.38], [2.4, 0.7], [2.25, 1.0], [1.3, 1.08], [-2.3, 1.1], [-2.38, 0.95]], W, P.PAINT, 0.08);
  const cabin = profile([[1.25, 1.06], [0.6, 1.62], [-2.2, 1.64], [-2.28, 1.08]], W - 0.16, P.GLASS, 0.03);
  const roof = profile([[0.55, 1.6], [-2.15, 1.62], [-2.1, 1.7], [0.5, 1.68]], W - 0.2, P.PAINT, 0.02);
  return mergeGeometries([body, cabin, roof, ...wheels(1.64, 2.85, 0.37, 0.27),
    box(0.35, 0.12, 0.04, -0.65, 0.86, 2.4, P.HEAD), box(0.35, 0.12, 0.04, 0.65, 0.86, 2.4, P.HEAD),
    box(0.3, 0.22, 0.04, -0.75, 1.0, -2.36, P.TAIL), box(0.3, 0.22, 0.04, 0.75, 1.0, -2.36, P.TAIL)]);
}
function taxi() {
  const g = sedan();
  const sign = box(0.7, 0.18, 0.22, 0, 1.53, -0.2, P.HEAD);
  return mergeGeometries([g, sign]);
}
function van() {
  const W = 2.0;
  const body = profile([[-2.6, 0.35], [2.6, 0.35], [2.65, 0.75], [2.5, 1.05], [1.9, 1.95], [-2.6, 2.05]], W, P.PAINT, 0.08);
  const ws = profile([[2.45, 1.08], [1.92, 1.9], [1.7, 1.9], [2.2, 1.08]], W - 0.1, P.GLASS, 0.02);
  return mergeGeometries([body, ws, ...wheels(1.7, 3.3, 0.36, 0.26),
    box(0.3, 0.12, 0.04, -0.7, 0.85, 2.65, P.HEAD), box(0.3, 0.12, 0.04, 0.7, 0.85, 2.65, P.HEAD),
    box(0.25, 0.3, 0.04, -0.85, 1.1, -2.61, P.TAIL), box(0.25, 0.3, 0.04, 0.85, 1.1, -2.61, P.TAIL)]);
}
function bus() {
  const W = 2.55, L = 12;
  const body = profile([[-L / 2, 0.45], [L / 2, 0.45], [L / 2 + 0.05, 2.9], [-L / 2, 2.95]], W, P.PAINT, 0.12);
  const band = box(W + 0.02, 1.1, L - 1.4, 0, 1.95, -0.3, P.GLASS);
  const ws = box(W - 0.2, 1.5, 0.06, 0, 1.85, L / 2 + 0.06, P.GLASS);
  const skirt = box(W + 0.03, 0.35, L - 0.2, 0, 0.75, 0, P.TRIM);
  const poles = [-0.35, 0.35].map(x => tag(new THREE.CylinderGeometry(0.025, 0.025, 5.6, 5).rotateX(-1.25).translate(x, 3.85, -3.4), P.DARK));
  return mergeGeometries([body, band, ws, skirt, box(1.6, 0.25, 1.4, 0, 3.05, -1, P.DARK), ...poles, ...wheels(2.2, 6.4, 0.5, 0.3),
    box(0.35, 0.15, 0.04, -0.9, 0.9, L / 2 + 0.06, P.HEAD), box(0.35, 0.15, 0.04, 0.9, 0.9, L / 2 + 0.06, P.HEAD),
    box(0.25, 0.4, 0.04, -1.05, 1.0, -L / 2 - 0.02, P.TAIL), box(0.25, 0.4, 0.04, 1.05, 1.0, -L / 2 - 0.02, P.TAIL)]);
}

// The San Francisco cable car: closed centre saloon with windows, open grip sections at the ends with
// outward-facing benches, running boards, brass poles, clerestory roof.
export function cableCar() {
  const W = 2.44, L = 8.4;
  const parts = [];
  // underframe + running boards
  parts.push(box(W - 0.2, 0.35, L, 0, 0.62, 0, P.DARK));
  parts.push(box(W + 0.5, 0.06, L - 1.4, 0, 0.62, 0, P.WOOD));
  // closed saloon in the middle: maroon lower, cream window band
  parts.push(box(W, 0.95, 4.2, 0, 1.28, 0, P.PAINT));
  for (let i = 0; i < 5; i++) {
    const z = -1.7 + i * 0.85;
    parts.push(box(W + 0.02, 0.85, 0.6, 0, 2.2, z, P.GLASS));
  }
  parts.push(box(W, 0.95, 4.2, 0, 2.2, 0, P.CREAM));
  parts.push(box(W + 0.03, 0.08, 4.25, 0, 1.78, 0, P.GOLD));
  // open ends: low side panels, benches facing out, brass poles
  for (const s of [-1, 1]) {
    const zc = s * 3.15;
    parts.push(box(W, 0.4, 2.1, 0, 1.0, zc, P.PAINT));
    parts.push(box(0.5, 0.08, 2.0, -W / 2 + 0.25, 1.22, zc, P.WOOD), box(0.5, 0.08, 2.0, W / 2 - 0.25, 1.22, zc, P.WOOD));
    parts.push(box(0.08, 0.5, 2.0, -0.2, 1.5, zc, P.WOOD), box(0.08, 0.5, 2.0, 0.2, 1.5, zc, P.WOOD));
    for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) for (const dz of [-0.95, 0, 0.95]) parts.push(cyl(0.03, 1.6, x, 2.0, zc + dz, P.GOLD, 'y', 6));
    // end bulkhead with the destination sign
    parts.push(box(W, 1.2, 0.12, 0, 2.1, s * (L / 2 - 0.06), P.CREAM));
    parts.push(box(1.5, 0.32, 0.04, 0, 2.95, s * (L / 2 - 0.01), P.HEAD));
    parts.push(box(0.4, 0.4, 0.06, 0, 1.15, s * (L / 2 + 0.02), P.HEAD));
  }
  // roof with clerestory
  parts.push(box(W + 0.3, 0.12, L + 0.2, 0, 2.86, 0, P.CREAM));
  parts.push(box(1.1, 0.25, L - 1.5, 0, 3.02, 0, P.CREAM));
  parts.push(box(1.12, 0.12, L - 1.45, 0, 2.95, 0, P.GLASS));
  parts.push(...wheels(1.1, 4.2, 0.3, 0.12, [-2.6, 2.6]).slice(0, 4), ...wheels(1.1, 6.0, 0.3, 0.12));
  return mergeGeometries(parts);
}

// PCC streetcar (the F-line's historic fleet)
function streetcar() {
  const W = 2.6, L = 14.2;
  const body = profile([[-L / 2, 0.55], [L / 2 - 1.2, 0.55], [L / 2, 1.0], [L / 2, 2.4], [L / 2 - 1.0, 3.15], [-L / 2 + 1.0, 3.15], [-L / 2, 2.4], [-L / 2, 1.0], [-L / 2 + 1.2, 0.55]], W, P.PAINT, 0.14);
  const band = box(W + 0.03, 0.85, L - 2.6, 0, 2.05, 0, P.GLASS);
  const cream = box(W + 0.02, 0.5, L - 1.2, 0, 1.3, 0, P.CREAM);
  const pole = tag(new THREE.CylinderGeometry(0.03, 0.03, 5.5, 5).rotateX(-1.2).translate(0, 4.2, -3.2), P.DARK);
  return mergeGeometries([body, band, cream, pole, ...wheels(1.8, 8.0, 0.36, 0.2),
    box(0.4, 0.4, 0.04, 0, 1.4, L / 2 + 0.03, P.HEAD), box(1.6, 0.3, 0.04, 0, 2.85, L / 2 - 0.55, P.HEAD)]);
}

export const MODELS = {
  sedan: { geo: sedan, len: 4.7, colors: [0xe7e7e3, 0x16181b, 0x9ba1a6, 0x3d4a5c, 0x7a1f1f, 0xb7b4a8, 0x2a3d33, 0x5e6a73, 0xd9d4c6, 0x1d2a44] },
  suv: { geo: suv, len: 4.8, colors: [0x101214, 0xf0f0ec, 0x6e7378, 0x2b3a4a, 0x52463a, 0x8e9396] },
  taxi: { geo: taxi, len: 4.7, colors: [0xe8b318] },
  van: { geo: van, len: 5.3, colors: [0xf2f2ee, 0xe6e4dc, 0x3c5a7a] },
  bus: { geo: bus, len: 12.2, colors: [0xc8c4bb] },
  cablecar: { geo: cableCar, len: 8.6, colors: [0x6e1a1c] },
  streetcar: { geo: streetcar, len: 14.4, colors: [0x2f6b4f, 0xd8783a, 0xa83a32, 0xd6a12b, 0x3a6e9c] },
};

const geoCache = new Map();
export function modelGeometry(name) {
  if (!geoCache.has(name)) geoCache.set(name, MODELS[name].geo());
  return geoCache.get(name);
}

// One material for every vehicle: parts decide finish; instance colour is the paint.
export function vehicleMaterial(csm) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 });
  mat.name = 'vehicles';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, sh => {
    useShared(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;\nattribute float aBrake;\nvarying float vBrake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;\n#ifdef USE_INSTANCING\nvBrake = aBrake;\n#else\nvBrake = 0.0;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;\nvarying float vBrake;\nfloat vR; float vM; vec3 vE;')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        vR = 0.28; vM = 0.08; vE = vec3(0.0);
        int part = int(vPart + 0.5);
        if (part == 1) { diffuseColor.rgb = vec3(0.02, 0.025, 0.03); vR = 0.04; vM = 0.0; }
        else if (part == 2) { diffuseColor.rgb = vec3(0.025); vR = 0.85; vM = 0.0; }
        else if (part == 3) { diffuseColor.rgb = vec3(0.75); vR = 0.2; vM = 1.0; }
        else if (part == 4) { diffuseColor.rgb = vec3(0.9); vR = 0.1; vM = 0.0; vE = vec3(1.0, 0.92, 0.75) * (0.2 + uNight * 6.0); }
        else if (part == 5) { diffuseColor.rgb = vec3(0.4, 0.02, 0.02); vR = 0.2; vM = 0.0; vE = vec3(1.0, 0.04, 0.02) * (0.15 + uNight * 2.5 + vBrake * 4.0); }
        else if (part == 6) { diffuseColor.rgb = vec3(0.75, 0.12, 0.1); vR = 0.4; vM = 0.2; }
        else if (part == 7) { diffuseColor.rgb = vec3(0.36, 0.22, 0.12); vR = 0.6; vM = 0.0; }
        else if (part == 8) { diffuseColor.rgb = vec3(0.8, 0.6, 0.25); vR = 0.25; vM = 1.0; }
        else if (part == 9) { diffuseColor.rgb = vec3(0.86, 0.8, 0.66); vR = 0.5; vM = 0.0; }
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vM;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vE;');
  });
  return mat;
}

// An InstancedMesh pool for one model, with per-instance colour and brake-light attribute.
export function vehiclePool(name, mat, max) {
  const geo = modelGeometry(name).clone();
  const brake = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
  geo.setAttribute('aBrake', brake);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
  mesh.count = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.brake = brake;
  return mesh;
}
