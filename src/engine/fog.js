// Height fog for every built-in material: a thin global haze plus a dense layer that hugs the water
// and the low ground, the way Karl the Fog pours in through the Golden Gate.
// It reuses THREE.Fog's uniforms so three keeps them in sync for free:
//   fog.near  -> density of the low layer at sea level (0 = none)
//   fog.far   -> integer part: how high the layer reaches (m); fractional part: global haze (x 0.0003 /m)
//   fog.color -> colour of the Karl layer (its isotropic part)
// On top of that the sky (sky.js) fills `fogAtmos` from its atmosphere model, so the haze takes the colour of
// the horizon sky in the direction you look (warm towards the sun, bluer away from it, distant hills go blue)
// and Karl glows where the sun shines through it. Those uniforms are shared by reference with every built-in
// material (see the ShaderLib patch below); with them unset (w = 0) the fog falls back to plain fogColor.
import * as THREE from 'three';

// Atmosphere terms for the fog, written by sky.js. Float32Arrays are shared by reference through
// UniformsUtils.clone, so one write reaches every material.
export const fogAtmos = {
  sunDir: new Float32Array([0.5, 0.6, 0.3, 0]),  // xyz: sun (or moon) direction; w: 1 once the sky has filled these in
  haze0: new Float32Array([0, 0, 0, 0.75]),      // rgb: haze (horizon sky) radiance, constant term; a: Mie g of the haze lobe
  haze1: new Float32Array(4),                    // rgb: linear term in mu = dot(view, sun)
  mie: new Float32Array(4),                      // rgb: strength of the forward-scattering lobe around the sun
  layer: new Float32Array([0, 0, 0, 0.6]),       // rgb: Karl's forward-scattering lobe; a: its g
  ext: new Float32Array([0.89, 1.0, 1.29, 0]),   // rgb: per-channel extinction of the haze (aerial perspective goes blue)
};
const FOG_UNIFORMS = {
  fogSunDir: { value: fogAtmos.sunDir }, fogHaze0: { value: fogAtmos.haze0 }, fogHaze1: { value: fogAtmos.haze1 },
  fogMie: { value: fogAtmos.mie }, fogLayer: { value: fogAtmos.layer }, fogExt: { value: fogAtmos.ext },
};
Object.assign(THREE.UniformsLib.fog, FOG_UNIFORMS);
for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogColor) Object.assign(u, FOG_UNIFORMS); }
export const fogUniforms = FOG_UNIFORMS;

// The colour functions, also used by the sky dome so the horizon and the fog match exactly.
export const GLSL_FOG_ATMOS = /* glsl */`
  uniform vec4 fogSunDir, fogHaze0, fogHaze1, fogMie, fogLayer, fogExt;
  float fogPhase(float mu, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5); }
  vec3 fogHazeColor(vec3 v) {
    float mu = dot(v, fogSunDir.xyz);
    return max(fogHaze0.rgb + fogHaze1.rgb * mu + fogMie.rgb * fogPhase(mu, fogHaze0.a), 0.0);
  }
  vec3 fogLayerColor(vec3 base, vec3 v) { return base + fogLayer.rgb * fogPhase(dot(v, fogSunDir.xyz), fogLayer.a); }
`;

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
  ${GLSL_FOG_ATMOS}
  // optical depths along the view ray: x = the low layer, y = the global haze
  vec2 heightFogDepths(vec3 world) {
    vec3 d = world - cameraPosition;
    float dist = length(d);
    float layerH = floor(fogFar);
    float haze = fract(fogFar) * 0.0003;
    float b = 1.0 / max(layerH, 1.0);
    float dy = d.y;
    float shape = abs(dy * b) > 1e-3 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0;
    float layer = exp(-b * max(cameraPosition.y, -50.0)) * shape;
    return vec2(fogNear * dist * layer, haze * dist);
  }
  float heightFog(vec3 world) { vec2 o = heightFogDepths(world); return 1.0 - exp(-(o.x + o.y)); }
  vec3 fogApply(vec3 col, vec3 world) {
    vec2 od = heightFogDepths(world);
    if (fogSunDir.w < 0.5) return mix(col, fogColor, 1.0 - exp(-(od.x + od.y)));
    vec3 d = world - cameraPosition;
    vec3 v = d / max(length(d), 1e-4);
    vec3 odH = od.y * fogExt.rgb;
    vec3 T = exp(-(od.x + odH));
    vec3 share = od.x / max(od.x + odH, vec3(1e-7));
    return col * T + mix(fogHazeColor(v), fogLayerColor(fogColor, v), share) * (1.0 - T);
  }
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  gl_FragColor.rgb = fogApply(gl_FragColor.rgb, vFogWorld);
#endif`;

// Uniforms shared by all of our custom shaders (same object handed to every material, so one write updates all).
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 },      // 0 day .. 1 full night: window lights, lamps
  uWet: { value: 0 },        // rain sheen on the streets
  uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
  uLamps: { value: null },   // street-light pools painted over the play area (see furniture.js)
  uWorldRect: { value: new THREE.Vector4(0, 0, 1, 1) },
};

// Adds our shared uniforms to a shader inside onBeforeCompile.
const SHARED_DECL = '\nuniform float uTime;\nuniform float uNight;\nuniform float uWet;\nuniform vec3 uSunDir;\nuniform sampler2D uLamps;\nuniform vec4 uWorldRect;\n';
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
