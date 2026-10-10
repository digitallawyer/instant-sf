// Pedestrians on the sidewalks (busier downtown), instanced, with the walk cycle done in the vertex
// shader; they step aside for the player. Plus the city's other residents: the sea lions hauled out
// on Pier 39's docks, gulls wheeling over the waterfront and sailboats out on the Bay.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addHook, useShared } from '../engine/fog.js';
import { project } from '../city/region.js';

// ---------- pedestrian model: parts tagged with a limb id for the shader
function personGeometry() {
  const parts = [];
  const add = (g, limb, tone) => {
    g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    const n = g.attributes.position.count;
    g.setAttribute('aLimb', new THREE.Float32BufferAttribute(new Float32Array(n).fill(limb), 1));
    g.setAttribute('aTone', new THREE.Float32BufferAttribute(new Float32Array(n).fill(tone), 1));
    parts.push(g);
  };
  // tone: 0 skin, 1 top (instance colour), 2 trousers, 3 hair, 4 shoes
  add(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10).scale(1.1, 1, 0.7).translate(0, 1.22, 0), 0, 1);
  add(new THREE.SphereGeometry(0.11, 12, 10).translate(0, 1.66, 0.01), 0, 0);
  add(new THREE.SphereGeometry(0.115, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.67, -0.005), 0, 3);
  add(new THREE.SphereGeometry(0.16, 10, 8).scale(1.1, 0.6, 0.8).translate(0, 0.93, 0), 0, 2);
  for (const s of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.065, 0.74, 4, 8).translate(s * 0.09, 0.5, 0), s < 0 ? 1 : 2, 2);
    add(new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(s * 0.09, 0.04, 0.05), s < 0 ? 1 : 2, 4);
    add(new THREE.CapsuleGeometry(0.045, 0.5, 4, 8).translate(s * 0.22, 1.12, 0), s < 0 ? 3 : 4, 1);
  }
  return mergeGeometries(parts);
}

