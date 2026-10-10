// Things the game modes put into the world: race gates, item pickups (fortune cookies), dropped
// sourdough loaves, the seagull and fog-cloud attacks, light beams over targets, postcards.
import * as THREE from 'three';
import { addHook, useShared, shared } from '../engine/fog.js';

function bannerTexture(text, { bg = '#e5532d', fg = '#ffffff', checker = false } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  if (checker) {
    for (let x = 0; x < 64; x++) for (let y = 0; y < 8; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f1ec'; g.fillRect(x * 16, y * 16, 16, 16); }
    g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(300, 24, 424, 80);
  } else { g.fillStyle = bg; g.fillRect(0, 0, 1024, 128); }
  g.fillStyle = fg; g.font = 'italic 400 76px "Instrument Serif", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const postMat = new THREE.MeshStandardMaterial({ color: 0xe9e6e1, roughness: 0.4, metalness: 0.2 });

export function gate(width, text, opts = {}) {
  const g = new THREE.Group();
  const h = 5.2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h, 12), postMat);
    post.position.set(s * width / 2, h / 2, 0); post.castShadow = true; g.add(post);
  }
  const tex = bannerTexture(text, opts);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 1.0, 0.12), [postMat, postMat, postMat, postMat,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 })]);
  banner.position.y = h - 0.4; banner.castShadow = true;
  g.add(banner);
  return g;
}

// Fortune-cookie item pickups: glossy, glowing, spinning.
export function cookieGeometry() {
  const g = new THREE.TorusGeometry(0.42, 0.2, 10, 20, Math.PI * 1.25);
  g.rotateZ(-Math.PI * 0.62); g.scale(1, 0.8, 1.25);
  return g;
}
export function itemMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xe0a24a, roughness: 0.35, metalness: 0.1, emissive: 0xff8a3a, emissiveIntensity: 0.35 });
  return m;
}

export function loafMesh() {
  const g = new THREE.SphereGeometry(0.42, 16, 10).scale(1.3, 0.62, 0.85);
  const m = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.75 });
  addHook(m, sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLP;').replace('#include <color_fragment>', `#include <color_fragment>
      float score = smoothstep(0.03, 0.0, abs(fract(vLP.x * 2.2 + vLP.z * 1.3) - 0.5) - 0.44) * step(0.12, vLP.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.85, 0.7), score);
      diffuseColor.rgb *= 0.75 + 0.35 * smoothstep(-0.2, 0.25, vLP.y);`);
  });
  const mesh = new THREE.Mesh(g, m); mesh.castShadow = true;
  return mesh;
}

export function gullMesh() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -1.1, 0.25, -0.1, 0, 0, -0.25, 0, 0, 0.3, 0, 0, -0.25, 1.1, 0.25, -0.1, 0, 0, 0.3, 0, -0.12, 0, 0, 0, -0.5], 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf6f6f2, side: THREE.DoubleSide, roughness: 0.7 }));
  m.scale.setScalar(0.9);
  return m;
}

function softTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 40; i++) {
    const x = 32 + Math.random() * 64, y = 40 + Math.random() * 48, r = 18 + Math.random() * 26;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.22)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}
let fogTex = null;
export function fogCloud() {
  fogTex ||= softTexture();
  const m = new THREE.SpriteMaterial({ map: fogTex, color: 0xe9e9ea, transparent: true, depthWrite: false, opacity: 0.95 });
  const s = new THREE.Sprite(m); s.scale.set(7, 5, 1);
  return s;
}

// A tall column of light marking a destination, visible across the city.
export function beacon(color = 0xe5532d) {
  const geo = new THREE.CylinderGeometry(1.6, 1.6, 140, 24, 1, true).translate(0, 70, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: shared.uTime },
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float rim = pow(1.0 - abs(dot(vN, vV)), 1.5); float fade = (1.0 - vUv.y) * smoothstep(0.0, 0.02, vUv.y); float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - vUv.y * 20.0); gl_FragColor = vec4(uColor * (0.25 + rim) * fade * pulse * 1.6, 1.0); }',
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.08, 8, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
  ring.position.y = 0.3;
  const g = new THREE.Group(); g.add(mesh, ring);
  return g;
}

// A vintage postcard to collect, floating and turning.
export function postcard(i) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 170;
  const g = c.getContext('2d');
  const skies = ['#f1b27a', '#9ec3dd', '#e9a6a0', '#b7d3c3'];
  const grd = g.createLinearGradient(0, 0, 0, 170); grd.addColorStop(0, skies[i % 4]); grd.addColorStop(1, '#f4ead6');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 170);
  g.fillStyle = '#c0362c'; g.fillRect(30, 60, 10, 90); g.fillRect(200, 60, 10, 90); g.fillRect(20, 110, 216, 6);
  g.strokeStyle = '#c0362c'; g.lineWidth = 3; g.beginPath(); g.moveTo(35, 60); g.quadraticCurveTo(120, 135, 205, 60); g.stroke();
  g.fillStyle = '#2b2b2b'; g.font = 'italic 26px Georgia, serif'; g.fillText('Greetings from', 18, 34);
  g.font = 'bold 22px Georgia, serif'; g.fillText('SAN FRANCISCO', 18, 160);
  g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 162);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), m);
  mesh.castShadow = true;
  return mesh;
}
