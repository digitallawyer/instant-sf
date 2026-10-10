// The Castro Theatre (1922, Timothy Pflueger): the Spanish Colonial Baroque facade on Castro Street
// with its great arched window and scrolled parapet, the marquee over the sidewalk, and the tall vertical
// "CASTRO" blade sign: red letters on cream by day, glowing red-orange neon with chasing border bulbs at
// night. The auditorium behind is the OSM footprint, re-extruded as plain stucco.
import * as THREE from 'three';
import { Geo, makeMat, mesh, streetFrame, nearBuildings, shared } from './common.js';

export function buildCastro(ctx) {
  const { map, project, hf } = ctx;
  const [X, Z] = project(37.76210, -122.43500);
  // OSM: the theatre outline is usually replaced by its building:parts (auditorium, facade blocks, and
  // red parts for the blade sign and marquee, which ours replace). Use them when present.
  const area = p => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return Math.abs(a / 2); };
  const named = nearBuildings(map, X, Z, 60, b => typeof b.n === 'string' && /castro theat/i.test(b.n))[0];
  const parts = named ? [] : nearBuildings(map, X + 20, Z, 30, b => b.part);
  const signParts = parts.filter(o => /^#?d8|red/i.test(o.b.c || '') && o.b.h <= 20);
  const bodyParts = parts.filter(o => !signParts.includes(o));
  // the facade goes on the body part that fronts Castro Street most closely (and is big enough)
  const fronting = bodyParts.filter(o => area(o.b.p) > 60).map(o => ({ o, s: streetFrame(map, o.b.p, /^Castro Street$/i).score })).sort((a, b) => a.s - b.s)[0];
  const main = named || (fronting && fronting.o) || nearBuildings(map, X, Z, 30, b => b.h >= 8)[0];

  const bld = main;
  // default footprint: 20 m front on Castro Street, 45 m deep
  const ring = bld ? bld.b.p : [X - 45, Z - 10, X, Z - 10, X, Z + 10, X - 45, Z + 10];
  const sf = streetFrame(map, ring, /^Castro Street$/i, [1, 0]);
  const { F } = sf;
  const g0 = bld ? bld.b.b : (hf.inside(X, Z) ? hf.at(X, Z) : 40);
  const H = Math.max(14, ...(bodyParts.length ? bodyParts.map(o => o.b.h) : [bld ? bld.b.h : 15]));

  const group = new THREE.Group();
  group.name = 'castro-theatre';
  F.apply(group);
  group.position.y = g0;

  const stucco = makeMat(ctx, { color: '#e3d6bf', roughness: 0.88 }, {
    worldPos: true, name: 'ct-stucco', hook: sh => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nfloat ctH(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 0.92 + 0.1 * ctH(floor(vLmWorld.xz * 6.0 + vLmWorld.y * 7.0));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // the marquee throws warm light up the lower facade
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.75, 0.5) * uNight * 0.3 * smoothstep(${(g0 + 16).toFixed(1)}, ${(g0 + 4).toFixed(1)}, vLmWorld.y);`);
    },
  });
  const trim = makeMat(ctx, { color: '#cdb994', roughness: 0.8 }, { name: 'ct-trim' });
  const dark = makeMat(ctx, { color: '#20242a', roughness: 0.25, metalness: 0.5 }, {
    name: 'ct-glass', hook: sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.7, 0.4) * uNight * 0.25;'); },
  });
  const metal = makeMat(ctx, { color: '#3a2e28', roughness: 0.5, metalness: 0.6 }, { name: 'ct-metal' });

  // ---------------------------------------------------------------- building and facade
  const b = new Geo(), t = new Geo(), op = new Geo(), mt = new Geo();
  const local = [];
  for (let i = 0; i < ring.length; i += 2) local.push(F.toLocal(ring[i], ring[i + 1]));
  b.prism(local, -2.5, H, { top: true });
  for (const o of bodyParts) {
    if (o === main) continue;
    const lp = [];
    for (let i = 0; i < o.b.p.length; i += 2) lp.push(F.toLocal(o.b.p[i], o.b.p[i + 1]));
    b.prism(lp, (o.b.m || 0) - 2.5 + (o.b.b - g0), o.b.h + (o.b.b - g0), { top: true });
  }
  const x0 = sf.x0, x1 = sf.x1, xc = (x0 + x1) / 2, W = Math.min(x1 - x0, 24);
  const hw = W / 2;
  // the scrolled parapet: a raised centre panel with volutes, from the cornice line up to ~21 m
  const P = new THREE.Shape();
  const cTop = H + 2.2, peak = H + 7.0;
  P.moveTo(-hw, 0); P.lineTo(hw, 0); P.lineTo(hw, cTop);
  P.lineTo(hw * 0.55, cTop);
  P.bezierCurveTo(hw * 0.5, cTop + 2.4, hw * 0.3, cTop + 1.2, hw * 0.28, cTop + 3.0);
  P.bezierCurveTo(hw * 0.22, peak, -hw * 0.22, peak, -hw * 0.28, cTop + 3.0);
  P.bezierCurveTo(-hw * 0.3, cTop + 1.2, -hw * 0.5, cTop + 2.4, -hw * 0.55, cTop);
  P.lineTo(-hw, cTop); P.lineTo(-hw, 0);
  const pg = new THREE.ExtrudeGeometry(P, { depth: 1.0, bevelEnabled: false, curveSegments: 10 });
  pg.translate(xc, 0, -1.0);
  b.add(pg);
  // cornice and string course, corner pilasters
  t.box(xc - hw - 0.3, H - 0.6, -1.5, xc + hw + 0.3, H, -0.9);
  t.box(xc - hw - 0.3, cTop - 0.4, -1.4, xc + hw + 0.3, cTop, -0.95);
  for (const sx of [-1, 1]) { const xa = sx < 0 ? xc - hw : xc + hw - 0.9; t.box(xa, 0, -1.4, xa + 0.9, cTop, -0.95); }
  // the great arched window over the entrance with its ornate surround
  const aw = Math.min(4.2, hw * 0.42), ay0 = 7.6, ay1 = H + 3.8;
  const surround = new THREE.Shape();
  surround.moveTo(-aw - 1.3, ay0 - 1.0); surround.lineTo(aw + 1.3, ay0 - 1.0); surround.lineTo(aw + 1.3, ay1 - aw);
  surround.absarc(0, ay1 - aw, aw + 1.3, 0, Math.PI, false); surround.lineTo(-aw - 1.3, ay0 - 1.0);
  const hole = new THREE.Path();
  hole.moveTo(-aw, ay0); hole.lineTo(aw, ay0); hole.lineTo(aw, ay1 - aw); hole.absarc(0, ay1 - aw, aw, 0, Math.PI, false); hole.lineTo(-aw, ay0);
  surround.holes.push(hole);
  const sg = new THREE.ExtrudeGeometry(surround, { depth: 0.5, bevelEnabled: false, curveSegments: 12 });
  sg.translate(xc, 0, -1.5);
  t.add(sg);
  // the window: dark glass with mullions and a fan of glazing bars
  const win = new THREE.Shape();
  win.moveTo(-aw, ay0); win.lineTo(aw, ay0); win.lineTo(aw, ay1 - aw); win.absarc(0, ay1 - aw, aw, 0, Math.PI, false); win.lineTo(-aw, ay0);
  const wg = new THREE.ShapeGeometry(win, 12).rotateY(Math.PI);
  wg.translate(xc, 0, -1.02);
  // ShapeGeometry faces +z; after rotateY(pi) it faces -z (the street) but is mirrored in x, which is symmetric anyway
  op.add(wg);
  for (const f of [-0.5, 0, 0.5]) mt.box(xc + f * aw - 0.08, ay0, -1.12, xc + f * aw + 0.08, ay1 - aw * (1 - Math.sqrt(1 - f * f)), -1.04);
  for (let yy = ay0 + 1.8; yy < ay1 - aw; yy += 1.8) mt.box(xc - aw, yy - 0.06, -1.12, xc + aw, yy + 0.06, -1.04);
  // twin side windows with balconettes
  for (const sx of [-1, 1]) {
    const cx = xc + sx * hw * 0.68;
    op.box(cx - 0.9, 9.0, -1.05, cx + 0.9, 11.8, -1.0);
    t.box(cx - 1.3, 8.6, -1.6, cx + 1.3, 9.0, -1.0);
    t.box(cx - 1.25, 11.8, -1.35, cx + 1.25, 12.3, -1.0);
  }
  // finials along the parapet
  for (const f of [-0.95, -0.55, 0.55, 0.95]) t.lathe([[0.35, cTop], [0.28, cTop + 1.0], [0.0, cTop + 1.6]], 8, { cx: xc + f * hw, cz: -1.2 });
  t.lathe([[0.4, peak - 0.2], [0.32, peak + 0.8], [0.0, peak + 1.5]], 8, { cx: xc, cz: -0.5 });
  // street level: entrance doors and the ticket booth
  op.box(xc - hw * 0.6, 0, -1.05, xc + hw * 0.6, 3.6, -1.0);
  t.box(xc - 1.0, 0, -3.2, xc + 1.0, 3.0, -1.0); // ticket booth
  op.box(xc - 0.8, 1.0, -3.25, xc + 0.8, 2.4, -3.2);

  // ---------------------------------------------------------------- marquee
  const mw = Math.min(hw - 0.5, 7.5);
  const MQ0 = 4.0, MQ1 = 6.6, MD = 3.8;
  mt.box(xc - mw, MQ0, -1.0 - MD, xc + mw, MQ1, -1.0);
  // marquee faces with the name and the changeable letter boards
  const marqueeTex = marqueeTexture();
  const faceMat = new THREE.MeshStandardMaterial({ map: marqueeTex, emissiveMap: marqueeTex, emissive: new THREE.Color(0, 0, 0), roughness: 0.5 });
  if (ctx.csm) ctx.csm.setupMaterial(faceMat);
  const faces = new THREE.Group();
  const fFront = new THREE.Mesh(new THREE.PlaneGeometry(mw * 2, MQ1 - MQ0), faceMat);
  fFront.position.set(xc, (MQ0 + MQ1) / 2, -1.0 - MD - 0.02); fFront.rotation.y = Math.PI;
  faces.add(fFront);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(MD, MQ1 - MQ0), faceMat);
    side.position.set(xc + sx * (mw + 0.02), (MQ0 + MQ1) / 2, -1.0 - MD / 2); side.rotation.y = sx * Math.PI / 2;
    faces.add(side);
  }
  // the underside: a grid of bulbs
  const bulbs = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6) });
  const under = new THREE.Mesh(new THREE.PlaneGeometry(mw * 2 - 0.4, MD - 0.4).rotateX(Math.PI / 2), bulbs);
  under.position.set(xc, MQ0 - 0.02, -1.0 - MD / 2);
  faces.add(under);

  // ---------------------------------------------------------------- the vertical blade sign
  const SY0 = 7.0, SY1 = H + 11.5, SW = 2.6, ST = 0.5;   // bottom, top, projection, thickness
  const signZ0 = -1.4, signZ1 = signZ0 - SW;
  mt.box(xc - ST / 2, SY0, signZ1, xc + ST / 2, SY1, signZ0);
  // a crown on top and brackets to the wall
  mt.box(xc - ST / 2 - 0.1, SY1, signZ1 - 0.15, xc + ST / 2 + 0.1, SY1 + 0.4, signZ0 + 0.15);
  mt.lathe([[0.5, SY1 + 0.4], [0.35, SY1 + 1.5], [0.0, SY1 + 2.4]], 8, { cx: xc, cz: (signZ0 + signZ1) / 2 });
  for (const y of [SY0 + 1, (SY0 + SY1) / 2, SY1 - 1]) mt.box(xc - 0.1, y - 0.1, signZ0, xc + 0.1, y + 0.1, -1.0);
  const signTex = signTexture();
  const glowTex = signGlowTexture();
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissiveMap: glowTex, emissive: new THREE.Color(0, 0, 0), roughness: 0.55 });
  if (ctx.csm) ctx.csm.setupMaterial(signMat);
  for (const sx of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(SW, SY1 - SY0), signMat);
    pl.position.set(xc + sx * (ST / 2 + 0.02), (SY0 + SY1) / 2, (signZ0 + signZ1) / 2);
    pl.rotation.y = sx * Math.PI / 2;
    faces.add(pl);
  }
  // edge strip facing the street, with bulbs
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(ST, SY1 - SY0), bulbs);
  edge.position.set(xc, (SY0 + SY1) / 2, signZ1 - 0.02); edge.rotation.y = Math.PI;
  faces.add(edge);

  const meshes = [mesh(b, stucco), mesh(t, trim), mesh(op, dark, { cast: false }), mesh(mt, metal)];
  group.add(...meshes, faces);
  for (const m of faces.children) { m.castShadow = false; m.receiveShadow = true; }

  const colliders = (bodyParts.length ? bodyParts : bld ? [bld] : []).filter(o => !(o.b.m > 2.5)).map(o => ({ p: o.b.p, b: o.b.b, h: o.b.h }));
  const suppress = [...(bld ? [bld] : []), ...parts].map(o => ({ x: o.c[0], z: o.c[1], r: 1.5 }));
  let tt = 0;
  const update = dt => {
    tt += dt;
    const n = shared.uNight.value;
    // neon with a faint flicker; bulbs chase by pulsing
    const flick = 0.93 + 0.07 * Math.sin(tt * 31.0) * Math.sin(tt * 7.3);
    signMat.emissive.setRGB(1, 0.42, 0.22).multiplyScalar(0.04 + n * 2.6 * flick);
    faceMat.emissive.setRGB(1, 1, 1).multiplyScalar(0.05 + n * 1.6);
    const chase = 0.75 + 0.25 * Math.sin(tt * 6.0);
    bulbs.color.setRGB(1, 0.85, 0.6).multiplyScalar(0.55 + n * 4.5 * chase);
  };
  console.info(`[lm] castro theatre: ${bld ? 'OSM footprint ' + (bld.b.n || '') + ` (${bodyParts.length} parts, ${signParts.length} sign parts replaced)` : 'default footprint'}, facade ${W.toFixed(1)} m on ${sf.found ? 'Castro Street' : 'fallback side'}`);
  return { group, suppress, colliders, update };
}

// ---------------------------------------------------------------------------------- textures
const LETTERS = 'CASTRO';
function signTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 128, 1024);
  g.strokeStyle = '#7a1d14'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 1014);
  // border bulbs
  g.fillStyle = '#f6e7b0';
  for (let y = 18; y < 1010; y += 22) { g.beginPath(); g.arc(14, y, 4, 0, 7); g.arc(114, y, 4, 0, 7); g.fill(); }
  drawLetters(g, '#b8231a', '#7a120c');
  return tex(c, true);
}
function signGlowTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#060402'; g.fillRect(0, 0, 128, 1024);
  g.fillStyle = '#ffd890';
  for (let y = 18; y < 1010; y += 22) { g.beginPath(); g.arc(14, y, 4, 0, 7); g.arc(114, y, 4, 0, 7); g.fill(); }
  g.shadowColor = '#ff5a1e'; g.shadowBlur = 14;
  drawLetters(g, '#ff6a2a', '#ffb070');
  return tex(c, true);
}
function drawLetters(g, fill, line) {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 132px "Arial Black", Impact, sans-serif';
  const step = 1024 / LETTERS.length;
  for (let i = 0; i < LETTERS.length; i++) {
    const y = step * (i + 0.5) + 6;
    g.fillStyle = fill; g.fillText(LETTERS[i], 64, y);
    g.lineWidth = 3; g.strokeStyle = line; g.strokeText(LETTERS[i], 64, y);
  }
}
function marqueeTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#7a1d14'; g.fillRect(0, 0, 512, 14); g.fillRect(0, 114, 512, 14);
  g.fillStyle = '#f6e7b0';
  for (let x = 10; x < 512; x += 18) { g.beginPath(); g.arc(x, 7, 3.5, 0, 7); g.arc(x, 121, 3.5, 0, 7); g.fill(); }
  g.fillStyle = '#b8231a'; g.font = 'bold 46px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CASTRO', 256, 46);
  g.fillStyle = '#222'; g.font = 'bold 26px Arial, sans-serif';
  g.fillText('NOW PLAYING · VERTIGO', 256, 92);
  return tex(c, true);
}
function tex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
