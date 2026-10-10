// Hand-built landmarks that replace (or dress up) their plain OSM extrusions.
// createLandmarks(ctx) returns { group, suppress } where suppress is a list of { x, z, r } circles
// (game metres): OSM buildings whose centroid falls inside one are left out of the generic city.
// ctx: { hf, map, csm, project }  (see src/main.js)
import * as THREE from 'three';

export function createLandmarks(ctx) {
  const group = new THREE.Group();
  const suppress = [];
  return { group, suppress, update() {} };
}
