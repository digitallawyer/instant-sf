// The sky dome, the sun and the moon and the light they cast, and the environment map every glossy surface
// reflects. Everything is driven by one number: the time of day.
//
// The sky is a physically based single-scattering atmosphere (Rayleigh + Mie + ozone, in the spirit of
// Hillaire 2020 / Bruneton 2008) with a cheap multiple-scattering term: a transmittance LUT and a sky-view
// LUT are rendered on the GPU whenever the sun or the haze changes, and the dome samples the sky-view LUT.
// A small JS mirror of the same model gives the sunlight colour, the colour of the haze in every direction
// (handed to the fog chunk, see fog.js), the cloud lighting and the ambient irradiance, so the sky, the light
// and the fog always agree. Low sun is compensated by an "eye adaptation" gain so twilight stays readable.
import * as THREE from 'three';
import { shared, GLSL_NOISE, fogAtmos, fogUniforms, GLSL_FOG_ATMOS } from './fog.js';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// Where the sun is over San Francisco at a given hour, for an October day (close enough for a game).
export function sunPosition(hour) {
  const rise = 7.1, set = 18.65, noon = (rise + set) / 2;
  const day = (hour - rise) / (set - rise);
  const maxElev = 46;
  let elev;
  if (day >= 0 && day <= 1) elev = maxElev * Math.sin(Math.PI * day);
  else { const nightLen = 24 - (set - rise); const n = ((hour - set + 24) % 24) / nightLen; elev = -38 * Math.sin(Math.PI * Math.min(1, Math.max(0, n))); }
  const az = 180 + (hour - noon) * 15 * 1.05; // degrees from north, clockwise
  const e = elev * Math.PI / 180, a = az * Math.PI / 180;
  // x east, z south, y up
  return { elev, dir: new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize() };
}

// ---------------------------------------------------------------------------------------------------------
// Atmosphere model. Units: km. Planet and atmosphere radius, scattering / extinction coefficients per km.
const RG = 6360, RT = 6460, HT = Math.sqrt(RT * RT - RG * RG);
const BR = [5.802e-3, 13.558e-3, 33.1e-3], BMS = 3.996e-3, BME = 4.4e-3, BO = [0.65e-3, 1.881e-3, 0.085e-3];
const MSC = [0.35, 0.6, 1.0];       // tint of the multiply-scattered (sky) light
const E_SUN = 5.7;                  // solar irradiance at the top of the atmosphere, in scene light units
const ALT = 0.05;                   // viewer altitude for the sky (km)
const TERM_W = 0.012;               // softness of the terminator (cos units, ~0.7 degrees)
const MS = 0.6;                     // multiple scattering strength

