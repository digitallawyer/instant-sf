// Street furniture: lamp posts along every street (with pools of light painted on the ground at
// night), traffic signals at mapped junctions that actually cycle, SF's yellow-topped hydrants and
// green litter bins, and Muni stop shelters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared, addHook, useShared } from './fog.js';

const key = (x, z) => x.toFixed(1) + ',' + z.toFixed(1);
function rand(seed) { let s = seed | 0; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; }; }

// Signal timing shared with traffic: which axis has green at a junction. Cycle of 40 s:
// axis 0 green 0-16, amber 16-19, all red 19-20, axis 1 green 20-36, amber 36-39, red 39-40.
export function signalState(t, phase, axis) {
  const c = ((t + phase) % 40 + 40) % 40;
  const local = axis === 0 ? c : (c + 20) % 40;
  return local < 16 ? 'green' : local < 19 ? 'amber' : 'red';
}

function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.07, 0.11, 7.6, 8).translate(0, 3.8, 0);
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.6, 8).translate(0, 0.3, 0);
  const arm = new THREE.CylinderGeometry(0.045, 0.05, 1.9, 6).rotateZ(Math.PI / 2 - 0.12).translate(0.9, 7.55, 0);
  const metal = mergeGeometries([pole, base, arm].map(g => g.toNonIndexed()));
  const head = new THREE.CapsuleGeometry(0.16, 0.5, 4, 8).rotateZ(Math.PI / 2).scale(1, 0.55, 0.9).translate(1.85, 7.62, 0);
  return { metal, head };
}

function signalGeometry() {
  const pole = new THREE.CylinderGeometry(0.08, 0.1, 4.4, 8).translate(0, 2.2, 0);
  const box = new THREE.BoxGeometry(0.36, 1.05, 0.28).translate(0, 3.8, 0.1);
  const visor = [0, 1, 2].map(i => new THREE.CylinderGeometry(0.13, 0.13, 0.2, 10, 1, true, -Math.PI * 0.5, Math.PI).rotateX(Math.PI / 2).translate(0, 4.13 - i * 0.33, 0.33));
  const body = mergeGeometries([pole, box, ...visor].map(g => g.toNonIndexed()));
  // three lenses with a lens id in uv.x (0 red, 1 amber, 2 green)
  const lenses = [0, 1, 2].map(i => {
    const g = new THREE.CircleGeometry(0.11, 14).translate(0, 4.13 - i * 0.33, 0.245);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, i);
    return g;
  });
  return { body, lens: mergeGeometries(lenses) };
}

function hydrantGeometry() {
  const parts = [
    new THREE.CylinderGeometry(0.13, 0.15, 0.55, 12).translate(0, 0.3, 0),
    new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.57, 0),
    new THREE.CylinderGeometry(0.06, 0.06, 0.38, 8).rotateZ(Math.PI / 2).translate(0, 0.42, 0),
    new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12).translate(0, 0.05, 0),
  ];
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}

function binGeometry() {
  return mergeGeometries([
    new THREE.CylinderGeometry(0.3, 0.27, 0.95, 14).translate(0, 0.48, 0),
    new THREE.CylinderGeometry(0.32, 0.32, 0.08, 14).translate(0, 0.98, 0),
  ].map(g => g.toNonIndexed()));
}

function shelterGeometry() {
  const parts = [];
  for (const x of [-1.6, 1.6]) for (const z of [-0.6, 0.6]) parts.push(new THREE.CylinderGeometry(0.04, 0.04, 2.5, 6).translate(x, 1.25, z));
  parts.push(new THREE.BoxGeometry(3.6, 0.08, 1.6).translate(0, 2.55, 0));
  parts.push(new THREE.BoxGeometry(3.2, 0.06, 0.4).translate(0, 0.45, -0.4));
  return mergeGeometries(parts.map(g => g.toNonIndexed()));
}

