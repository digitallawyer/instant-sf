// Eye adaptation. The scene's log-average luminance (centre weighted) is reduced on the GPU in three tiny
// passes (64x64 -> 8x8 -> 1x1), adapted over time (faster towards bright than towards dark, like an eye) and
// turned into an exposure that only partly compensates, so a dark street canyon opens up a little and a bright
// aerial over the Bay comes down a little, while night still looks like night. Nothing is read back to the CPU.
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';
import { Quad, shaderMaterial, target } from './quad.js';

const lumFrag = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec2 o = vec2(0.25 / 64.0);
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUv + vec2(i == 0 || i == 2 ? -o.x : o.x, i < 2 ? -o.y : o.y);
    vec3 c = texture2D(map, uv).rgb;
    s += log2(clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4, 64.0));
  }
  vec2 q = vUv - 0.5;
  float w = exp(-dot(q, q) * 5.0);     // centre-weighted metering
  gl_FragColor = vec4(s * 0.25 * w, w, 0.0, 1.0);
}`;
const reduceFrag = /* glsl */`
uniform sampler2D map;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 8;
  vec2 acc = vec2(0.0);
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) acc += texelFetch(map, base + ivec2(x, y), 0).rg;
  gl_FragColor = vec4(acc / 64.0, 0.0, 1.0); // averages keep half-float precision
}`;
const adaptFrag = /* glsl */`
uniform sampler2D map, prev;
uniform float dt, rateUp, rateDown, key, strength, minEV, maxEV, reset;
void main() {
  vec2 acc = vec2(0.0);
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) acc += texelFetch(map, ivec2(x, y), 0).rg;
  float target = acc.x / max(acc.y, 1e-4);
  float last = texelFetch(prev, ivec2(0), 0).r;
  float rate = target > last ? rateUp : rateDown;
  float a = reset > 0.5 ? target : last + (target - last) * (1.0 - exp(-dt * rate));
  float ev = clamp((log2(key) - a) * strength, minEV, maxEV);
  gl_FragColor = vec4(a, exp2(ev), target, 1.0);
}`;

const frag = /* glsl */`
uniform sampler2D exposureMap;
uniform float manualExposure;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb * texture2D(exposureMap, vec2(0.5)).g * manualExposure, inputColor.a);
}`;

export class AutoExposureEffect extends Effect {
  /**
   * @param {object} o
   * @param {number} o.key       log-average luminance that maps to exposure 1 (a typical daylight view)
   * @param {number} o.strength  0 = fixed exposure .. 1 = full compensation
   * @param {number} o.minEV     most it may darken (EV)
   * @param {number} o.maxEV     most it may brighten (EV)
   */
  constructor({ key = 0.14, strength = 0.55, minEV = -0.9, maxEV = 1.2, rateUp = 2.2, rateDown = 0.9 } = {}) {
    const exposureMap = new THREE.Uniform(null), manualExposure = new THREE.Uniform(1);
    super('AutoExposureEffect', frag, { blendFunction: BlendFunction.SRC, uniforms: new Map([['exposureMap', exposureMap], ['manualExposure', manualExposure]]) });
    this.quad = new Quad();
    this.lumRT = target(64, 64);
    this.redRT = target(8, 8, THREE.HalfFloatType, THREE.NearestFilter);
    this.adaptRT = [target(1, 1, THREE.HalfFloatType, THREE.NearestFilter), target(1, 1, THREE.HalfFloatType, THREE.NearestFilter)];
    this.lumMat = shaderMaterial({ map: { value: null } }, lumFrag);
    this.redMat = shaderMaterial({ map: { value: this.lumRT.texture } }, reduceFrag);
    this.adaptMat = shaderMaterial({
      map: { value: this.redRT.texture }, prev: { value: null }, dt: { value: 0.016 }, rateUp: { value: rateUp }, rateDown: { value: rateDown },
      key: { value: key }, strength: { value: strength }, minEV: { value: minEV }, maxEV: { value: maxEV }, reset: { value: 1 },
    }, adaptFrag);
    this.cur = 0;
    this.enabled = true;
    exposureMap.value = this.adaptRT[0].texture;
  }
  get manualExposure() { return this.uniforms.get('manualExposure').value; }
  set manualExposure(v) { this.uniforms.get('manualExposure').value = v; }
  get params() { return this.adaptMat.uniforms; }
  reset() { this.adaptMat.uniforms.reset.value = 1; }
  update(renderer, inputBuffer, dt) {
    if (!this.enabled) return;
    this.lumMat.uniforms.map.value = inputBuffer.texture;
    this.quad.render(renderer, this.lumMat, this.lumRT);
    this.quad.render(renderer, this.redMat, this.redRT);
    const src = this.adaptRT[this.cur], dst = this.adaptRT[1 - this.cur];
    const u = this.adaptMat.uniforms;
    u.prev.value = src.texture; u.dt.value = Math.min(0.1, dt || 0.016);
    this.quad.render(renderer, this.adaptMat, dst);
    u.reset.value = 0;
    this.cur = 1 - this.cur;
    this.uniforms.get('exposureMap').value = dst.texture;
  }
  // debug: [adapted log2 luminance, exposure, instantaneous log2 luminance]
  read(renderer) {
    const px = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.adaptRT[this.cur], 0, 0, 1, 1, px);
    return [...px].slice(0, 3).map(v => THREE.DataUtils.fromHalfFloat(v));
  }
}
