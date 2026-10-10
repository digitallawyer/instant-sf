// The Bay: one huge glossy plane at sea level whose normals are churned by layered wind waves, so the
// sky, the sun glitter and the fog all play on it. Inland ponds and lagoons reuse the same material.
import * as THREE from 'three';
import { GLSL_NOISE, addHook, useShared } from './fog.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function createWater(map, hf, csm) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b1a1f, roughness: 0.05, metalness: 0.0 });
  mat.name = 'water';
  mat.envMapIntensity = 2.2;
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;\n' + GLSL_NOISE + /* glsl */`
        vec2 waveGrad(vec2 p, float t) {
          vec2 g = vec2(0.0);
          // a few directional swells
          vec2 dirs[4] = vec2[4](vec2(0.8, 0.6), vec2(-0.5, 0.86), vec2(0.97, -0.24), vec2(-0.2, -0.98));
          float freqs[4] = float[4](0.13, 0.29, 0.53, 0.97);
          float amps[4] = float[4](0.16, 0.1, 0.06, 0.035);
          for (int i = 0; i < 4; i++) {
            float ph = dot(dirs[i], p) * freqs[i] + t * sqrt(9.8 * freqs[i]) * 1.1;
            g += dirs[i] * cos(ph) * amps[i] * freqs[i] * 6.0;
          }
          // chop
          float e = 0.35;
          vec2 q = p * 0.9 + vec2(t * 0.6, t * 0.25);
          float n0 = fbm(q), nx = fbm(q + vec2(e, 0.0)), nz = fbm(q + vec2(0.0, e));
          g += vec2(nx - n0, nz - n0) / e * 0.8;
          // a second, slower and larger chop breaks up the regularity
          vec2 q2 = p * 0.11 + vec2(-t * 0.05, t * 0.08);
          float m0 = fbm(q2), mx = fbm(q2 + vec2(0.3, 0.0)), mz = fbm(q2 + vec2(0.0, 0.3));
          g += vec2(mx - m0, mz - m0) / 0.3 * 0.12;
          return g;
        }`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        {
          float dist = length(vWW - cameraPosition);
          float atten = 1.0 / (1.0 + dist * 0.004);
          vec2 g = waveGrad(vWW.xz, uTime) * atten;
          vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float depthTint = fbm(vWW.xz * 0.002);
        diffuseColor.rgb = mix(vec3(0.025, 0.05, 0.058), vec3(0.04, 0.07, 0.075), depthTint);
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = 0.035 + 0.06 * smoothstep(200.0, 3000.0, length(vWW - cameraPosition));');
  });

  const group = new THREE.Group();
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000, 1, 1).rotateX(-Math.PI / 2), mat);
  sea.position.y = 0;
  sea.receiveShadow = true;
  group.add(sea);

  // ponds and lagoons above sea level, merged into one mesh
  const ponds = [];
  for (const a of map.areas) {
    if (a.k !== 'water') continue;
    let lo = Infinity;
    for (let i = 0; i < a.p.length; i += 2) lo = Math.min(lo, hf.at(a.p[i], a.p[i + 1]));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    if (a.level == null) continue; // the Bay itself (the sea plane covers it); see carveWater
    lo = a.level - 0.25;
    const shape = new THREE.Shape();
    // shape in (x, -z) so that rotating by -90° about x lays it flat facing up
    for (let i = 0; i < a.p.length; i += 2) i ? shape.lineTo(a.p[i], -a.p[i + 1]) : shape.moveTo(a.p[i], -a.p[i + 1]);
    for (const h of a.h || []) { const hole = new THREE.Path(); for (let i = 0; i < h.length; i += 2) i ? hole.lineTo(h[i], -h[i + 1]) : hole.moveTo(h[i], -h[i + 1]); shape.holes.push(hole); }
    const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, lo + 0.25, 0);
    g.deleteAttribute('uv');
    ponds.push(g.index ? g.toNonIndexed() : g);
  }
  if (ponds.length) group.add(new THREE.Mesh(mergeGeometries(ponds), mat));
  return group;
}
