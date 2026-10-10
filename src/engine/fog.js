// Height fog for every built-in material: a thin global haze plus a dense layer that hugs the water
// and the low ground, the way Karl the Fog pours in through the Golden Gate.
// It reuses THREE.Fog's uniforms so three keeps them in sync for free:
//   fog.near -> density of the low layer at sea level (0 = none)
//   fog.far  -> integer part: how high the layer reaches (m); fractional part: global haze (x 0.0003 /m)
import * as THREE from 'three';

THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  uniform float fogNear;
  uniform float fogFar;
  float heightFog(vec3 world) {
    vec3 d = world - cameraPosition;
    float dist = length(d);
    float layerH = floor(fogFar);
    float haze = fract(fogFar) * 0.0003;
    float b = 1.0 / max(layerH, 1.0);
    float dy = d.y;
    float shape = abs(dy * b) > 1e-3 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0;
    float layer = exp(-b * max(cameraPosition.y, -50.0)) * shape;
    float integ = fogNear * dist * layer + haze * dist;
    return 1.0 - exp(-integ);
  }
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, heightFog(vFogWorld));
#endif`;

// Uniforms shared by all of our custom shaders (same object handed to every material, so one write updates all).
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 },      // 0 day .. 1 full night: window lights, lamps
  uWet: { value: 0 },        // rain sheen on the streets
  uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
};

// Adds our shared uniforms to a shader inside onBeforeCompile.
const SHARED_DECL = '\nuniform float uTime;\nuniform float uNight;\nuniform float uWet;\nuniform vec3 uSunDir;\n';
export function useShared(shader) {
  Object.assign(shader.uniforms, shared);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>' + SHARED_DECL);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>' + SHARED_DECL);
}

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// Chains an onBeforeCompile hook after whatever the material already has (CSM installs one).
export function addHook(material, hook) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    hook(shader, renderer);
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  const key = hook.toString().length + ':' + (material.name || '');
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key;
}
