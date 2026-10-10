// Trees: the mapped street trees, forests scattered through wooded areas (the Presidio's cypress and
// eucalyptus groves) and a sprinkling in parks. Near the camera they are leaf-card crowns with a
// branching trunk; further out, cheap rounded blobs. The split is re-done as the camera moves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addHook, useShared } from './fog.js';

const NEAR = 260;

function rand(seed) { let s = seed | 0; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 100000) / 100000; }; }

function leafTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const rnd = rand(kind === 'conifer' ? 7 : 3);
  for (let i = 0; i < (kind === 'conifer' ? 900 : 520); i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 118;
    const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const l = 30 + rnd() * 34;
    g.fillStyle = `hsl(${kind === 'conifer' ? 100 + rnd() * 30 : 75 + rnd() * 35}, ${35 + rnd() * 25}%, ${l}%)`;
    g.beginPath();
    if (kind === 'conifer') g.ellipse(x, y, 1.4, 7 + rnd() * 5, a + rnd(), 0, Math.PI * 2);
    else g.ellipse(x, y, 4 + rnd() * 3, 7 + rnd() * 4, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function trunkGeo(rnd, height, r0, branches) {
  const parts = [new THREE.CylinderGeometry(r0 * 0.6, r0, height, 6, 1, true).translate(0, height / 2, 0)];
  for (let i = 0; i < branches; i++) {
    const len = height * (0.45 + rnd() * 0.3), b = new THREE.CylinderGeometry(r0 * 0.25, r0 * 0.45, len, 5, 1, true).translate(0, len / 2, 0);
    b.rotateZ(0.5 + rnd() * 0.5); b.rotateY(rnd() * Math.PI * 2); b.translate(0, height * (0.6 + rnd() * 0.3), 0);
    parts.push(b);
  }
  const g = mergeGeometries(parts.map(p => p.toNonIndexed()));
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.002), 2)); // a bark-coloured corner of the leaf texture
  g.setAttribute('aBark', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  return g;
}

// A crown of leaf cards scattered through an ellipsoid; normals point out from the crown centre so the
// crown shades as one soft volume.
function cardCrown(rnd, cx, cy, cz, rx, ry, cards, size) {
  const pos = [], nrm = [], uv = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < cards; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = Math.cbrt(0.25 + 0.75 * rnd());
    const s = Math.sqrt(1 - u * u);
    const px = cx + Math.cos(th) * s * rx * rr, py = cy + u * ry * rr, pz = cz + Math.sin(th) * s * rx * rr;
    e.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI); q.setFromEuler(e);
    const sz = size * (0.75 + rnd() * 0.5);
    const verts = corners.map(([a, b]) => new THREE.Vector3(a * sz, b * sz, 0).applyQuaternion(q).add(new THREE.Vector3(px, py, pz)));
    const order = [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const v = verts[k];
      pos.push(v.x, v.y, v.z);
      const nn = new THREE.Vector3(v.x - cx, (v.y - cy) * 1.2, v.z - cz).normalize();
      nrm.push(nn.x, nn.y, nn.z);
      uv.push((corners[k][0] + 1) / 2, (corners[k][1] + 1) / 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aBark', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  return g;
}

function blobCrown(cx, cy, cz, rx, ry, rnd) {
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const k = 0.85 + rnd() * 0.3;
    p.setXYZ(i, cx + v.x * rx * k, cy + v.y * ry * k, cz + v.z * rx * k);
    n.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  const cnt = p.count;
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cnt * 2).fill(0.5), 2));
  g.setAttribute('aBark', new THREE.BufferAttribute(new Float32Array(cnt), 1));
  return g;
}

function protos() {
  const r = rand(11);
  const broadNear = mergeGeometries([trunkGeo(r, 4.2, 0.24, 3), cardCrown(r, 0, 5.4, 0, 2.6, 2.2, 46, 0.95), cardCrown(r, 0.6, 6.6, -0.4, 1.8, 1.5, 18, 0.85)]);
  const r2 = rand(11);
  const broadFar = mergeGeometries([trunkGeo(r2, 4.2, 0.24, 0), blobCrown(0, 5.6, 0, 2.6, 2.3, r2)]);
  const r3 = rand(23);
  const conNear = mergeGeometries([trunkGeo(r3, 7, 0.32, 3), cardCrown(r3, 0, 7.5, 0, 3.0, 1.6, 34, 1.1), cardCrown(r3, -0.5, 9.4, 0.3, 2.6, 1.3, 26, 1.0), cardCrown(r3, 0.4, 11.0, 0, 1.8, 1.0, 14, 0.9)]);
  const r4 = rand(23);
  const conFar = mergeGeometries([trunkGeo(r4, 7, 0.32, 0), blobCrown(0, 9.0, 0, 3.0, 2.8, r4)]);
  return { broad: [broadNear, broadFar], conifer: [conNear, conFar] };
}

