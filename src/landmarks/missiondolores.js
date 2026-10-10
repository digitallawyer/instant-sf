// Mission Dolores: the 1776 adobe Mission San Francisco de Asís (whitewashed facade, four columns below and
// four above framing three bells under the overhanging red tile roof) and, beside it, the 1918
// Churrigueresque basilica with its ornate centre gable, rose window and twin bell towers crowned with
// tiled domes and lanterns. Both face Dolores Street; footprints come from OSM when mapped.
import * as THREE from 'three';
import { Geo, makeMat, mesh, worldRing, streetFrame, nearBuildings } from './common.js';

export function buildMissionDolores(ctx) {
  const { map, project, hf } = ctx;
  const [X, Z] = project(37.76420, -122.42710);
  const near = nearBuildings(map, X, Z, 90);
  const named = re => near.find(o => typeof o.b.n === 'string' && re.test(o.b.n));
  let basilica = named(/basilica/i);
  let mission = named(/^old mission|as[ií]s/i) || near.find(o => typeof o.b.n === 'string' && /mission/i.test(o.b.n) && !/basilica/i.test(o.b.n));
  if (mission === basilica) basilica = null;
  // fallbacks: the mission is the small long building nearest the point, the basilica the biggest one next to it
  const area = b => { let a = 0; for (let i = 0; i < b.p.length; i += 2) { const j = (i + 2) % b.p.length; a += b.p[i] * b.p[j + 1] - b.p[j] * b.p[i + 1]; } return Math.abs(a / 2); };
  if (!mission) mission = near.find(o => area(o.b) > 150 && area(o.b) < 700 && o.d < 40);
  if (!basilica) basilica = near.filter(o => o !== mission && area(o.b) > 700 && o.d < 80).sort((a, b) => area(b.b) - area(a.b))[0];

  const group = new THREE.Group();
  group.name = 'mission-dolores';
  const suppress = [], colliders = [];

  const adobe = makeMat(ctx, { color: '#efe9de', roughness: 0.95 }, { worldPos: true, name: 'md-adobe', hook: plaster(0.18, 0.35) });
  const stucco = makeMat(ctx, { color: '#e7dcc8', roughness: 0.9 }, { worldPos: true, name: 'md-stucco', hook: plaster(0.08, 0.42) });
  const tile = makeMat(ctx, { color: '#a5513a', roughness: 0.8 }, { worldPos: true, name: 'md-tile', hook: tiles() });
  const domeTile = makeMat(ctx, { color: '#c89a5a', roughness: 0.6, metalness: 0.1 }, { worldPos: true, name: 'md-dome', hook: tiles() });
  const wood = makeMat(ctx, { color: '#4a3020', roughness: 0.8 }, { name: 'md-wood' });
  const dark = makeMat(ctx, { color: '#1a1714', roughness: 0.6 }, {
    name: 'md-openings', hook: sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * uNight * 0.18;'); },
  });
  const bronze = makeMat(ctx, { color: '#9a7a44', roughness: 0.35, metalness: 0.6 }, { name: 'md-bronze' });

  const groundAt = (x, z) => (hf.inside(x, z) ? hf.at(x, z) : 15);

  // ======================================================== the old mission
  {
    const ring = mission ? mission.b.p : rectWorld(X, Z, 9.5, 36, [1, 0]);
    const sf = streetFrame(map, ring, /^Dolores Street$/i, [1, 0]);
    const { F } = sf;
    const W = Math.min(14, sf.width), D = Math.max(20, sf.depth);
    const g0 = mission ? mission.b.b : groundAt(F.ox, F.oz);
    const holder = new THREE.Group(); F.apply(holder); holder.position.y = g0; group.add(holder);
    const w = new Geo(), roof = new Geo(), op = new Geo(), wd = new Geo(), br = new Geo();
    const hw = W / 2, EAVE = 7.4, RIDGE = EAVE + hw * 0.55;
    const x0 = sf.x0, x1 = sf.x1, xc = (x0 + x1) / 2;
    // walls: the footprint, with a gabled front and back
    const local = [];
    for (let i = 0; i < ring.length; i += 2) local.push(F.toLocal(ring[i], ring[i + 1]));
    w.prism(local, -2.5, EAVE, { top: false });
    for (const z of [0.02, D]) { // gable ends
      w.tri([xc - hw, EAVE, z], [xc + hw, EAVE, z], [xc, RIDGE, z], [0, 0], [1, 0], [0.5, 1], [0, 0, z < 1 ? -1 : 1]);
    }
    // the tile roof, overhanging the facade like a porch
    gable(roof, xc, hw + 0.7, -1.6, D + 0.6, EAVE - 0.35, RIDGE + 0.15);
    // facade: lower order of four engaged columns, a ledge, upper order of four columns framing three bells
    const cols = [-0.4, -0.15, 0.15, 0.4].map(f => xc + f * W);
    for (const cx of cols) {
      w.lathe([[0.42, 0], [0.42, 0.5], [0.34, 0.7], [0.32, 4.2], [0.44, 4.45]], 10, { cx, cz: -0.25 });
      w.lathe([[0.3, 4.9], [0.26, 5.1], [0.25, 7.0], [0.34, 7.15]], 10, { cx, cz: -0.25 });
    }
    w.box(xc - hw - 0.1, 4.45, -0.8, xc + hw + 0.1, 4.9, 0.1);   // the balcony ledge
    w.box(xc - hw - 0.1, 7.05, -0.75, xc + hw + 0.1, 7.4, 0.1);  // lintel under the roof
    // door
    wd.box(xc - 1.15, 0, -0.06, xc + 1.15, 3.5, 0.02);
    op.box(xc - 1.35, 3.5, -0.05, xc + 1.35, 3.65, 0.02);
    // three bell openings in the upper storey with bells hanging in them
    for (let k = 0; k < 3; k++) {
      const cx = (cols[k] + cols[k + 1]) / 2, ow = (cols[k + 1] - cols[k]) / 2 - 0.45;
      op.box(cx - ow, 5.05, -0.04, cx + ow, 6.85, 0.02);
      br.lathe([[0.02, 6.6], [0.22, 6.5], [0.32, 6.05], [0.46, 5.6], [0.52, 5.4], [0.0, 5.4]], 12, { cx, cz: -0.3 });
      br.box(cx - 0.05, 6.6, -0.35, cx + 0.05, 6.85, -0.25);
    }
    // small windows along the side walls
    holder.add(mesh(w, adobe), mesh(roof, tile), mesh(op, dark, { cast: false }), mesh(wd, wood, { cast: false }), mesh(br, bronze));
    if (mission) { suppress.push({ x: mission.c[0], z: mission.c[1], r: 3 }); colliders.push({ p: mission.b.p, b: g0, h: EAVE }); }
  }

  // ======================================================== the basilica
  {
    const ring = basilica ? basilica.b.p : rectWorld(X - 0, Z - 28, 24, 50, [1, 0]);
    const sf = streetFrame(map, ring, /^Dolores Street$/i, [1, 0]);
    const { F } = sf;
    const g0 = basilica ? basilica.b.b : groundAt(F.ox, F.oz);
    const holder = new THREE.Group(); F.apply(holder); holder.position.y = g0; group.add(holder);
    const s = new Geo(), roof = new Geo(), op = new Geo(), dm = new Geo(), wd = new Geo();
    const x0 = sf.x0, x1 = sf.x1, xc = (x0 + x1) / 2, W = x1 - x0, D = Math.max(30, sf.depth);
    const NAVE = 15.5, RIDGE = NAVE + Math.min(W, 22) * 0.22;
    const local = [];
    for (let i = 0; i < ring.length; i += 2) local.push(F.toLocal(ring[i], ring[i + 1]));
    s.prism(local, -2.5, NAVE, { top: false });
    gable(roof, xc, Math.min(W, 22) / 2 + 0.4, 1.5, D + 0.4, NAVE - 0.2, RIDGE);
    s.cap(local, NAVE - 0.25, 1);
    // ---- the towers at the front corners
    const T = Math.min(7.6, W * 0.24);
    for (const side of [-1, 1]) {
      const tx = side < 0 ? x0 + T / 2 : x1 - T / 2;
      const shaftTop = 24, belfry = 31.5;
      s.box(tx - T / 2, -2.5, -0.6, tx + T / 2, shaftTop, T - 0.6, { bottom: false });
      s.box(tx - T / 2 - 0.35, shaftTop, -0.95, tx + T / 2 + 0.35, shaftTop + 0.8, T - 0.25);
      // belfry: corner piers with an arched opening on every side
      const bt = T / 2 - 0.3;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.box(tx + sx * bt - 0.8, shaftTop + 0.8, (T / 2 - 0.6) + sz * bt - 0.8, tx + sx * bt + 0.8, belfry, (T / 2 - 0.6) + sz * bt + 0.8);
      s.box(tx - bt + 0.8, shaftTop + 0.8, T / 2 - 0.6 - bt + 0.8, tx + bt - 0.8, shaftTop + 2.0, T / 2 - 0.6 + bt - 0.8);
      for (let f = 0; f < 4; f++) {
        const m = new THREE.Matrix4().makeRotationY(f * Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(tx, 0, T / 2 - 0.6));
        op.push(m); arch(op, 0, bt + 0.02, shaftTop + 2.0, belfry - 0.9, bt - 0.85, false); op.pop();
        s.push(m);
        s.box(-bt, belfry - 1.0, bt - 0.4, bt, belfry - 0.3, bt + 0.05, { bottom: false }); // arch head band
        s.pop();
      }
      s.box(tx - T / 2 - 0.4, belfry, -1.0, tx + T / 2 + 0.4, belfry + 0.9, T - 0.2);
      // octagonal drum, tiled dome, lantern and cross
      const cz = T / 2 - 0.6;
      const oct = (r, rot = Math.PI / 8) => Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2 + rot; return [tx + Math.cos(a) * r, cz + Math.sin(a) * r]; });
      s.prism(oct(T * 0.42), belfry + 0.9, belfry + 3.4, { top: true });
      dm.lathe(domeProf(T * 0.44, belfry + 3.4, T * 0.48), 16, { cx: tx, cz });
      s.lathe([[0.55, belfry + 3.4 + T * 0.48 - 0.1], [0.55, belfry + 4.6 + T * 0.48], [0.75, belfry + 4.8 + T * 0.48], [0.1, belfry + 5.6 + T * 0.48]], 8, { cx: tx, cz });
      const ct = belfry + 5.6 + T * 0.48;
      s.box(tx - 0.08, ct, cz - 0.08, tx + 0.08, ct + 2.0, cz + 0.08);
      s.box(tx - 0.55, ct + 1.25, cz - 0.08, tx + 0.55, ct + 1.45, cz + 0.08);
      // corner finials on the belfry cornice
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.lathe([[0.35, belfry + 0.9], [0.25, belfry + 1.8], [0.0, belfry + 2.4]], 6, { cx: tx + sx * (T / 2), cz: cz + sz * (T / 2) });
      colliders.push({ p: worldRing([[tx - T / 2, -0.6], [tx + T / 2, -0.6], [tx + T / 2, T - 0.6], [tx - T / 2, T - 0.6]], F.toWorld), b: g0, h: 40 });
    }
    // ---- the Churrigueresque centre gable between the towers
    const gx0 = x0 + T, gx1 = x1 - T, gw = gx1 - gx0, gc = (gx0 + gx1) / 2;
    const shp = new THREE.Shape();
    const top = NAVE + 6.5;
    shp.moveTo(-gw / 2, 0); shp.lineTo(gw / 2, 0); shp.lineTo(gw / 2, NAVE + 1.0);
    // scrolled shoulders rising to a crested centre
    shp.bezierCurveTo(gw / 2, NAVE + 3.2, gw * 0.22, NAVE + 2.2, gw * 0.2, NAVE + 4.2);
    shp.lineTo(gw * 0.12, NAVE + 4.2);
    shp.bezierCurveTo(gw * 0.12, top + 0.5, -gw * 0.12, top + 0.5, -gw * 0.12, NAVE + 4.2);
    shp.lineTo(-gw * 0.2, NAVE + 4.2);
    shp.bezierCurveTo(-gw * 0.22, NAVE + 2.2, -gw / 2, NAVE + 3.2, -gw / 2, NAVE + 1.0);
    shp.lineTo(-gw / 2, 0);
    const gg = new THREE.ExtrudeGeometry(shp, { depth: 1.2, bevelEnabled: false, curveSegments: 10 });
    gg.translate(gc, 0, -1.2);
    s.add(gg);
    // ornament: pilasters, a heavy frame around the portal, the rose window, a niche, finials
    for (const f of [-0.42, -0.2, 0.2, 0.42]) s.box(gc + f * gw - 0.4, 0, -1.7, gc + f * gw + 0.4, NAVE + 0.8, -1.15);
    s.box(gc - 3.4, 0, -1.9, gc + 3.4, 8.6, -1.15);
    op.push(new THREE.Matrix4().makeTranslation(0, 0, -1.92 + 0.0));
    arch(op, gc, 0, 0.0, 7.4, 2.0, true);
    op.pop();
    wd.push(new THREE.Matrix4().makeTranslation(0, 0, -1.95)); arch(wd, gc, 0, 0.0, 5.3, 1.7, true); wd.pop();
    // rose window with a stone ring
    const rose = new Geo();
    rose.lathe([[2.55, -0.25], [2.55, 0.25], [2.0, 0.25]], 24);
    const rm = new THREE.Matrix4().makeRotationX(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(gc, 11.4, -1.35));
    s.add(rose.build(), rm);
    const disc = new THREE.CircleGeometry(2.0, 24);
    op.add(disc, new THREE.Matrix4().makeRotationY(Math.PI).premultiply(new THREE.Matrix4().makeTranslation(gc, 11.4, -1.25)));
    // niche + statue block above the rose
    op.push(new THREE.Matrix4().makeTranslation(0, 0, -1.22)); arch(op, gc, 0, NAVE + 0.8, NAVE + 3.8, 0.75, true); op.pop();
    for (const f of [-0.42, 0.42, -0.2, 0.2]) s.lathe([[0.35, NAVE + 0.8], [0.3, NAVE + 1.8], [0.0, NAVE + 2.6]], 6, { cx: gc + f * gw, cz: -1.45 });
    s.lathe([[0.4, top - 0.4], [0.3, top + 0.5], [0, top + 1.2]], 6, { cx: gc, cz: -0.6 });
    holder.add(mesh(s, stucco), mesh(roof, tile), mesh(op, dark, { cast: false }), mesh(dm, domeTile), mesh(wd, wood, { cast: false }));
    if (basilica) { suppress.push({ x: basilica.c[0], z: basilica.c[1], r: 3 }); colliders.push({ p: basilica.b.p, b: g0, h: NAVE }); }
  }
  console.info(`[lm] mission dolores: mission ${mission ? 'from OSM ' + (mission.b.n || '') : 'default'}, basilica ${basilica ? 'from OSM ' + (basilica.b.n || '') : 'default'}`);
  return { group, suppress, colliders, update: null };
}