function peopleMaterial(csm) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  mat.name = 'people';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, sh => {
    useShared(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLimb;\nattribute float aTone;\nattribute vec2 aWalk;\nvarying float vTone;\nvarying float vSeed;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vTone = aTone;
        #ifdef USE_INSTANCING
          float ph = aWalk.x, amp = aWalk.y;
          vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071);
        #else
          float ph = 0.0, amp = 0.0; vSeed = 0.0;
        #endif
        float sw = sin(ph) * 0.5 * amp;
        if (aLimb > 0.5 && aLimb < 2.5) { // legs swing about the hip
          float a = aLimb < 1.5 ? sw : -sw;
          vec3 p = transformed - vec3(0.0, 0.92, 0.0);
          transformed = vec3(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a)) + vec3(0.0, 0.92, 0.0);
        } else if (aLimb > 2.5) { // arms swing opposite, about the shoulder
          float a = (aLimb < 3.5 ? -sw : sw) * 0.8;
          vec3 p = transformed - vec3(0.0, 1.42, 0.0);
          transformed = vec3(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a)) + vec3(0.0, 1.42, 0.0);
        }
        transformed.y += abs(cos(ph)) * 0.03 * amp;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTone;\nvarying float vSeed;')
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        int t = int(vTone + 0.5);
        vec3 skin = mix(mix(vec3(0.95, 0.76, 0.62), vec3(0.62, 0.42, 0.3), smoothstep(0.0, 0.6, vSeed)), vec3(0.34, 0.22, 0.15), smoothstep(0.6, 1.0, vSeed));
        if (t == 0) diffuseColor.rgb = skin;
        else if (t == 2) diffuseColor.rgb = mix(vec3(0.1, 0.12, 0.18), vec3(0.35, 0.32, 0.28), step(0.6, fract(vSeed * 7.3)));
        else if (t == 3) diffuseColor.rgb = mix(vec3(0.06, 0.04, 0.03), vec3(0.45, 0.32, 0.18), step(0.7, fract(vSeed * 3.1)));
        else if (t == 4) diffuseColor.rgb = mix(vec3(0.9), vec3(0.08), step(0.5, fract(vSeed * 5.7)));
      `);
  });
  return mat;
}

const TOPS = [0x1d2733, 0xb8b2a7, 0x7a1f24, 0x2f5a4a, 0xd6a12b, 0x2e5f8a, 0xe5532d, 0x404448, 0xe9e6e1, 0x5b3d6b, 0x8a6d4e];

export function createPeople(map, hf, csm, graph) {
  const segs = graph.segs.filter(s => !s.ys);
  const weights = segs.map(s => (s.k <= 3 ? 4 : s.k === 4 ? 2 : 1) * s.len);
  const total = weights.reduce((a, b) => a + b, 0);
  const pickSeg = () => { let r = Math.random() * total; for (let i = 0; i < segs.length; i++) if ((r -= weights[i]) <= 0) return segs[i]; return segs[0]; };
  const MAX = 460, R = 230;
  const geo = personGeometry();
  const walk = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
  geo.setAttribute('aWalk', walk);
  const mesh = new THREE.InstancedMesh(geo, peopleMaterial(csm), MAX);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
  const peds = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), V = new THREE.Vector3(), col = new THREE.Color();
  const sc = new THREE.Vector3();

  function pos(p) {
    const s = p.seg, { pts, cum } = s;
    let i = p.i || 0;
    if (cum[i] > p.d) i = 0;
    while (i < cum.length - 2 && cum[i + 1] < p.d) i++;
    p.i = i;
    const L = cum[i + 1] - cum[i] || 1, t = Math.min(1, Math.max(0, (p.d - cum[i]) / L));
    const dx = (pts[i * 2 + 2] - pts[i * 2]) / L, dz = (pts[i * 2 + 3] - pts[i * 2 + 1]) / L;
    const off = (s.w / 2 + 1.1 + p.lat) * p.side;
    p.x = pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t - dz * off + p.dodge * -dz;
    p.z = pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t + dx * off + p.dodge * dx;
    p.dx = dx; p.dz = dz;
  }
  function spawn(cx, cz, rMin) {
    for (let k = 0; k < 30; k++) {
      const s = pickSeg();
      const m = Math.floor(s.pts.length / 4) * 2;
      const dd = Math.hypot(s.pts[m] - cx, s.pts[m + 1] - cz);
      if (dd > R || dd < rMin) continue;
      const p = { seg: s, d: Math.random() * s.len, v: 1.1 + Math.random() * 0.6, side: s.ow && Math.random() < 0.5 ? -1 : 1, lat: Math.random() * 1.2, ph: Math.random() * 6, color: TOPS[Math.floor(Math.random() * TOPS.length)], dodge: 0, h: 0.92 + Math.random() * 0.16, pause: 0 };
      pos(p);
      peds.push(p);
      return;
    }
  }
  let init = false;
  return {
    group: mesh, peds,
    update(dt, focus, player) {
      if (!init) { for (let i = 0; i < 400; i++) spawn(focus.x, focus.z, 0); init = true; }
      for (let i = peds.length - 1; i >= 0; i--) if (Math.hypot(peds[i].x - focus.x, peds[i].z - focus.z) > R + 60) peds.splice(i, 1);
      for (let n = 0; n < 8 && peds.length < 400; n++) spawn(focus.x, focus.z, 110);
      let i = 0;
      for (const p of peds) {
        // step aside for the player
        let target = 0, slow = 1;
        if (player) {
          const rx = player.pos.x - p.x, rz = player.pos.z - p.z, d = Math.hypot(rx, rz);
          if (d < 4) { const lat = -rx * p.dz + rz * p.dx; target = lat > 0 ? -1.4 : 1.4; if (d < 1.4) slow = 0; }
        }
        p.dodge += (target - p.dodge) * Math.min(1, dt * 4);
        if (p.pause > 0) { p.pause -= dt; slow = 0; }
        else if (Math.random() < dt * 0.01) p.pause = 2 + Math.random() * 6; // stop to look at a phone
        const v = p.v * slow;
        p.d += v * dt;
        p.ph += v * dt * 4.2;
        if (p.d > p.seg.len) {
          const opts = p.seg.out.length ? p.seg.out : (p.seg.rev ? [p.seg.rev] : []);
          if (!opts.length) { p.d = p.seg.len; p.v = -p.v; }
          else { p.seg = opts[Math.floor(Math.random() * opts.length)]; p.d = 0; p.i = 0; if (p.seg.ys) { p.seg = p.seg.rev || p.seg; } }
        }
        if (p.d < 0) p.d = 0, p.v = Math.abs(p.v);
        pos(p);
        if (i >= MAX) continue;
        const y = hf.at(p.x, p.z) + 0.42;
        q.setFromAxisAngle(up, Math.atan2(p.dx, p.dz));
        m4.compose(V.set(p.x, y, p.z), q, sc.set(p.h, p.h, p.h));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col.setHex(p.color));
        walk.array[i * 2] = p.ph; walk.array[i * 2 + 1] = slow > 0 ? 1 : 0;
        i++;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; walk.needsUpdate = true;
    },
  };
}

// ---------- critters
function sealGeometry() {
  const prof = [[0, -1.0], [0.06, -0.95], [0.15, -0.75], [0.24, -0.5], [0.31, -0.2], [0.33, 0.05], [0.29, 0.3], [0.2, 0.5], [0.14, 0.62], [0.11, 0.72], [0.08, 0.8], [0, 0.84]];
  const body = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 16).rotateX(Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.25, 0);
  const flippers = [-1, 1].map(s => new THREE.SphereGeometry(0.15, 8, 6).scale(1.3, 0.15, 0.5).translate(s * 0.3, 0.06, 0.3));
  const tail = new THREE.SphereGeometry(0.13, 8, 6).scale(1.4, 0.15, 0.9).translate(0, 0.06, -0.95);
  return mergeGeometries([body, ...flippers, tail].map(g => { g = g.toNonIndexed(); g.deleteAttribute('uv'); return g; }));
}

export function createCritters(map, hf, csm) {
  const group = new THREE.Group();
  // Pier 39 K-dock: floating docks with sea lions sprawled over them
  const [kx, kz] = project(37.80885, -122.41035);
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.9 });
  if (csm) csm.setupMaterial(dockMat);
  const docks = [];
  for (let i = 0; i < 9; i++) docks.push({ x: kx + (i % 3) * 9 - 9, z: kz + Math.floor(i / 3) * 6 - 6, r: (Math.random() - 0.5) * 0.2 });
  for (const d of docks) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.4, 4.2), dockMat);
    m.position.set(d.x, 0.15, d.z); m.rotation.y = d.r; m.receiveShadow = true; m.castShadow = true;
    group.add(m);
  }
  const sealMat = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.35, metalness: 0.05 });
  if (csm) csm.setupMaterial(sealMat);
  const seals = new THREE.InstancedMesh(sealGeometry(), sealMat, 60);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const sealData = [];
  for (let i = 0; i < 60; i++) {
    const d = docks[i % docks.length];
    sealData.push({ x: d.x + (Math.random() - 0.5) * 6, z: d.z + (Math.random() - 0.5) * 3.2, yaw: Math.random() * 6.28, roll: Math.random() < 0.3 ? 1.3 : 0, s: 0.8 + Math.random() * 0.5, ph: Math.random() * 6 });
  }
  seals.castShadow = true; seals.receiveShadow = true;
  group.add(seals);

  // gulls: little V shapes circling over the waterfront
  const gullGeo = new THREE.BufferGeometry();
  gullGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.15, -0.6, 0.1, -0.05, 0, 0, -0.1, 0, 0, 0.15, 0, 0, -0.1, 0.6, 0.1, -0.05], 3));
  gullGeo.computeVertexNormals();
  const gulls = new THREE.InstancedMesh(gullGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide, roughness: 0.8 }), 40);
  gulls.frustumCulled = false;
  const gullData = [];
  const centres = [[37.8087, -122.4104], [37.8080, -122.4170], [37.7955, -122.3920], [37.8060, -122.4320], [37.8050, -122.4640]];
  for (let i = 0; i < 40; i++) { const c = centres[i % centres.length]; const [x, z] = project(c[0], c[1]); gullData.push({ x, z, r: 20 + Math.random() * 60, y: 15 + Math.random() * 35, w: (0.15 + Math.random() * 0.2) * (Math.random() < 0.5 ? 1 : -1), a: Math.random() * 6.28, f: Math.random() * 6 }); }
  group.add(gulls);

  // sailboats tacking around the Bay
  const sailGeo = (() => {
    const hull = new THREE.CylinderGeometry(0.01, 1.1, 8, 8, 1).rotateX(Math.PI / 2).scale(1, 0.4, 1).translate(0, 0.25, 0);
    const mast = new THREE.CylinderGeometry(0.06, 0.06, 11, 5).translate(0, 5.8, 0.6);
    const sail = new THREE.BufferGeometry(); sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, 0.7, 0, 11, 0.7, 0, 1.2, -3.2, 0, 1.2, 0.9, 0, 9, 3.8, 0, 1.2, 3.8], 3));
    return mergeGeometries([hull.toNonIndexed(), mast.toNonIndexed(), sail].map(g => { for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); return g; }));
  })();
  sailGeo.computeVertexNormals();
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.6, side: THREE.DoubleSide });
  if (csm) csm.setupMaterial(sailMat);
  const boats = new THREE.InstancedMesh(sailGeo, sailMat, 14);
  boats.castShadow = true; boats.frustumCulled = false;
  const boatData = [];
  for (let i = 0; i < 14; i++) { const [x, z] = project(37.815 + Math.random() * 0.012, -122.47 + Math.random() * 0.08); boatData.push({ x, z, h: Math.random() * 6.28, v: 2 + Math.random() * 2, turn: 0 }); }
  group.add(boats);

  let t = 0;
  return {
    group,
    update(dt) {
      t += dt;
      sealData.forEach((s, i) => {
        // mostly napping; now and then a head comes up
        const nod = Math.max(0, Math.sin(t * 0.4 + s.ph * 3)) ** 8 * 0.5;
        e.set(-nod, s.yaw, s.roll); q.setFromEuler(e);
        m4.compose(V.set(s.x, 0.35, s.z), q, S.setScalar(s.s));
        seals.setMatrixAt(i, m4);
      });
      seals.instanceMatrix.needsUpdate = true;
      gullData.forEach((g, i) => {
        g.a += g.w * dt;
        const x = g.x + Math.cos(g.a) * g.r, z = g.z + Math.sin(g.a) * g.r, y = g.y + Math.sin(t * 0.3 + g.f) * 4;
        const flap = Math.sin(t * 7 + g.f) * 0.4;
        e.set(0, -g.a + (g.w > 0 ? 0 : Math.PI), flap * 0.2); q.setFromEuler(e);
        m4.compose(V.set(x, y, z), q, S.set(1, 1 + flap, 1));
        gulls.setMatrixAt(i, m4);
      });
      gulls.instanceMatrix.needsUpdate = true;
      boatData.forEach((b, i) => {
        b.turn -= dt;
        if (b.turn < 0) { b.turn = 20 + Math.random() * 40; b.target = b.h + (Math.random() < 0.5 ? 1.6 : -1.6); }
        if (b.target !== undefined) b.h += (b.target - b.h) * Math.min(1, dt * 0.3);
        b.x += Math.sin(b.h) * b.v * dt; b.z += Math.cos(b.h) * b.v * dt;
        if (hf.inside(b.x, b.z) && hf.at(b.x, b.z) > -2) { b.h += Math.PI; b.target = b.h; }
        e.set(Math.sin(t + i) * 0.03, b.h, 0.18 * Math.sign(Math.sin(b.h * 3 + i))); q.setFromEuler(e);
        m4.compose(V.set(b.x, 0, b.z), q, S.setScalar(1));
        boats.setMatrixAt(i, m4);
      });
      boats.instanceMatrix.needsUpdate = true;
    },
  };
}
