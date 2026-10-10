// Screen-space sun shafts (crepuscular rays). Sky pixels (nothing drawn there: depth = far) around the sun form
// a mask, which three cheap radial-blur passes at reduced resolution smear towards the sun (8 taps each, with
// decreasing step, ~512 effective samples), so buildings, trees, the bridge and Karl's holes cut it into rays.
// The rays are added to the HDR image before tone mapping, tinted with the sunlight. How strong they are comes
// from the sky (skyLight.shafts: low sun, haze and fog make them stronger, overcast and night kill them).
import * as THREE from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { Quad, shaderMaterial, target } from './quad.js';
import { skyLight } from '../sky.js';

const maskFrag = /* glsl */`
uniform sampler2D depthMap;
uniform vec2 sunUV;
uniform float aspect, spread;
varying vec2 vUv;
void main() {
  float sky = step(0.9999995, texture2D(depthMap, vUv).r);
  vec2 d = vUv - sunUV; d.x *= aspect;
  float glow = exp(-dot(d, d) * spread);
  gl_FragColor = vec4(vec3(sky * glow), 1.0);
}`;
const blurFrag = /* glsl */`
uniform sampler2D map;
uniform vec2 sunUV;
uniform float stepLen;
varying vec2 vUv;
void main() {
  vec2 delta = (sunUV - vUv) * stepLen;
  vec2 uv = vUv;
  vec3 acc = vec3(0.0); float wsum = 0.0, w = 1.0;
  for (int i = 0; i < 8; i++) {
    acc += texture2D(map, uv).rgb * w; wsum += w;
    uv += delta; w *= 0.93;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`;
const frag = /* glsl */`
uniform sampler2D shaftsMap;
uniform vec3 shaftsColor;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(inputColor.rgb + texture2D(shaftsMap, uv).rgb * shaftsColor, inputColor.a);
}`;

const _v = new THREE.Vector3(), _f = new THREE.Vector3();
export class SunShaftsEffect extends Effect {
  constructor(camera, { resolutionScale = 0.35, intensity = 1 } = {}) {
    super('SunShaftsEffect', frag, {
      blendFunction: BlendFunction.SRC, attributes: EffectAttribute.DEPTH,
      uniforms: new Map([['shaftsMap', new THREE.Uniform(null)], ['shaftsColor', new THREE.Uniform(new THREE.Color(0, 0, 0))]]),
    });
    this.camera = camera;
    this.intensity = intensity;
    this.scale = resolutionScale;
    this.quad = new Quad();
    this.rtA = target(1, 1); this.rtB = target(1, 1);
    this.maskMat = shaderMaterial({ depthMap: { value: null }, sunUV: { value: new THREE.Vector2() }, aspect: { value: 1 }, spread: { value: 12 } }, maskFrag);
    this.blurMat = shaderMaterial({ map: { value: null }, sunUV: { value: new THREE.Vector2() }, stepLen: { value: 0.1 } }, blurFrag);
    this.uniforms.get('shaftsMap').value = this.rtB.texture;
    this.active = false;
  }
  setDepthTexture(depthTexture) { this.maskMat.uniforms.depthMap.value = depthTexture; }
  setSize(w, h) {
    const sw = Math.max(1, Math.round(w * this.scale)), sh = Math.max(1, Math.round(h * this.scale));
    this.rtA.setSize(sw, sh); this.rtB.setSize(sw, sh);
    this.maskMat.uniforms.aspect.value = w / h;
  }
  update(renderer) {
    const color = this.uniforms.get('shaftsColor').value;
    const cam = this.camera;
    cam.getWorldDirection(_f);
    const facing = _f.dot(skyLight.dir);
    const k = skyLight.shafts * this.intensity * THREE.MathUtils.smoothstep(facing, 0.05, 0.45);
    this.active = k > 0.003 && this.maskMat.uniforms.depthMap.value !== null;
    if (!this.active) { color.setRGB(0, 0, 0); return; }
    _v.copy(skyLight.dir).multiplyScalar(1e4).add(cam.position).project(cam);
    const sun = this.maskMat.uniforms.sunUV.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    this.blurMat.uniforms.sunUV.value.copy(sun);
    this.quad.render(renderer, this.maskMat, this.rtA);
    // three radial passes with ever finer steps: each tap of a pass lands between the taps of the previous one
    const passes = [[this.rtA, this.rtB, 1 / 8 * 0.9], [this.rtB, this.rtA, 1 / 64 * 0.9], [this.rtA, this.rtB, 1 / 512 * 0.9]];
    for (const [src, dst, len] of passes) {
      this.blurMat.uniforms.map.value = src.texture;
      this.blurMat.uniforms.stepLen.value = len;
      this.quad.render(renderer, this.blurMat, dst);
    }
    color.copy(skyLight.color).multiplyScalar(k);
  }
}
