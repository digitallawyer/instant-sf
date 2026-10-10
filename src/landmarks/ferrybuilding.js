// The Ferry Building clock tower (1898, after the Giralda in Seville). The long nave stays the OSM
// building; the tower is rebuilt: a square shaft with corner piers and tall arched bays, the clock stage
// with four 22-ft faces that show the real time in San Francisco, a balustraded belvedere of arches,
// two diminishing stages, the lantern, dome and flagpole. The clock faces glow at night.
import * as THREE from 'three';
import { Geo, makeMat, glowMat, mesh, worldRing, centroid, frame, GLSL_HASH, shared } from './common.js';

export function buildFerryBuilding(ctx) {
  const { map, project } = ctx;
  let C = project(37.79555, -122.39366), b0 = 1.4, dir = [0.6, 0.8];
  // the stacked OSM tower parts share a centroid; the shaft is the tallest square one
  const parts = map.buildings.map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 40 && o.b.part);
  const shaft = parts.filter(o => o.b.p.length === 8 && o.b.h > 35 && o.b.h < 50).sort((a, b) => b.b.h - a.b.h)[0];
  if (shaft) {
    C = shaft.c; b0 = shaft.b.b;
    // orientation from the nave (long OSM part next to the tower): its longest edge
    const nave = map.buildings.filter(b => b.h > 12 && b.h < 25 && b.p.length > 20).map(b => ({ b, c: centroid(b.p) })).filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 60)[0];
    const p = (nave ? nave.b : shaft.b).p;
    let best = 0;
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length, dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], l = Math.hypot(dx, dz);
      if (l > best) { best = l; dir = [dx / l, dz / l]; }
    }
  }
  const tower = parts.filter(o => Math.hypot(o.c[0] - C[0], o.c[1] - C[1]) < 3);
  const half = shaft ? Math.sqrt(Math.abs(areaOf(shaft.b.p))) / 2 : 5.6;
  // frame: local x along the nave, local z towards the Embarcadero / Market Street (the front)
  if (dir[0] < 0) dir = [-dir[0], -dir[1]];
  const F = frame(C[0], C[1], -dir[1], dir[0]);
  const group = new THREE.Group();
  group.name = 'ferry-building-tower';
  F.apply(group);
  group.position.y = b0;

  const stone = makeMat(ctx, { color: '#ddd3c1', roughness: 0.8 }, {
    worldPos: true, name: 'fb-stone', hook: shader => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL_HASH)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 0.92 + 0.1 * lmNoise(vLmWorld.xz * 2.0 + vLmWorld.y * 1.7);
          float course = abs(fract(vLmWorld.y / 0.6) - 0.5);
          diffuseColor.rgb *= 1.0 - 0.06 * smoothstep(0.42, 0.5, course) * (1.0 - abs(vLmNormal.y));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float fd = max(dot(normalize(vLmNormal), normalize(vec3(-0.6, 0.3, 0.75))), 0.0);
          float hgt = smoothstep(${(b0 + 80).toFixed(1)}, ${(b0 + 15).toFixed(1)}, vLmWorld.y);
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.88, 0.7) * uNight * 0.42 * (0.3 + 0.7 * fd) * (0.55 + 0.45 * hgt);`);
    },
  });
  const dark = makeMat(ctx, { color: '#22201d', roughness: 0.35, metalness: 0.3 }, {
    name: 'fb-openings', hook: shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.75, 0.45) * uNight * 0.22;');
    },
  });
  const copper = makeMat(ctx, { color: '#8a9c8c', roughness: 0.55, metalness: 0.3 }, { name: 'fb-roof' });

  const g = new Geo(), op = new Geo(), roof = new Geo();
  const H = half;            // ~5.6 m
  const top0 = 43.5;         // top of the shaft = base of the clock stage
  // ---- shaft: corner piers, recessed faces with paired tall arched windows, string courses
  g.box(-H + 1.4, -2, -H + 1.4, H - 1.4, top0, H - 1.4, { top: false, bottom: false }); // recessed core
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.box(sx * H, -2, sz * H, sx * (H - 1.7), top0, sz * (H - 1.7), { bottom: false });
  }
  for (let fi = 0; fi < 4; fi++) {
    const rot = new THREE.Matrix4().makeRotationY(fi * Math.PI / 2);
    g.push(rot); op.push(rot);
    // face at +z
    const zf = H - 1.4 + 0.02;
    for (const [y0, y1] of [[18, 27], [29, 39]]) for (const u of [-1.1, 1.1]) arch(op, u, zf, y0, y1, 0.7);
    for (const y of [17, 28, 40.5]) g.box(-H + 1.6, y - 0.35, zf - 0.02, H - 1.6, y + 0.35, zf + 0.35);
    g.pop(); op.pop();
  }
  // ---- clock stage: projecting cornice, a large clock on each face
  g.box(-H - 0.45, top0 - 0.8, -H - 0.45, H + 0.45, top0, H + 0.45);
  g.box(-H, top0, -H, H, 50.5, H, { top: false });
  g.box(-H - 0.5, 50.5, -H - 0.5, H + 0.5, 51.4, H + 0.5); // balcony slab
  // balustrade
  for (let fi = 0; fi < 4; fi++) {
    g.push(new THREE.Matrix4().makeRotationY(fi * Math.PI / 2));
    g.box(-H - 0.5, 51.4, H + 0.15, H + 0.5, 52.4, H + 0.5, { bottom: false });
    g.pop();
  }
  const clockY = 47.0, clockR = 3.3;
  // ---- belvedere: three arches per side between piers
  const B = 8.3 / 2;
  g.box(-B, 51.4, -B, B, 54.2, B, { top: false, bottom: false });
  for (let fi = 0; fi < 4; fi++) {
    const rot = new THREE.Matrix4().makeRotationY(fi * Math.PI / 2);
    op.push(rot); g.push(rot);
    for (const u of [-2.3, 0, 2.3]) arch(op, u, B + 0.02, 51.8, 54.0, 0.8);
    g.pop(); op.pop();
  }
  g.box(-B - 0.3, 54.2, -B - 0.3, B + 0.3, 54.9, B + 0.3);
  // ---- second stage (6.4 m) with single arches and corner pilasters
  const S2 = 6.4 / 2;
  g.box(-S2, 54.9, -S2, S2, 60.5, S2, { top: false, bottom: false });
  for (let fi = 0; fi < 4; fi++) {
    const rot = new THREE.Matrix4().makeRotationY(fi * Math.PI / 2);
    op.push(rot); g.push(rot);
    for (const u of [-1.2, 1.2]) arch(op, u, S2 + 0.02, 55.6, 59.6, 0.6);
    for (const u of [-S2, S2]) g.box(u - 0.35, 54.9, S2, u + 0.35, 60.5, S2 + 0.3, { bottom: false });
    g.pop(); op.pop();
  }
  g.box(-S2 - 0.3, 60.5, -S2 - 0.3, S2 + 0.3, 61.1, S2 + 0.3);
  // ---- third stage (4.7 m) and the round lantern
  const S3 = 4.7 / 2;
  g.box(-S3, 61.1, -S3, S3, 64.5, S3, { bottom: false });
  for (let fi = 0; fi < 4; fi++) {
    const rot = new THREE.Matrix4().makeRotationY(fi * Math.PI / 2);
    op.push(rot);
    arch(op, 0, S3 + 0.02, 61.7, 64.0, 0.7);
    op.pop();
  }
  g.lathe([[1.95, 64.5], [1.95, 67.6], [2.2, 67.9], [2.2, 68.3]], 16);
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2;
    op.push(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2));
    arch(op, 0, 1.97, 65.0, 67.3, 0.42);
    op.pop();
  }
  roof.lathe(domeProfile(2.15, 68.3, 3.0), 16);
  g.lathe([[0.45, 71.2], [0.4, 72.0], [0.6, 72.3], [0.15, 72.9]], 8);
  g.lathe([[0.12, 72.9], [0.06, 84.0]], 6, { flat: true }); // flagpole
  roof.box(0.06, 81.2, -0.02, 2.3, 82.6, 0.02); // the flag

  const meshes = [mesh(g, stone), mesh(op, dark, { cast: false }), mesh(roof, copper)];
  group.add(...meshes);

  // ---- clocks: faces (canvas texture, glowing at night) and hands updated from the real time in SF
  const faceTex = clockTexture();
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.5, emissiveMap: faceTex, emissive: new THREE.Color(0, 0, 0) });
  if (ctx.csm) ctx.csm.setupMaterial(faceMat);
  const handMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.5 });
  if (ctx.csm) ctx.csm.setupMaterial(handMat);
  const hands = [];
  const faceGeo = new THREE.CircleGeometry(clockR, 40);
  const ringGeo = new THREE.RingGeometry(clockR, clockR + 0.35, 40);
  const hourGeo = new THREE.BoxGeometry(0.28, 1.9, 0.06).translate(0, 0.75, 0);
  const minGeo = new THREE.BoxGeometry(0.18, 2.8, 0.06).translate(0, 1.15, 0);
  for (let fi = 0; fi < 4; fi++) {
    const holder = new THREE.Group();
    holder.rotation.y = fi * Math.PI / 2;
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(0, clockY, H + 0.06);
    const ring = new THREE.Mesh(ringGeo, stone);
    ring.position.set(0, clockY, H + 0.08);
    const hh = new THREE.Mesh(hourGeo, handMat), mh = new THREE.Mesh(minGeo, handMat);
    hh.position.set(0, clockY, H + 0.14); mh.position.set(0, clockY, H + 0.2);
    holder.add(face, ring, hh, mh);
    hands.push([hh, mh]);
    group.add(holder);
  }

  const colliders = [{ p: worldRing([[-H, -H], [H, -H], [H, H], [-H, H]], F.toWorld), b: b0, h: 70 }];
  const suppress = tower.length ? [{ x: C[0], z: C[1], r: 3.5 }] : [];
  let acc = 1;
  const update = dt => {
    acc += dt;
    if (acc > 0.5) {
      acc = 0;
      const now = sfTime();
      const m = now.m + now.s / 60, h = (now.h % 12) + m / 60;
      for (const [hh, mh] of hands) { hh.rotation.z = -h / 12 * Math.PI * 2; mh.rotation.z = -m / 60 * Math.PI * 2; }
    }
    const n = shared.uNight.value;
    faceMat.emissive.setRGB(n * 1.6, n * 1.45, n * 1.1);
  };
  console.info(`[lm] ferry building tower at ${C.map(v => v.toFixed(1))} half ${half.toFixed(1)}, ${tower.length} OSM tower parts replaced`);
  return { group, suppress, colliders, update };
}

function areaOf(p) { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }

function domeProfile(r, y0, h) {
  const out = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8 * Math.PI / 2; out.push([Math.max(0.45, r * Math.cos(t)), y0 + Math.sin(t) * h]); }
  return out;
}

// a dark round-arched opening on a face at z = zf (facing +z), centred at u
function arch(geo, u, zf, y0, y1, hw) {
  const spring = y1 - hw;
  geo.quad([u - hw, y0, zf], [u + hw, y0, zf], [u + hw, spring, zf], [u - hw, spring, zf], 0, 0, 1, 1, [0, 0, 1]);
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI * i / N, t1 = Math.PI * (i + 1) / N;
    geo.tri([u, spring, zf], [u + Math.cos(t0) * hw, spring + Math.sin(t0) * hw, zf], [u + Math.cos(t1) * hw, spring + Math.sin(t1) * hw, zf], [0, 0], [1, 0], [0, 1], [0, 0, 1]);
  }
}

function clockTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ecdc'; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 118, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1b1b1b'; g.font = 'bold 30px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const R = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    g.save(); g.translate(128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92); g.rotate(a); g.fillText(R[i], 0, 0); g.restore();
  }
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * Math.PI * 2, r0 = i % 5 ? 112 : 106;
    g.lineWidth = i % 5 ? 2 : 4;
    g.beginPath(); g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0); g.lineTo(128 + Math.sin(a) * 117, 128 - Math.cos(a) * 117); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function sfTime() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date());
    const get = k => +parts.find(p => p.type === k).value;
    return { h: get('hour') % 24, m: get('minute'), s: get('second') };
  } catch {
    const d = new Date(); return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
  }
}