const _e = [0, 0, 0];
function ext(h, mie, o) {
  const r = Math.exp(-h / 8), m = Math.exp(-h / 1.2) * mie, z = Math.max(0, 1 - Math.abs(h - 25) / 15);
  o[0] = BR[0] * r + BME * m + BO[0] * z; o[1] = BR[1] * r + BME * m + BO[1] * z; o[2] = BR[2] * r + BME * m + BO[2] * z;
  return o;
}
const rayTop = (r, mu) => -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + RT * RT));
// transmittance from radius r towards cos-zenith mu, to the top of the atmosphere, with a soft terminator
function trans(r, mu, mie, out, N = 24) {
  mu = Math.min(1, mu);
  const muH = -Math.sqrt(Math.max(0, r * r - RG * RG)) / r;
  const vis = smooth(-TERM_W, TERM_W, mu - muH);
  if (vis <= 0) { out[0] = out[1] = out[2] = 0; return out; }
  const m = Math.max(mu, muH + 1e-4), L = rayTop(r, m);
  let o0 = 0, o1 = 0, o2 = 0;
  for (let i = 0; i < N; i++) {
    const t0 = L * (i / N) ** 2, t1 = L * ((i + 1) / N) ** 2, t = (t0 + t1) / 2, dt = t1 - t0;
    ext(Math.max(0, Math.sqrt(r * r + t * t + 2 * r * t * m) - RG), mie, _e);
    o0 += _e[0] * dt; o1 += _e[1] * dt; o2 += _e[2] * dt;
  }
  out[0] = Math.exp(-o0) * vis; out[1] = Math.exp(-o1) * vis; out[2] = Math.exp(-o2) * vis;
  return out;
}
const hg = (mu, g) => (1 - g * g) / (4 * Math.PI * Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * mu), 1.5));
// single (+ approximate multiple) scattered radiance along v, sun direction s; Rayleigh and Mie kept apart
const _ts = [0, 0, 0], _tm = [0, 0, 0];
function inscatter(v, s, mie, R = [0, 0, 0], M = [0, 0, 0], N = 16) {
  R[0] = R[1] = R[2] = M[0] = M[1] = M[2] = 0;
  const r0 = RG + ALT, mu = v[1], disc = r0 * r0 * (mu * mu - 1) + RG * RG;
  const L = mu < 0 && disc > 0 ? -r0 * mu - Math.sqrt(disc) : rayTop(r0, mu);
  const nu = v[0] * s[0] + v[1] * s[1] + v[2] * s[2];
  const pR = 3 / (16 * Math.PI) * (1 + nu * nu), pM = hg(nu, 0.8), pMS = MS / (4 * Math.PI);
  const T = [1, 1, 1];
  for (let i = 0; i < N; i++) {
    const t0 = L * (i / N) ** 2, t1 = L * ((i + 1) / N) ** 2, t = (t0 + t1) / 2, dt = t1 - t0;
    const px = v[0] * t, py = r0 + v[1] * t, pz = v[2] * t;
    const r = Math.hypot(px, py, pz), h = r - RG, mus = (px * s[0] + py * s[1] + pz * s[2]) / r;
    trans(r, mus, mie, _ts, 12);
    trans(Math.max(r, RG + 12), mus + 0.06, mie, _tm, 12);
    _tm[0] = _tm[1] = _tm[2] = 0.25 * _tm[0] + 0.45 * _tm[1] + 0.3 * _tm[2];
    const dR = Math.exp(-h / 8), dM = Math.exp(-h / 1.2) * mie;
    ext(h, mie, _e);
    for (let c = 0; c < 3; c++) {
      const st = Math.exp(-_e[c] * dt), f = T[c] * (1 - st) / _e[c];
      const ms = pMS * _tm[c] * MSC[c];
      R[c] += E_SUN * BR[c] * dR * (pR * _ts[c] + ms) * f;
      M[c] += E_SUN * BMS * dM * (pM * _ts[c] + ms) * f;
      T[c] *= st;
    }
  }
  return [R[0] + M[0], R[1] + M[1], R[2] + M[2]];
}
const dirAt = (elDeg, cosAz, sinAz) => { const e = elDeg * Math.PI / 180; return [Math.cos(e) * cosAz, Math.sin(e), Math.cos(e) * sinAz]; };

