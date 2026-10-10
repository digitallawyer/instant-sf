// A full-screen triangle for the little helper passes our effects render in their update().
import * as THREE from 'three';

export const QUAD_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export class Quad {
  constructor() {
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, camera);
  }
}

export function shaderMaterial(uniforms, fragmentShader, defines = {}) {
  return new THREE.ShaderMaterial({ uniforms, defines, vertexShader: QUAD_VERT, fragmentShader, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
}

export function target(w, h, type = THREE.HalfFloatType, filter = THREE.LinearFilter) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, generateMipmaps: false });
  rt.texture.generateMipmaps = false;
  return rt;
}
