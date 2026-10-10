// Weather: clear, Karl the Fog rolling in, overcast, rain. Drives the sky, the fog layer, wet streets
// and a field of rain streaks that follows the camera.
import * as THREE from 'three';
import { shared } from './fog.js';

const PRESETS = {
  clear: { karl: 0.0, clouds: 0.25, overcast: 0.0, rain: 0 },
  fog: { karl: 0.75, clouds: 0.5, overcast: 0.35, rain: 0 },
  cloudy: { karl: 0.15, clouds: 0.85, overcast: 0.6, rain: 0 },
  rain: { karl: 0.25, clouds: 1.0, overcast: 0.9, rain: 1 },
};
export const WEATHER = Object.keys(PRESETS);

function rainField(count = 9000) {
  const g = new THREE.InstancedBufferGeometry();
  // a thin vertical quad per drop, stretched in the vertex shader
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = 0.7 + Math.random() * 0.6; }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: shared.uTime, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uWind: { value: new THREE.Vector2(1.5, 0.6) }, uColor: { value: new THREE.Color(0.55, 0.6, 0.66) } },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uAmount; uniform vec3 uCam; uniform vec2 uWind;
      varying float vA; varying float vV;
      const float BOX = 40.0, TOP = 22.0;
      void main() {
        float speed = 9.0 * aSeed.w;
        vec3 p = vec3(aSeed.x * BOX, aSeed.y * TOP, aSeed.z * BOX);
        p.y = mod(p.y - uTime * speed, TOP);
        p.xz += uWind * (TOP - p.y) / speed;
        // wrap the field around the camera
        p.xz = mod(p.xz - uCam.xz + BOX * 0.5, BOX) + uCam.xz - BOX * 0.5;
        p.y += uCam.y - TOP * 0.45;
        vec3 fall = normalize(vec3(uWind.x, -speed, uWind.y));
        vec3 view = normalize(p - cameraPosition);
        vec3 side = normalize(cross(fall, view)) * 0.012;
        vec3 world = p + side * position.x * 2.0 - fall * position.y * 0.55 * aSeed.w;
        vA = (1.0 - position.y) * step(aSeed.x, uAmount);
        vV = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; varying float vA; varying float vV;
      void main() { gl_FragColor = vec4(uColor * vA * 0.35, 1.0); }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

export function createWeather(scene, sky) {
  const rain = rainField();
  scene.add(rain);
  const cur = { ...PRESETS.clear };
  const state = { name: 'clear', target: PRESETS.clear, auto: false, autoT: 0 };
  const lerp = (a, b, k) => a + (b - a) * k;

  return {
    state,
    set(name, instant = false) {
      state.name = name; state.target = PRESETS[name] || PRESETS.clear;
      if (instant) Object.assign(cur, state.target);
    },
    setAuto(on) { state.auto = on; state.autoT = 0; },
    cycle() { const i = WEATHER.indexOf(state.name); this.set(WEATHER[(i + 1) % WEATHER.length]); return state.name; },
    update(dt, camera) {
      if (state.auto) {
        state.autoT -= dt;
        if (state.autoT <= 0) { state.autoT = 90 + Math.random() * 120; const r = Math.random(); this.set(r < 0.45 ? 'clear' : r < 0.7 ? 'fog' : r < 0.88 ? 'cloudy' : 'rain'); }
      }
      const k = 1 - Math.exp(-dt * 0.12);
      const t = state.target;
      const before = cur.karl + cur.clouds + cur.overcast;
      cur.karl = lerp(cur.karl, t.karl, k);
      cur.clouds = lerp(cur.clouds, t.clouds, k);
      cur.overcast = lerp(cur.overcast, t.overcast, k);
      cur.rain = lerp(cur.rain, t.rain, 1 - Math.exp(-dt * 0.25));
      // Karl breathes: the layer swells and thins slowly
      const breathe = cur.karl > 0.05 ? Math.sin(shared.uTime.value * 0.05) * 0.06 : 0;
      if (Math.abs(cur.karl + cur.clouds + cur.overcast - before) > 1e-4 || breathe) {
        sky.state.karl = Math.max(0, cur.karl + breathe);
        sky.state.clouds = cur.clouds;
        sky.state.overcast = cur.overcast;
        sky.apply();
      }
      // streets get wet in the rain and dry slowly after
      shared.uWet.value = Math.min(1, Math.max(0, shared.uWet.value + (cur.rain > 0.3 ? dt * 0.05 : -dt * 0.01)));
      rain.material.uniforms.uCam.value.copy(camera.position);
      rain.material.uniforms.uAmount.value = cur.rain;
      rain.visible = cur.rain > 0.01;
      const night = shared.uNight.value;
      rain.material.uniforms.uColor.value.setRGB(0.55 - night * 0.3, 0.6 - night * 0.3, 0.66 - night * 0.25);
    },
    get values() { return cur; },
  };
}