// --------------------------------------------------------------------------------------------
function rectWorld(cx, cz, w, d, dir) {
  // a w x d rectangle centred on (cx, cz) whose front faces world direction dir
  const [fx, fz] = dir, rx = -fz, rz = fx;
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].flatMap(([sx, sf]) => [cx + rx * sx * w / 2 + fx * sf * d / 2, cz + rz * sx * w / 2 + fz * sf * d / 2]);
}
function plaster(rough, scale) {
  return shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nfloat mdH(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}\nfloat mdN(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(mdH(i),mdH(i+vec2(1,0)),u.x),mix(mdH(i+vec2(0,1)),mdH(i+vec2(1,1)),u.x),u.y);}')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vLmWorld.xz * ${scale.toFixed(2)} * 3.0 + vLmWorld.y * 2.1;
        diffuseColor.rgb *= 1.0 - ${rough.toFixed(2)} * (mdN(q) * 0.6 + mdN(q * 4.0) * 0.4);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.85, 0.65) * uNight * 0.14;`);
  };
}
// barrel tiles: ribs across the slope
function tiles() {
  return shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rib = 0.5 + 0.5 * sin((vLmWorld.x + vLmWorld.z) * 14.0);
        float course = smoothstep(0.85, 1.0, fract(vLmWorld.y * 2.6));
        diffuseColor.rgb *= 0.78 + 0.3 * rib - 0.15 * course;
        diffuseColor.rgb *= 0.9 + 0.2 * fract(sin(dot(floor(vec2(vLmWorld.x + vLmWorld.z, vLmWorld.y * 2.6) * vec2(2.2, 1.0)), vec2(12.9898, 78.233))) * 43758.5453);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.08;`);
  };
}
// a gabled roof with its ridge along local z, centred on x = xc
function gable(g, xc, hw, z0, z1, eave, ridge) {
  const A = [xc - hw, eave, z0], B = [xc - hw, eave, z1], Cc = [xc, ridge, z1], D = [xc, ridge, z0];
  const E = [xc + hw, eave, z0], Fq = [xc + hw, eave, z1];
  g.quad(A, B, Cc, D, 0, 0, z1 - z0, hw, [-1, 2, 0]);
  g.quad(E, D, Cc, Fq, 0, 0, z1 - z0, hw, [1, 2, 0]);
  // thickness at the eaves and the gable verges
  const th = 0.25;
  g.quad([A[0], eave - th, z0], [B[0], eave - th, z1], B, A, 0, 0, 1, 1, [-1, 0, 0]);
  g.quad([E[0], eave - th, z1], [E[0], eave - th, z0], E, Fq, 0, 0, 1, 1, [1, 0, 0]);
  g.quad([A[0], eave - th, z0], A, D, [D[0], ridge - th, z0], 0, 0, 1, 1, [0, 0, -1]);
  g.quad([D[0], ridge - th, z0], D, E, [E[0], eave - th, z0], 0, 0, 1, 1, [0, 0, -1]);
  g.quad([A[0], eave - th, z0], [D[0], ridge - th, z0], [D[0], ridge - th, z1], [A[0], eave - th, z1], 0, 0, 1, 1, [0.5, -1, 0]);
  g.quad([E[0], eave - th, z0], [E[0], eave - th, z1], [D[0], ridge - th, z1], [D[0], ridge - th, z0], 0, 0, 1, 1, [-0.5, -1, 0]);
}
function domeProf(r, y0, h) {
  const out = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10 * Math.PI / 2; out.push([Math.max(0.5, r * Math.cos(t)), y0 + Math.sin(t) * h]); }
  return out;
}
// round-arched panel on the plane z = zf facing -z (towards the street), centred at x = u
function arch(geo, u, zf, y0, y1, hw, front = true) {
  const spring = y1 - hw, f = front ? [0, 0, -1] : [0, 0, 1];
  geo.quad([u - hw, y0, zf], [u + hw, y0, zf], [u + hw, spring, zf], [u - hw, spring, zf], 0, 0, 1, 1, f);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI * i / N, t1 = Math.PI * (i + 1) / N;
    geo.tri([u, spring, zf], [u + Math.cos(t0) * hw, spring + Math.sin(t0) * hw, zf], [u + Math.cos(t1) * hw, spring + Math.sin(t1) * hw, zf], [0, 0], [1, 0], [0, 1], f);
  }
}