function treeMaterial(csm, map, leafTint) {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  mat.name = 'trees';
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBark;\nvarying float vBark;\nvarying float vH;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        vBark = aBark; vH = position.y;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float sway = max(0.0, transformed.y - 3.0) * 0.022;
          transformed.x += sin(uTime * 1.3 + ip.x * 0.15 + ip.z * 0.1) * sway;
          transformed.z += cos(uTime * 1.1 + ip.z * 0.13) * sway * 0.6;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBark;\nvarying float vH;')
      .replace('#include <alphatest_fragment>', /* glsl */`
        // keep leaf coverage as the texture mips down, so distant crowns don't thin out to bare sticks
        { vec2 dx = dFdx(vMapUv * 256.0), dy = dFdy(vMapUv * 256.0);
          float lod = 0.5 * log2(max(dot(dx, dx), dot(dy, dy)));
          diffuseColor.a *= 1.0 + max(0.0, lod) * 0.45; }
        #include <alphatest_fragment>`)
      .replace('#include <map_fragment>', /* glsl */`
        #include <map_fragment>
        if (vBark > 0.5) diffuseColor = vec4(0.24, 0.19, 0.14, 1.0);
        else {
          // inner leaves darker (self shadowing), tips lighter
          diffuseColor.rgb *= 0.65 + 0.45 * clamp(vNormal.y * 0.5 + 0.5, 0.0, 1.0);
          #ifdef USE_INSTANCING_COLOR
          #endif
        }`);
  });
  return mat;
}

function insidePoly(x, z, p) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }

export function createTrees(map, hf, csm, { density = 1 } = {}) {
  const spots = []; // [x, z, conifer?, scale]
  const rnd = rand(42);
  for (let i = 0; i < map.trees.length; i += 2) spots.push([map.trees[i], map.trees[i + 1], rnd() < 0.85 ? 0 : 1, 0.75 + rnd() * 0.5]);

  // building footprints and roads keep forests off them (coarse occupancy grid)
  const G = 6;
  const occ = new Set();
  const mark = (x, z) => occ.add(Math.floor(x / G) + ',' + Math.floor(z / G));
  for (const r of map.roads) for (let i = 0; i < r.p.length - 2; i += 2) {
    const x0 = r.p[i], z0 = r.p[i + 1], x1 = r.p[i + 2], z1 = r.p[i + 3], n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3);
    for (let s = 0; s <= n; s++) mark(x0 + (x1 - x0) * s / n, z0 + (z1 - z0) * s / n);
  }
  for (const b of map.buildings) for (let i = 0; i < b.p.length; i += 2) mark(b.p[i], b.p[i + 1]);

  for (const a of map.areas) {
    const dens = a.k === 'wood' ? 1 / 110 : a.k === 'park' ? 1 / 900 : a.k === 'golf' ? 1 / 1500 : a.k === 'scrub' ? 1 / 1200 : 0;
    if (!dens) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    const n = Math.min(40000, Math.round((x1 - x0) * (z1 - z0) * dens * density));
    for (let k = 0; k < n; k++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!insidePoly(x, z, a.p) || (a.h || []).some(h => insidePoly(x, z, h))) continue;
      if (occ.has(Math.floor(x / G) + ',' + Math.floor(z / G))) continue;
      if (hf.at(x, z) < 0.8) continue;
      spots.push([x, z, a.k === 'wood' && rnd() < 0.7 ? 1 : 0, 0.85 + rnd() * 0.6]);
    }
  }

  const P = protos();
  const texB = leafTexture('broad'), texC = leafTexture('conifer');
  const matB = treeMaterial(csm, texB), matC = treeMaterial(csm, texC);
  const types = [
    { list: [], near: null, far: null, geo: P.broad, mat: matB },
    { list: [], near: null, far: null, geo: P.conifer, mat: matC },
  ];
  // precompute every tree's matrix and colour once
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const s of spots) {
    const t = types[s[2]];
    q.setFromAxisAngle(up, rnd() * Math.PI * 2);
    const sc = s[3];
    const y = hf.at(s[0], s[1]) - 0.15;
    m4.compose(new THREE.Vector3(s[0], y, s[1]), q, new THREE.Vector3(sc, sc * (0.85 + rnd() * 0.3), sc));
    col.setHSL(0.0, 0, 0.82 + rnd() * 0.36);
    col.r *= 0.95 + rnd() * 0.1; col.b *= 0.9 + rnd() * 0.1;
    t.list.push({ x: s[0], z: s[1], m: m4.toArray(new Float32Array(16)), c: [col.r, col.g, col.b] });
  }
  const group = new THREE.Group();
  for (const t of types) {
    for (const lod of ['near', 'far']) {
      const mesh = new THREE.InstancedMesh(t.geo[lod === 'near' ? 0 : 1], t.mat, Math.max(1, t.list.length));
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, t.list.length) * 3), 3);
      mesh.count = 0;
      mesh.castShadow = lod === 'near'; // distant blobs don't need to cast: saves millions of shadow triangles
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      t[lod] = mesh;
      group.add(mesh);
    }
  }

  let lastX = Infinity, lastZ = Infinity;
  function update(cam) {
    if (Math.hypot(cam.x - lastX, cam.z - lastZ) < 20) return;
    lastX = cam.x; lastZ = cam.z;
    const near2 = NEAR * NEAR;
    for (const t of types) {
      const nm = t.near.instanceMatrix.array, fm = t.far.instanceMatrix.array;
      const nc = t.near.instanceColor.array, fc = t.far.instanceColor.array;
      let ni = 0, fi = 0;
      for (const tr of t.list) {
        const d2 = (tr.x - cam.x) ** 2 + (tr.z - cam.z) ** 2;
        if (d2 < near2) { nm.set(tr.m, ni * 16); nc.set(tr.c, ni * 3); ni++; }
        else { fm.set(tr.m, fi * 16); fc.set(tr.c, fi * 3); fi++; }
      }
      t.near.count = ni; t.far.count = fi;
      t.near.instanceMatrix.needsUpdate = t.far.instanceMatrix.needsUpdate = true;
      t.near.instanceColor.needsUpdate = t.far.instanceColor.needsUpdate = true;
    }
  }
  group.userData.count = spots.length;
  group.userData.update = update;
  return group;
}