// Everything the JS side needs from the atmosphere for one sun elevation and haze level, in a frame where the
// sun lies along +x (azimuth 0). Radiances exclude the adaptation gain.
function solveAtmosphere(elev, mie) {
  const e = elev * Math.PI / 180, s = [Math.cos(e), Math.sin(e), 0];
  const out = {};
  out.sunT = trans(RG + ALT, s[1], mie, [0, 0, 0], 48);
  out.cloudT = trans(RG + 2.5, s[1], mie, [0, 0, 0], 48);
  out.zen = inscatter([0, 1, 0], s, mie);
  // sky irradiance on a horizontal plane: three rings of six samples
  const Esky = [0, 0, 0];
  for (const [el, lo, hi] of [[15, 0, 30], [45, 30, 60], [75, 60, 90]]) {
    const w = 2 * Math.PI * (Math.sin(hi * Math.PI / 180) - Math.sin(lo * Math.PI / 180)) / 6 * Math.sin(el * Math.PI / 180);
    for (let k = 0; k < 6; k++) {
      const a = (k + 0.5) / 6 * Math.PI * 2, L = inscatter(dirAt(el, Math.cos(a), Math.sin(a)), s, mie);
      Esky[0] += L[0] * w; Esky[1] += L[1] * w; Esky[2] += L[2] * w;
    }
  }
  out.Esky = Esky;
  // haze colour fit along the horizon: c0 + c1 * mu + K * phase(mu)
  const R = [0, 0, 0], M = [0, 0, 0];
  const dT = dirAt(2, 1, 0), dS = dirAt(2, 0, 1), dA = dirAt(2, -1, 0);
  const muT = dT[0] * s[0] + dT[1] * s[1], muS = dS[1] * s[1], muA = dA[0] * s[0] + dA[1] * s[1];
  const LT = inscatter(dT, s, mie, R, M), LS = inscatter(dS, s, mie, R, M), LA = inscatter(dA, s, mie, R, M);
  const g = 0.75, pT = hg(muT, g);
  out.haze0 = [0, 0, 0]; out.haze1 = [0, 0, 0]; out.mie = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c1 = (LS[c] - LA[c]) / Math.max(1e-3, muS - muA), c0 = LS[c] - c1 * muS;
    out.haze0[c] = c0; out.haze1[c] = c1;
    out.mie[c] = Math.max(0, (LT[c] - (c0 + c1 * muT)) / pT);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// GPU side: the same model, rendered into a transmittance LUT and a sky-view LUT.
const GLSL_ATMO = /* glsl */`
#define PI 3.14159265
const float RG = ${RG.toFixed(1)}, RT = ${RT.toFixed(1)}, HT = ${HT.toFixed(4)};
const vec3 BR = vec3(${BR.map(v => v.toExponential(4)).join(',')});
const float BMS = ${BMS.toExponential(4)}, BME = ${BME.toExponential(4)};
const vec3 BO = vec3(${BO.map(v => v.toExponential(4)).join(',')});
uniform float uMie;
vec3 atmExt(float h) { float r = exp(-h / 8.0), m = exp(-h / 1.2) * uMie, z = max(0.0, 1.0 - abs(h - 25.0) / 15.0); return BR * r + BME * m + BO * z; }
float rayTop(float r, float mu) { return -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + RT * RT, 0.0)); }
`;
const quadVert = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const TW = 256, TH = 64, SW = 192, SH = 108;
const transFrag = /* glsl */`
precision highp float;
${GLSL_ATMO}
varying vec2 vUv;
void main() {
  float xm = clamp((vUv.x - 0.5 / ${TW}.0) / (1.0 - 1.0 / ${TW}.0), 0.0, 1.0);
  float xr = clamp((vUv.y - 0.5 / ${TH}.0) / (1.0 - 1.0 / ${TH}.0), 0.0, 1.0);
  float rho = HT * xr, r = sqrt(rho * rho + RG * RG);
  float dmin = RT - r, dmax = rho + HT, d = dmin + xm * (dmax - dmin);
  float mu = d < 1e-3 ? 1.0 : clamp((HT * HT - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);
  vec3 od = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float t0 = d * pow(float(i) / 40.0, 2.0), t1 = d * pow(float(i + 1) / 40.0, 2.0), t = 0.5 * (t0 + t1);
    od += atmExt(max(0.0, sqrt(r * r + t * t + 2.0 * r * t * mu) - RG)) * (t1 - t0);
  }
  gl_FragColor = vec4(exp(-od), 1.0);
}`;
const GLSL_TRANS_LOOKUP = /* glsl */`
uniform sampler2D uTrans;
vec3 atmTrans(float r, float mu) {
  mu = min(mu, 1.0);
  float rho = sqrt(max(r * r - RG * RG, 0.0)), muH = -rho / r;
  float vis = smoothstep(-${TERM_W}, ${TERM_W}, mu - muH);
  float m = max(mu, muH + 1e-4), d = rayTop(r, m);
  float dmin = RT - r, dmax = rho + HT;
  vec2 uv = vec2((d - dmin) / (dmax - dmin), rho / HT);
  uv = vec2(0.5 / ${TW}.0, 0.5 / ${TH}.0) + uv * vec2(1.0 - 1.0 / ${TW}.0, 1.0 - 1.0 / ${TH}.0);
  return texture2D(uTrans, uv).rgb * vis;
}`;
const skyViewFrag = /* glsl */`
precision highp float;
${GLSL_ATMO}
${GLSL_TRANS_LOOKUP}
uniform vec3 uSun;
varying vec2 vUv;
float hgp(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5)); }
void main() {
  float phi = vUv.x * vUv.x * PI;
  float a = 2.0 * vUv.y - 1.0, l = sign(a) * a * a * 0.5 * PI;
  vec3 v = vec3(cos(l) * cos(phi), sin(l), cos(l) * sin(phi));
  float r0 = RG + ${ALT}, mu = v.y, disc = r0 * r0 * (mu * mu - 1.0) + RG * RG;
  float L = (mu < 0.0 && disc > 0.0) ? -r0 * mu - sqrt(disc) : rayTop(r0, mu);
  float nu = dot(v, uSun);
  float pR = 3.0 / (16.0 * PI) * (1.0 + nu * nu), pM = hgp(nu, 0.8), pMS = ${MS} / (4.0 * PI);
  vec3 acc = vec3(0.0), T = vec3(1.0);
  for (int i = 0; i < 28; i++) {
    float t0 = L * pow(float(i) / 28.0, 2.0), t1 = L * pow(float(i + 1) / 28.0, 2.0), t = 0.5 * (t0 + t1), dt = t1 - t0;
    vec3 p = vec3(0.0, r0, 0.0) + v * t;
    float r = length(p), h = r - RG, mus = dot(p, uSun) / r;
    vec3 ts = atmTrans(r, mus);
    vec3 tm = vec3(dot(atmTrans(max(r, RG + 12.0), mus + 0.06), vec3(0.25, 0.45, 0.3))) * vec3(${MSC.join(',')});
    float dR = exp(-h / 8.0), dM = exp(-h / 1.2) * uMie;
    vec3 e = atmExt(h), st = exp(-e * dt);
    vec3 S = ${E_SUN.toFixed(3)} * (BR * dR * (pR * ts + pMS * tm) + BMS * dM * (pM * ts + pMS * tm));
    acc += S * T * (1.0 - st) / e;
    T *= st;
  }
  gl_FragColor = vec4(acc, 1.0);
}`;

// The sky as seen (no desaturation), prefiltered for mirror-like surfaces: the Bay reflects this (water.js).
export const skyReflection = { texture: null, listeners: new Set() };
// The sun as the post-processing sees it (renderer.js): true direction, normalised colour, how strong the sun
// shafts should be (low sun, haze and Karl make them stronger; overcast and night kill them) and the exposure
// bias by time of day.
export const skyLight = { dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), elev: 0, shafts: 0, karl: 0, overcast: 0 };

