// Renderer + the post-processing chain that gives the cinematic look:
// scene -> N8AO ambient occlusion -> bloom -> AgX filmic tone mapping + grade -> SMAA.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

export function createRenderer(canvas, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.5 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 40000);

  const csm = new CSM({
    camera, parent: scene, cascades: 4, maxFar: 2400, mode: 'practical', shadowMapSize: 2048,
    lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), lightIntensity: 3, lightNear: 1, lightFar: 6000, lightMargin: 400, shadowBias: -0.00015,
  });
  csm.fade = true;
  for (const l of csm.lights) l.shadow.normalBias = 0.06;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight);
  ao.configuration.aoRadius = 4;
  ao.configuration.distanceFalloff = 1.5;
  ao.configuration.intensity = 2.2;
  ao.configuration.gammaCorrection = false;
  ao.configuration.halfRes = quality !== 'high';
  ao.setQualityMode(quality === 'high' ? 'Medium' : 'Performance');
  composer.addPass(ao);
  const bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 1.1, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const grade = new HueSaturationEffect({ saturation: 0.22 });
  const contrast = new BrightnessContrastEffect({ contrast: 0.1 });
  const vignette = new VignetteEffect({ darkness: 0.38, offset: 0.32 });
  composer.addPass(new EffectPass(camera, bloom, tone, grade, contrast, vignette));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    csm.updateFrustums();
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, csm, composer, ao, bloom, tone, resize, exposure: v => { renderer.toneMappingExposure = v; } };
}
