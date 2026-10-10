// The film look, applied after AgX: a gentle S-curve, split toning (cool teal shadows, warm highlights), a
// luminance-preserving saturation with vibrance, a soft vignette and fine animated luma grain. Analytic, so it
// costs a handful of ALU ops and no texture fetches; it replaces the old hue/saturation, brightness/contrast and
// vignette effects.
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

const frag = /* glsl */`
uniform float contrast, saturation, vibrance, split, vignette, vignetteOffset, grain;
uniform vec3 shadowTint, highlightTint, lift;
float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  vec3 p = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));   // work in a perceptual space
  // film curve: blend towards a smoothstep S, pivoting around mid grey; a touch of lift in the blacks
  vec3 s = p * p * (3.0 - 2.0 * p);
  p = mix(p, s, contrast) + lift * (1.0 - p);
  float l = dot(p, W);
  // split toning
  float sh = 1.0 - smoothstep(0.0, 0.5, l), hi = smoothstep(0.5, 1.0, l);
  p += shadowTint * sh * split;
  p *= mix(vec3(1.0), highlightTint, hi * split);
  // saturation with vibrance (muted colours gain more than already saturated ones)
  l = dot(p, W);
  float chroma = max(p.r, max(p.g, p.b)) - min(p.r, min(p.g, p.b));
  p = mix(vec3(l), p, saturation + vibrance * (1.0 - chroma));
  // vignette
  vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
  p *= 1.0 - vignette * smoothstep(vignetteOffset, vignetteOffset + 0.75, length(q));
  // grain: triangular-distributed luma noise, strongest in the mid tones, a new pattern every frame
  vec2 fc = uv * resolution;
  float t = fract(time * 7.31) * 113.0;
  float n = gHash(fc + t) + gHash(fc + t + 41.7) - 1.0;
  p += n * grain * (0.35 + 0.65 * (1.0 - abs(2.0 * l - 1.0)));
  outputColor = vec4(pow(max(p, 0.0), vec3(2.2)), inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor({ contrast = 0.22, saturation = 1.12, vibrance = 0.12, split = 1, vignette = 0.32, vignetteOffset = 0.35, grain = 0.018,
    shadowTint = new THREE.Vector3(-0.012, 0.004, 0.016), highlightTint = new THREE.Vector3(1.03, 1.0, 0.955), lift = new THREE.Vector3(0.006, 0.008, 0.011) } = {}) {
    const U = v => new THREE.Uniform(v);
    super('GradeEffect', frag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['contrast', U(contrast)], ['saturation', U(saturation)], ['vibrance', U(vibrance)], ['split', U(split)], ['vignette', U(vignette)],
        ['vignetteOffset', U(vignetteOffset)], ['grain', U(grain)], ['shadowTint', U(shadowTint)], ['highlightTint', U(highlightTint)], ['lift', U(lift)]]),
    });
  }
  set(params) { for (const k in params) { const u = this.uniforms.get(k); if (u) u.value = params[k]; } }
}
