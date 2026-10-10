// Hand-built landmarks that replace (or dress up) their plain OSM extrusions.
// createLandmarks(ctx) returns { group, suppress, colliders, update } where
//   suppress:  [{ x, z, r }] circles (game metres): OSM buildings whose centroid falls inside are left out
//   colliders: [{ p: [x0,z0,x1,z1,...], b: baseY, h: height }] footprints the player bumps into
//              (ring with positive signed area in x/z, like map.buildings)
//   update(dt, camera): called every frame
// ctx: { hf, map, csm, project }  (see src/main.js)
//
// One module per landmark; each returns { group, suppress, colliders, update }.
import * as THREE from 'three';
import { buildGoldenGate } from './goldengate.js';
import { buildTransamerica } from './transamerica.js';
import { buildCoit } from './coit.js';
import { buildFerryBuilding } from './ferrybuilding.js';
import { buildSalesforce } from './salesforce.js';

const BUILDERS = [
  ['Golden Gate Bridge', buildGoldenGate],
  ['Transamerica Pyramid', buildTransamerica],
  ['Coit Tower', buildCoit],
  ['Ferry Building', buildFerryBuilding],
  ['Salesforce Tower', buildSalesforce],
];

export function createLandmarks(ctx) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const suppress = [], colliders = [], updates = [], parts = {};
  for (const [name, build] of BUILDERS) {
    try {
      const r = build(ctx);
      if (!r) continue;
      group.add(r.group);
      suppress.push(...(r.suppress || []));
      colliders.push(...(r.colliders || []));
      if (r.update) updates.push(r.update);
      parts[name] = r;
    } catch (err) {
      console.error(`[landmarks] ${name} failed:`, err);
    }
  }
  return {
    group, suppress, colliders, parts,
    update(dt, camera) { for (const u of updates) u(dt, camera); },
    _util: { project: ctx.project },
  };
}
