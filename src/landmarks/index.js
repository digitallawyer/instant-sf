// Hand-built landmarks that replace (or dress up) their plain OSM extrusions.
// createLandmarks(ctx) returns { group, suppress, colliders, update } where
//   suppress:  [{ x, z, r }] circles (game metres): OSM buildings whose centroid falls inside are left out
//   colliders: [{ p: [x0,z0,x1,z1,...], b: baseY, h: height }] footprints the player bumps into
//              (ring with positive signed area in x/z, like map.buildings)
//   update(dt, camera): called every frame
// ctx: { hf, map, csm, project }  (see src/main.js)
import * as THREE from 'three';

export function createLandmarks(ctx) {
  const group = new THREE.Group();
  const suppress = [];
  return { group, suppress, colliders: [], update() {} };
}