function instanced(geo, mat, list, castShadow = false) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  list.forEach((it, i) => { q.setFromAxisAngle(up, it.r); m.compose(new THREE.Vector3(it.x, it.y, it.z), q, it.s ? new THREE.Vector3(it.s, it.s, it.s) : one); mesh.setMatrixAt(i, m); });
  mesh.count = list.length;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function createFurniture(map, hf, csm, rect) {
  const rnd = rand(77);
  // ---- junction info
  const nodeRoads = new Map();
  map.roads.forEach(r => {
    if (r.k > 6 || r.br) return;
    for (let i = 0; i < r.p.length; i += 2) {
      const k = key(r.p[i], r.p[i + 1]);
      let l = nodeRoads.get(k); if (!l) nodeRoads.set(k, l = []);
      l.push({ r, i: i / 2 });
    }
  });
  const isJunction = (x, z) => (nodeRoads.get(key(x, z)) || []).length >= 2;

  // ---- lamps along streets
  const lamps = [];
  for (const r of map.roads) {
    if (r.k > 5 || r.br) continue;
    const spacing = r.k <= 2 ? 26 : 32;
    let carry = rnd() * spacing, side = 1;
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const x0 = r.p[i * 2], z0 = r.p[i * 2 + 1], x1 = r.p[i * 2 + 2], z1 = r.p[i * 2 + 3];
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 1e-3) continue;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      for (let d = carry; d < len; d += spacing) {
        // keep clear of junctions
        const nearJ = (d < 9 && isJunction(x0, z0)) || (len - d < 9 && isJunction(x1, z1));
        if (nearJ) continue;
        const off = r.w / 2 + 0.55;
        const x = x0 + dx * d - dz * off * side, z = z0 + dz * d + dx * off * side;
        // pole on the sidewalk, arm reaching over the road
        lamps.push({ x, z, y: hf.at(x, z) + 0.4, r: 0, dx, dz, side });
        side = -side;
      }
      carry = (carry - len) % spacing; if (carry < 0) carry += spacing;
    }
  }
  // orientation: the arm (local +x) must point towards the road centre: direction (dz*side, -dx*side)
  for (const l of lamps) { const ax = l.dz * l.side, az = -l.dx * l.side; l.r = Math.atan2(-az, ax); }

  const { metal, head } = lampGeometry();
  const paint = new THREE.MeshStandardMaterial({ color: 0x3a4044, roughness: 0.55, metalness: 0.6 });
  if (csm) csm.setupMaterial(paint);
  const glow = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, emissive: 0xffc68a });
  glow.name = 'lampglow';
  addHook(glow, sh => {
    useShared(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.05 + uNight * 9.0;');
  });
  const group = new THREE.Group();
  group.add(instanced(metal, paint, lamps));
  group.add(instanced(head, glow, lamps));

  // ---- light pools on the ground: painted once, sampled by the ground shaders at night
  const W = 3072;
  const c = document.createElement('canvas'); c.width = W; c.height = Math.round(W * rect.w / rect.z);
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const sx = c.width / rect.z, sz = c.height / rect.w;
  g.globalCompositeOperation = 'lighter';
  const R = 11 * sx;
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
  grad.addColorStop(0, 'rgba(255,255,255,0.75)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.3)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  for (const l of lamps) {
    const hx = l.x + Math.cos(l.r) * 1.8, hz = l.z - Math.sin(l.r) * 1.8;
    g.setTransform(1, 0, 0, 1, (hx - rect.x) * sx, (hz - rect.y) * sz);
    g.fillRect(-R, -R, R * 2, R * 2);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const lampTex = new THREE.CanvasTexture(c);
  lampTex.flipY = false; lampTex.colorSpace = THREE.NoColorSpace;
  shared.uLamps.value = lampTex;

  // ---- traffic signals at mapped signal nodes
  const signals = [], lensItems = [];
  for (let i = 0; i < map.signals.length; i += 2) {
    const sx0 = map.signals[i], sz0 = map.signals[i + 1];
    const at = nodeRoads.get(key(sx0, sz0));
    if (!at || at.length < 1) continue;
    const phase = rnd() * 40;
    // one head per approach direction
    const approaches = [];
    for (const { r, i: vi } of at) {
      for (const dir of [-1, 1]) {
        const j = vi + dir; if (j < 0 || j >= r.p.length / 2) continue;
        if (r.ow && dir === 1) continue; // one-way: only traffic arriving needs a head
        const dx = r.p[j * 2] - sx0, dz = r.p[j * 2 + 1] - sz0, L = Math.hypot(dx, dz) || 1;
        approaches.push({ ux: dx / L, uz: dz / L, w: r.w });
      }
    }
    // axis: group approaches by direction (0 = first approach's axis, 1 = roughly perpendicular)
    const a0 = approaches[0];
    for (const ap of approaches.slice(0, 4)) {
      const axis = Math.abs(ap.ux * a0.ux + ap.uz * a0.uz) > 0.7 ? 0 : 1;
      // pole on the right-hand corner of the approach, facing oncoming traffic
      const back = ap.w / 2 + 3, side = ap.w / 2 + 1.0;
      const x = sx0 + ap.ux * back - ap.uz * side, z = sz0 + ap.uz * back + ap.ux * side;
      const rot = Math.atan2(ap.ux, ap.uz); // local +z faces along the approach (towards arriving traffic)
      const y = hf.at(x, z) + 0.4;
      signals.push({ x, z, y, r: rot });
      lensItems.push({ x, z, y, r: rot, phase, axis });
    }
  }
  const sig = signalGeometry();
  const sigPaint = new THREE.MeshStandardMaterial({ color: 0x2c3336, roughness: 0.6, metalness: 0.4 });
  if (csm) csm.setupMaterial(sigPaint);
  group.add(instanced(sig.body, sigPaint, signals));
  // lenses: per-instance phase/axis in an attribute; the shader lights the right one
  const lensMesh = instanced(sig.lens, null, lensItems);
  const pa = new Float32Array(lensItems.length * 2);
  lensItems.forEach((l, i) => { pa[i * 2] = l.phase; pa[i * 2 + 1] = l.axis; });
  lensMesh.geometry = sig.lens.clone();
  lensMesh.geometry.setAttribute('aSig', new THREE.InstancedBufferAttribute(pa, 2));
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  lensMat.onBeforeCompile = sh => {
    useShared(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSig;\nvarying vec2 vSig;\nvarying float vLens;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSig = aSig; vLens = uv.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSig;\nvarying float vLens;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
        float c = mod(uTime + vSig.x, 40.0);
        float local = vSig.y < 0.5 ? c : mod(c + 20.0, 40.0);
        float state = local < 16.0 ? 2.0 : local < 19.0 ? 1.0 : 0.0;
        vec3 col = vLens < 0.5 ? vec3(1.0, 0.12, 0.08) : vLens < 1.5 ? vec3(1.0, 0.6, 0.05) : vec3(0.1, 1.0, 0.55);
        float on = abs(vLens - state) < 0.5 ? 1.0 : 0.0;
        vec4 diffuseColor = vec4(col * mix(0.06, 1.0 + uNight * 3.0, on), 1.0);`);
  };
  lensMesh.material = lensMat;
  group.add(lensMesh);

  // ---- hydrants near corners, bins on busier streets
  const hyd = [], bins = [];
  for (const [k, list] of nodeRoads) {
    if (list.length < 2 || rnd() > 0.35) continue;
    const { r, i } = list[0];
    const x0 = r.p[i * 2], z0 = r.p[i * 2 + 1];
    const j = i + 1 < r.p.length / 2 ? i + 1 : i - 1;
    const dx = r.p[j * 2] - x0, dz = r.p[j * 2 + 1] - z0, L = Math.hypot(dx, dz) || 1;
    const off = r.w / 2 + 0.5, back = r.w / 2 + 4 + rnd() * 3, side = rnd() < 0.5 ? 1 : -1;
    const x = x0 + dx / L * back - dz / L * off * side, z = z0 + dz / L * back + dx / L * off * side;
    hyd.push({ x, z, y: hf.at(x, z) + 0.4, r: rnd() * 6 });
    if (r.k <= 3 && rnd() < 0.6) { const bx = x + dx / L * 2, bz = z + dz / L * 2; bins.push({ x: bx, z: bz, y: hf.at(bx, bz) + 0.4, r: 0 }); }
  }
  const hydMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.5, metalness: 0.3 });
  addHook(hydMat, sh => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vHy;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHy = position.y;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vHy;').replace('#include <color_fragment>', '#include <color_fragment>\nif (vHy > 0.5) diffuseColor.rgb = vec3(0.85, 0.65, 0.08);'); });
  if (csm) csm.setupMaterial(hydMat);
  group.add(instanced(hydrantGeometry(), hydMat, hyd));
  const binMat = new THREE.MeshStandardMaterial({ color: 0x2f5a3c, roughness: 0.6, metalness: 0.2 });
  if (csm) csm.setupMaterial(binMat);
  group.add(instanced(binGeometry(), binMat, bins));

  // ---- Muni stops
  const shelters = [];
  for (let i = 0; i < map.stops.length; i += 2) {
    const x = map.stops[i], z = map.stops[i + 1];
    // face the nearest road
    let best = null, bd = 30;
    for (const r of map.roads) { if (r.k > 5) continue; for (let k = 0; k < r.p.length / 2 - 1; k++) { const ax = r.p[k * 2], az = r.p[k * 2 + 1]; if (Math.abs(ax - x) > 40 || Math.abs(az - z) > 40) continue; const bx = r.p[k * 2 + 2], bz = r.p[k * 2 + 3]; const ddx = bx - ax, ddz = bz - az, LL = ddx * ddx + ddz * ddz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * ddx + (z - az) * ddz) / LL)); const d = Math.hypot(x - ax - ddx * t, z - az - ddz * t); if (d < bd) { bd = d; best = { ddx, ddz, r }; } } }
    if (!best || shelters.length > 1500) continue;
    shelters.push({ x, z, y: hf.at(x, z) + 0.4, r: Math.atan2(best.ddz, best.ddx) * -1 });
  }
  const shMat = new THREE.MeshStandardMaterial({ color: 0x9aa3a8, roughness: 0.35, metalness: 0.7 });
  if (csm) csm.setupMaterial(shMat);
  group.add(instanced(shelterGeometry(), shMat, shelters, true));

  group.userData.counts = { lamps: lamps.length, signals: signals.length, hydrants: hyd.length, shelters: shelters.length };
  return group;
}
