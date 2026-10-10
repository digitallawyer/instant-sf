// The sky dome, the sun and the light it casts, and the environment map every glossy surface reflects.
// Everything is driven by one number: the time of day.
import * as THREE from 'three';
import { shared, GLSL_NOISE } from './fog.js';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Palettes keyed by sun elevation in degrees. Colours are linear-ish RGB.
const KEYS = [
  { e: -18, zen: [0.004, 0.006, 0.016], hor: [0.06, 0.045, 0.04], sun: [0.35, 0.42, 0.65], sunI: 0.0, amb: 0.1 },
  { e: -8, zen: [0.012, 0.02, 0.06], hor: [0.14, 0.1, 0.12], sun: [0.5, 0.4, 0.55], sunI: 0.0, amb: 0.14 },
  { e: -2, zen: [0.04, 0.06, 0.16], hor: [0.62, 0.32, 0.22], sun: [1.0, 0.4, 0.2], sunI: 0.15, amb: 0.3 },
  { e: 3, zen: [0.08, 0.14, 0.32], hor: [1.0, 0.52, 0.28], sun: [1.0, 0.52, 0.26], sunI: 2.6, amb: 0.55 },
  { e: 10, zen: [0.1, 0.24, 0.55], hor: [0.95, 0.74, 0.55], sun: [1.0, 0.76, 0.52], sunI: 4.2, amb: 0.8 },
  { e: 25, zen: [0.08, 0.24, 0.62], hor: [0.62, 0.75, 0.9], sun: [1.0, 0.93, 0.84], sunI: 4.6, amb: 1.0 },
  { e: 60, zen: [0.06, 0.22, 0.6], hor: [0.58, 0.72, 0.9], sun: [1.0, 0.96, 0.92], sunI: 4.8, amb: 1.0 },
];
function palette(elev) {
  let i = 0;
  while (i < KEYS.length - 2 && elev > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(a.e, b.e, elev);
  const mix3 = (p, q) => p.map((v, k) => lerp(v, q[k], t));
  return { zen: mix3(a.zen, b.zen), hor: mix3(a.hor, b.hor), sun: mix3(a.sun, b.sun), sunI: lerp(a.sunI, b.sunI, t), amb: lerp(a.amb, b.amb, t) };
}

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

const skyVert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
uniform vec3 uZenith, uHorizon, uSunColor, uSunDir, uFogColor;
uniform float uFog, uTime, uEnv, uNightAmt, uCloud;
varying vec3 vDir;
${GLSL_NOISE}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  // Mie-ish glow around the sun, stronger near the horizon
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 200.0) * 0.5) * (1.0 - 0.6 * up);
  // horizon brightening band
  col += uHorizon * 0.25 * exp(-abs(h) * 18.0);
  // clouds: a drifting fbm deck
  if (h > 0.0 && uCloud > 0.0) {
    vec2 uv = d.xz / (h + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv * 1.3);
    float c = smoothstep(0.62 - uCloud * 0.32, 0.92, n) * smoothstep(0.0, 0.12, h);
    vec3 cloudLit = mix(uHorizon * 1.05, uSunColor * 1.2 + uZenith * 0.3, pow(sd, 3.0) * 0.6 + 0.25);
    cloudLit = mix(cloudLit, vec3(0.025, 0.03, 0.05), uNightAmt * 0.85);
    col = mix(col, cloudLit, c * 0.85);
  }
  // stars
  if (uNightAmt > 0.01 && h > 0.0) {
    vec3 g = floor(d * 420.0);
    float s = step(0.9975, hash13(g)) * hash13(g + 7.0);
    col += vec3(s) * uNightAmt * smoothstep(0.0, 0.25, h) * 1.4;
  }
  // sun disc (kept out of the environment map to avoid fireflies)
  if (uEnv < 0.5) col += uSunColor * smoothstep(0.99985, 0.99993, sd) * 10.0;
  // below the horizon: the Bay / ground, so reflections in glass don't show sky underneath
  if (h < 0.0) col = mix(uHorizon * 0.7, vec3(0.16, 0.16, 0.15) * (0.2 + 0.8 * length(uHorizon)), smoothstep(0.0, -0.3, h));
  // the fog swallows the horizon
  col = mix(col, uFogColor, uFog * (1.0 - smoothstep(-0.05, 0.35 + 0.4 * uFog, h)));
  // the light the city receives from the sky is less saturated than the sky looks (bounce off buildings)
  if (uEnv > 0.5) col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(renderer, scene) {
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() },
    uSunDir: shared.uSunDir, uFogColor: { value: new THREE.Color() }, uFog: { value: 0 }, uTime: shared.uTime,
    uEnv: { value: 0 }, uNightAmt: { value: 0 }, uCloud: { value: 0.35 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  // Environment: the same dome rendered into a cube and prefiltered for PBR reflections.
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(dome.geometry, mat.clone());
  envDome.material.uniforms = { ...uniforms, uEnv: { value: 1 } };
  envScene.add(envDome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;

  scene.fog = new THREE.Fog(0xffffff, 0, 400);

  const state = { hour: 17.6, karl: 0.0, haze: 0, overcast: 0, clouds: 0.35, sunDir: shared.uSunDir.value, sunColor: new THREE.Color(), sunIntensity: 3, ambient: 1, elev: 0, lastEnvKey: '' };

  function apply() {
    const { elev, dir } = sunPosition(state.hour);
    state.elev = elev;
    // below the horizon the "sun" light becomes the moon, high in the opposite sky
    const p = palette(elev);
    shared.uSunDir.value.copy(dir);
    const fogAmt = state.karl, oc = state.overcast;
    const zen = new THREE.Color().fromArray(p.zen), hor = new THREE.Color().fromArray(p.hor);
    const grey = new THREE.Color(0.62, 0.64, 0.67).multiplyScalar(Math.max(0.03, p.amb));
    // overcast: a flat grey lid
    zen.lerp(grey.clone().multiplyScalar(0.8), oc * 0.85); hor.lerp(grey, oc * 0.7);
    // Karl desaturates everything towards a cool grey
    hor.lerp(grey, fogAmt * 0.7); zen.lerp(grey, fogAmt * 0.45);
    uniforms.uZenith.value.copy(zen);
    uniforms.uHorizon.value.copy(hor);
    uniforms.uSunColor.value.fromArray(p.sun).multiplyScalar(1 - fogAmt * 0.6);
    const fogCol = hor.clone().lerp(grey, 0.35 + fogAmt * 0.4);
    uniforms.uFogColor.value.copy(fogCol);
    uniforms.uFog.value = Math.min(1, fogAmt * 1.4);
    const night = 1 - smooth(-10, 2, elev);
    uniforms.uNightAmt.value = night;
    uniforms.uCloud.value = state.clouds;
    shared.uNight.value = 1 - smooth(-6, 6, elev);

    scene.fog.color.copy(fogCol);
    scene.fog.near = fogAmt * fogAmt * 0.006;                       // low layer density
    const haze = Math.min(0.999, (0.000035 + fogAmt * 0.00012 + oc * 0.00008 + state.haze) / 0.0003);
    scene.fog.far = Math.floor(50 + fogAmt * 110) + haze;          // layer height + haze

    state.sunColor.fromArray(p.sun);
    state.sunIntensity = p.sunI * (1 - fogAmt * 0.75) * (1 - oc * 0.85);
    state.ambient = p.amb * (1 - fogAmt * 0.2);
    if (elev < -4) { // moonlight
      state.sunColor.setRGB(0.55, 0.65, 0.95);
      state.sunIntensity = 0.12 * (1 - fogAmt);
      const m = sunPosition((state.hour + 12) % 24).dir; m.y = Math.max(0.35, m.y);
      shared.uSunDir.value.copy(m.normalize());
    }

    const key = [Math.round(elev * 2), Math.round(fogAmt * 20), Math.round(state.clouds * 10), Math.round(oc * 10)].join();
    if (key !== state.lastEnvKey) {
      state.lastEnvKey = key;
      envDome.material.uniforms.uSunDir = { value: dir.clone() };
      const rt = pmrem.fromScene(envScene, 0, 0.1, 200);
      if (envRT) envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = Math.max(0.04, p.amb) * 0.52;
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
