// The Bay: one huge glossy plane at sea level whose normals are churned by layered wind waves, so the
// sky, the sun glitter and the fog all play on it. Inland ponds and lagoons reuse the same material.
// It reflects the sky exactly as the dome draws it (sky.js skyReflection) with water's Fresnel (F0 = 0.02),
// turns the wave detail it can no longer resolve in the distance into roughness (so the sun spreads into a
// glittering path instead of a single dot), sparkles, and picks up a shallow tint and surf near the shore
// from the bathymetry in the height field.
import * as THREE from 'three';
import { GLSL_NOISE, addHook, useShared } from './fog.js';
import { skyReflection } from './sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// water depth below sea level (0..25.5 m, 0.1 m steps) from the height field, at half its resolution
function depthTexture(hf) {
  const step = 2, w = Math.ceil(hf.nx / step), h = Math.ceil(hf.nz / step);
  const data = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1;
    const d = edge ? 25.5 : -hf.raw(i * step, j * step);
    data[j * w + i] = Math.max(0, Math.min(255, Math.round(d * 10)));
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  const rect = new THREE.Vector4(hf.minX, hf.minZ, (w - 1) * step * hf.cell, (h - 1) * step * hf.cell);
  return { tex, rect };
}

export function createWater(map, hf, csm) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b1a1f, roughness: 0.05, metalness: 0.0 });
  mat.name = 'water';
  // the sky as seen, not the (desaturated) lighting environment; physically scaled, so intensity 1
  mat.envMap = skyReflection.texture;
  mat.envMapIntensity = 1.0;
  skyReflection.listeners.add(t => { mat.envMap = t; });
  const depth = hf ? depthTexture(hf) : null;
  const uDepth = { value: depth?.tex || null }, uDepthRect = { value: depth?.rect || new THREE.Vector4(0, 0, 1, 1) };
  if (csm) csm.setupMaterial(mat);
  addHook(mat, shader => {
    useShared(shader);
    shader.uniforms.uDepth = uDepth;
    shader.uniforms.uDepthRect = uDepthRect;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;\nuniform sampler2D uDepth;\nuniform vec4 uDepthRect;\nfloat wAtten, wDepth, wFoam, wGlint;\n' + GLSL_NOISE + /* glsl */`
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
          wAtten = 1.0 / (1.0 + dist * 0.004);
          // shore: depth from the bathymetry (sea plane only; ponds sit above sea level)
          vec2 duv = (vWW.xz - uDepthRect.xy) / uDepthRect.zw;
          bool inMap = vWW.y < 0.5 && all(greaterThan(duv, vec2(0.0))) && all(lessThan(duv, vec2(1.0)));
          wDepth = inMap ? texture2D(uDepth, duv).r * 25.5 : 25.0;
          float calm = 0.45 + 0.55 * smoothstep(0.0, 4.0, wDepth); // waves flatten in the shallows
          // a gentle domain warp keeps the swells from tiling into a grid in the distance
          vec2 wp = vWW.xz + (vec2(vnoise(vWW.xz * 0.004), vnoise(vWW.xz * 0.004 + 7.3)) - 0.5) * 30.0;
          vec2 g = waveGrad(wp, uTime) * wAtten * calm;
          vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          // surf: bands rolling in towards the beach, broken up by noise
          float nb = vnoise(vWW.xz * 0.08 + uTime * 0.05);
          float bands = smoothstep(0.55, 1.0, sin(wDepth * 2.2 - uTime * 1.4 + nb * 5.0) * 0.5 + 0.5);
          wFoam = inMap ? (smoothstep(2.2, 0.4, wDepth) * bands * (0.4 + 0.6 * nb) + smoothstep(0.5, 0.05, wDepth) * 0.8) : 0.0;
          wFoam *= smoothstep(0.35, 0.65, vnoise(vWW.xz * 0.9 + vec2(uTime * 0.3, 0.0)) + 0.25);
          // glints: tiny facets catching the sun, twinkling
          float sp = vnoise(vWW.xz * 3.1 + vec2(uTime * 1.7, -uTime * 1.1)) * vnoise(vWW.xz * 5.3 - vec2(uTime * 0.9, uTime * 1.9));
          wGlint = 0.25 + 9.0 * pow(sp, 3.0);
        }`)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        float depthTint = fbm(vWW.xz * 0.002);
        diffuseColor.rgb = mix(vec3(0.02, 0.042, 0.05), vec3(0.032, 0.06, 0.066), depthTint);
      `)
      .replace('#include <lights_physical_fragment>', /* glsl */`
        // wave slopes too small to resolve become roughness (Toksvig-style), so the far Bay blurs the sky and
        // spreads the sun into a glitter path
        {
          float lost = 0.028 * (1.0 - wAtten * wAtten) + 0.004;
          float a0 = 0.035 * 0.035;
          roughnessFactor = sqrt(sqrt(a0 * a0 + 2.0 * lost));
        }
        // shallows: the sandy bottom shows through, greener; surf is white and rough
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.11, 0.085), smoothstep(7.0, 0.5, wDepth) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.8, 0.8), wFoam);
        roughnessFactor = mix(roughnessFactor, 0.9, wFoam);
        #include <lights_physical_fragment>
        material.specularColor = vec3(0.02 * (1.0 - wFoam)); // water: n = 1.33`)
      .replace('#include <lights_fragment_end>', /* glsl */`
        #include <lights_fragment_end>
        reflectedLight.directSpecular *= wGlint;`);
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