// ---------------------------------------------------------------------------------------------------------
// The dome
const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
#define PI 3.14159265
uniform sampler2D uSkyView;
uniform vec2 uSunH;
uniform vec3 uSunTrue, uSunDisc, uMoonDir, uGround, uNightZen, uNightHor, uCloudSun, uCloudAmb, uLid, fogColor;
uniform float uGain, uFog, uTime, uEnv, uNightAmt, uCloud, uOvercast, uMoon;
varying vec3 vDir;
${GLSL_NOISE}
${GLSL_FOG_ATMOS}
vec3 skyView(vec3 d) {
  float l = asin(clamp(d.y, -1.0, 1.0));
  float len = length(d.xz);
  float cphi = len > 1e-5 ? dot(d.xz / len, uSunH) : 1.0;
  float u = sqrt(acos(clamp(cphi, -1.0, 1.0)) / PI);
  float v = 0.5 + 0.5 * sign(l) * sqrt(abs(l) / (0.5 * PI));
  return texture2D(uSkyView, vec2(u, v)).rgb * uGain;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = skyView(vec3(d.x, max(h, 0.0), d.z));
  // the night sky: a faint blue zenith and the city's light pollution low down
  col += mix(uNightHor, uNightZen, pow(up, 0.35));
  float sd = dot(d, uSunTrue);
  // stars (dimmed by the air near the horizon)
  if (uNightAmt > 0.01 && h > 0.0) {
    vec3 g = floor(d * 420.0);
    float s = step(0.9975, hash13(g)) * hash13(g + 7.0);
    col += vec3(s) * uNightAmt * smoothstep(0.0, 0.3, h) * 0.9;
  }
  // the sun disc, with limb darkening (kept out of the environment maps to avoid fireflies)
  if (uEnv < 0.5) {
    float r = acos(clamp(sd, -1.0, 1.0)) / 0.0075;
    col += uSunDisc * (1.0 - smoothstep(0.85, 1.0, r)) * (0.55 + 0.45 * sqrt(max(0.0, 1.0 - r * r)));
  }
  // the moon
  if (uMoon > 0.001 && uEnv < 1.5) {
    float md = dot(d, uMoonDir), r = acos(clamp(md, -1.0, 1.0)) / 0.0085;
    if (r < 1.6) {
      vec3 t = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), b = cross(t, uMoonDir);
      vec2 q = vec2(dot(d, t), dot(d, b)) / 0.0085;
      float mare = 0.75 + 0.25 * fbm(q * 2.3 + 4.0);
      col += vec3(0.95, 0.93, 0.88) * uMoon * 1.6 * mare * (1.0 - smoothstep(0.9, 1.0, r));
      col += vec3(0.5, 0.55, 0.7) * uMoon * 0.04 * exp(-r * 1.2);
    }
  }
  // clouds: a drifting fbm deck, lit by the sun at cloud height (still lit after sunset) and the sky
  if (h > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (h + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv * 1.3);
    float c = smoothstep(0.62 - uCloud * 0.32, 0.92, n) * smoothstep(0.0, 0.12, h);
    float thick = smoothstep(0.62, 1.0, n);
    float fwd = pow(max(sd, 0.0), 5.0);
    vec3 lit = uCloudAmb * mix(1.15, 0.75, thick) + uCloudSun * (0.22 + 1.4 * fwd * (1.0 - 0.6 * thick)) * mix(1.0, 0.5, thick);
    col = mix(col, lit, c * 0.9);
  }
  // overcast: a flat lid, a little brighter overhead
  col = mix(col, uLid * (0.85 + 0.25 * up), uOvercast * 0.85 * smoothstep(-0.02, 0.1, h));
  // below the horizon: the Bay / ground, so reflections in glass don't show sky underneath
  // (the water's reflection map sees the horizon there instead: a ray reflected downwards off a wave hits
  // the water again at a grazing angle and reflects the sky near the horizon)
  if (h < 0.0) col = uEnv > 1.5 ? col * 0.85 : mix(col, uGround, smoothstep(0.0, -0.06, h));
  // the haze and Karl swallow the horizon
  col = mix(col, fogHazeColor(d), 0.45 * (1.0 - smoothstep(0.0, 0.05, abs(h))) * (1.0 - uOvercast));
  col = mix(col, fogLayerColor(fogColor, d), uFog * (1.0 - smoothstep(-0.05, 0.35 + 0.4 * uFog, h)));
  // the light the city receives from the sky is a little less saturated than the sky looks (bounce off buildings)
  if (uEnv > 0.5 && uEnv < 1.5) col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 0.75);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(renderer, scene) {
  // --- LUTs
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false };
  const transRT = new THREE.WebGLRenderTarget(TW, TH, rtOpts);
  const viewRT = new THREE.WebGLRenderTarget(SW, SH, rtOpts);
  const uMie = { value: 1.5 };
  const transMat = new THREE.ShaderMaterial({ uniforms: { uMie }, vertexShader: quadVert, fragmentShader: transFrag, depthTest: false, depthWrite: false });
  const viewMat = new THREE.ShaderMaterial({ uniforms: { uMie, uTrans: { value: transRT.texture }, uSun: { value: new THREE.Vector3() } }, vertexShader: quadVert, fragmentShader: skyViewFrag, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), transMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function renderLUT(mat, rt) {
    const prev = renderer.getRenderTarget(), prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    quad.material = mat;
    renderer.setRenderTarget(rt);
    renderer.render(quadScene, quadCam);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = prevXr;
  }

  const uniforms = {
    uSkyView: { value: viewRT.texture }, uSunH: { value: new THREE.Vector2(1, 0) }, uSunTrue: { value: new THREE.Vector3(0, 1, 0) },
    uSunDisc: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: 0 },
    uGround: { value: new THREE.Color() }, uNightZen: { value: new THREE.Color() }, uNightHor: { value: new THREE.Color() },
    uCloudSun: { value: new THREE.Color() }, uCloudAmb: { value: new THREE.Color() }, uLid: { value: new THREE.Color() },
    fogColor: { value: new THREE.Color() }, uGain: { value: 1 }, uFog: { value: 0 }, uTime: shared.uTime,
    uEnv: { value: 0 }, uNightAmt: { value: 0 }, uCloud: { value: 0.35 }, uOvercast: { value: 0 },
    ...fogUniforms,
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  // Environment: the same dome rendered into a cube and prefiltered for PBR reflections. Two flavours: the
  // lighting one (slightly desaturated, no sun or moon disc) and a reflection one for the water (the sky as seen).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(dome.geometry, mat.clone());
  envDome.material.uniforms = { ...uniforms, uEnv: { value: 1 } };
  envScene.add(envDome);
  const reflScene = new THREE.Scene();
  const reflDome = new THREE.Mesh(dome.geometry, mat.clone());
  reflDome.material.uniforms = { ...uniforms, uEnv: { value: 2 } };
  reflScene.add(reflDome);
  let envRT = null, reflRT = null;
  const reflection = skyReflection;

  scene.fog = new THREE.Fog(0xffffff, 0, 400);

  const state = { hour: 17.6, karl: 0.0, haze: 0, overcast: 0, clouds: 0.35, sunDir: shared.uSunDir.value, sunColor: new THREE.Color(), sunIntensity: 3, ambient: 1, elev: 0, lastEnvKey: '', gain: 1, mie: 1.5, reflection };
  let atmoKey = '', atmo = null, lastMie = -1;
  const C = (a, k = 1) => new THREE.Color(a[0] * k, a[1] * k, a[2] * k);

  function apply() {
    const { elev, dir } = sunPosition(state.hour);
    state.elev = elev;
    const fogAmt = state.karl, oc = state.overcast;
    // coastal haze; Karl and overcast thicken the aerosol layer
    const mie = Math.round((1.5 + fogAmt * 2.0 + oc * 1.2 + state.haze * 2000) * 20) / 20;
    state.mie = mie;
    const key = elev.toFixed(1) + ':' + mie;
    if (key !== atmoKey) {
      atmoKey = key;
      atmo = solveAtmosphere(elev, mie);
      uMie.value = mie;
      if (mie !== lastMie) { lastMie = mie; renderLUT(transMat, transRT); }
      const e = elev * Math.PI / 180;
      viewMat.uniforms.uSun.value.set(Math.cos(e), Math.sin(e), 0);
      renderLUT(viewMat, viewRT);
    }
    const night = 1 - smooth(-8, 0, elev);      // the city's lights come on
    const nightSky = 1 - smooth(-12, -5, elev); // the night sky takes over from twilight
    // eye adaptation: hold the zenith above a floor that falls slowly through twilight
    const Lz = lum(atmo.zen), floor = 0.004 + 0.03 * smooth(-9, 1, elev);
    const G = Math.min(60, Math.max(1, floor / Math.max(Lz, 1e-9)));
    state.gain = G;

    shared.uSunDir.value.copy(dir);
    uniforms.uSunTrue.value.copy(dir);
    uniforms.uSunH.value.set(dir.x, dir.z).normalize();
    uniforms.uGain.value = G;

    // sunlight at the ground
    const sunE = atmo.sunT.map(v => v * E_SUN * G);
    const sunAtt = (1 - fogAmt * 0.75) * (1 - oc * 0.85);
    const sunH = Math.max(0, dir.y);
    const Esky = atmo.Esky.map(v => v * G);
    const Edir = sunE.map(v => v * sunH * sunAtt);
    // what the city (and its fog) glows with at night
    const city = [0.022, 0.016, 0.011].map(v => v * night);
    // the Bay and the land below the horizon, lit by the sun and the sky
    const ground = Edir.map((v, i) => 0.09 * (v + Esky[i] * (1 - oc * 0.4)) / Math.PI + city[i] * 0.6);
    uniforms.uGround.value.copy(C(ground));
    uniforms.uNightZen.value.setRGB(0.005, 0.0075, 0.016).multiplyScalar(nightSky);
    uniforms.uNightHor.value.setRGB(0.03, 0.025, 0.022).multiplyScalar(nightSky);
    // the sun disc: bright enough to bloom, clamped so the half-float buffers never overflow
    const discL = Math.min(40, lum(sunE) / (Math.PI * 0.0075 * 0.0075));
    const sunN = Math.max(1e-6, Math.max(...atmo.sunT));
    uniforms.uSunDisc.value.setRGB(atmo.sunT[0] / sunN, atmo.sunT[1] / sunN, atmo.sunT[2] / sunN).multiplyScalar(discL * (1 - fogAmt * 0.85) * (1 - oc * 0.95));
    // clouds: sunlight at 2.5 km (pink after sunset) and the sky's light
    uniforms.uCloudSun.value.copy(C(atmo.cloudT, E_SUN * G * 0.32 * (1 - oc * 0.6)));
    uniforms.uCloudAmb.value.copy(C(Esky.map((v, i) => v / Math.PI * 0.9 + ground[i] * 0.5 + city[i] * 1.8)));
    // overcast lid
    const lid = Edir.map((v, i) => 0.42 * (v * 0.6 + Esky[i]) / Math.PI);
    const lidL = lum(lid);
    const grey = [0.93, 0.96, 1.0];
    uniforms.uLid.value.setRGB(grey[0] * lidL + city[0], grey[1] * lidL + city[1], grey[2] * lidL + city[2]);
    uniforms.uOvercast.value = oc;
    uniforms.uNightAmt.value = 1 - smooth(-12, -4, elev);
    uniforms.uCloud.value = state.clouds;
    shared.uNight.value = 1 - smooth(-6, 6, elev);

    // the moon: high in the opposite sky (where main.js aims the night shadows)
    const m = sunPosition((state.hour + 12) % 24).dir; m.y = Math.max(0.35, m.y); m.normalize();
    uniforms.uMoonDir.value.copy(m);
    uniforms.uMoon.value = smooth(-2, -10, elev) * (1 - oc * 0.9) * (1 - fogAmt * 0.7);

    // Karl: lit from above by the sun and sky, glowing orange from the street lights at night
    const layer = Edir.map((v, i) => 1.15 * (v * 0.5 + Esky[i]) / Math.PI * grey[i]);
    const layerL = lum(layer);
    for (let i = 0; i < 3; i++) layer[i] = lerp(layerL * grey[i], layer[i], 0.45) + city[i] * 1.6; // droplets scatter neutrally
    const fogCol = C(layer);
    scene.fog.color.copy(fogCol);
    uniforms.fogColor.value.copy(fogCol);
    uniforms.uFog.value = Math.min(1, fogAmt * 1.4);
    scene.fog.near = fogAmt * fogAmt * 0.006;                       // low layer density
    const haze = Math.min(0.999, (0.000035 + fogAmt * 0.00012 + oc * 0.00008 + state.haze) / 0.0003);
    scene.fog.far = Math.floor(50 + fogAmt * 110) + haze;          // layer height + haze

    // the haze takes the colour of the horizon sky in each direction (see fog.js)
    const hz = Math.min(1, oc * 0.85 + fogAmt * 0.5), keep = 1 - hz;
    for (let c = 0; c < 3; c++) {
      const base = atmo.haze0[c] * G + city[c] * 0.8;
      const grey3 = oc > fogAmt ? lidL * grey[c] + city[c] : layer[c];
      fogAtmos.haze0[c] = lerp(base, grey3, hz);
      fogAtmos.haze1[c] = atmo.haze1[c] * G * keep;
      fogAtmos.mie[c] = atmo.mie[c] * G * keep;
      fogAtmos.layer[c] = sunE[c] * sunAtt * 0.35;
    }
    fogAtmos.haze0[3] = 0.75; fogAtmos.layer[3] = 0.6;
    const fd = shared.uSunDir.value;
    fogAtmos.sunDir[0] = dir.x; fogAtmos.sunDir[1] = dir.y; fogAtmos.sunDir[2] = dir.z; fogAtmos.sunDir[3] = 1;

    // sunlight for the CSM lights; below the horizon the light becomes the moon
    const sc = sunE.map(v => v * sunAtt);
    const sMax = Math.max(1e-6, ...sc);
    state.sunColor.setRGB(sc[0] / sMax, sc[1] / sMax, sc[2] / sMax);
    state.sunIntensity = sMax;
    state.ambient = Math.min(1, Math.max(0.04, lum(Esky) / 0.5));
    if (elev < -1.5) {
      state.sunColor.setRGB(0.55, 0.65, 0.95);
      state.sunIntensity = 0.12 * smooth(-1.5, -9, elev) * (1 - fogAmt) * (1 - oc * 0.7);
      fd.copy(m);
    }

    skyLight.dir.copy(dir);
    skyLight.color.setRGB(atmo.sunT[0] / sunN, atmo.sunT[1] / sunN, atmo.sunT[2] / sunN);
    skyLight.elev = elev; skyLight.karl = fogAmt; skyLight.overcast = oc;
    skyLight.shafts = smooth(-1.5, 1.5, elev) * (1 - 0.7 * smooth(8, 40, elev)) * (0.14 + fogAmt * 0.9 + Math.min(0.6, state.haze * 2000)) * (1 - oc * 0.85);

    const envKey = [Math.round(elev * 2), Math.round(fogAmt * 20), Math.round(state.clouds * 10), Math.round(oc * 10), mie].join();
    if (envKey !== state.lastEnvKey) {
      state.lastEnvKey = envKey;
      const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 1.0;
      const rr = pmrem.fromScene(reflScene, 0, 0.1, 200);
      if (reflRT) reflRT.dispose();
      reflRT = rr;
      reflection.texture = rr.texture;
      for (const f of reflection.listeners) f(rr.texture);
    }
  }

  return {
    state,
    dome,
    setHour(h) { state.hour = ((h % 24) + 24) % 24; apply(); },
    setKarl(v) { state.karl = Math.min(1, Math.max(0, v)); apply(); },
    setClouds(v) { state.clouds = v; apply(); },
    follow(camera) { dome.position.copy(camera.position); },
    apply,
  };
}
