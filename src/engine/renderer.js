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

  function makeComposer(cam) {
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, cam));
    const ao = new N8AOPostPass(scene, cam, window.innerWidth, window.innerHeight);
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
    composer.addPass(new EffectPass(cam, bloom, tone, grade, contrast, vignette));
    composer.addPass(new EffectPass(cam, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    composer.ao = ao; composer.bloom = bloom;
    return composer;
  }
  const composer = makeComposer(camera);
  const ao = composer.ao, bloom = composer.bloom, tone = null;

  // split screen: a second camera and composer, each drawn into half the canvas
  const camera2 = new THREE.PerspectiveCamera(55, 1, 0.5, 40000);
  let composer2 = null, split = false;
  function setSplit(on) {
    split = on;
    if (on && !composer2) composer2 = makeComposer(camera2);
    resize();
  }
  function render(dt, beforeView) {
    if (!split) { beforeView?.(camera, 0); composer.render(dt); return; }
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setScissorTest(true);
    [[camera, composer, 0], [camera2, composer2, w / 2]].forEach(([cam, comp, x], i) => {
      renderer.setViewport(x, 0, w / 2, h);
      renderer.setScissor(x, 0, w / 2, h);
      csm.camera = cam; csm.updateFrustums();
      beforeView?.(cam, i);
      comp.render(dt);
    });
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    csm.camera = camera; csm.updateFrustums();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const vw = split ? w / 2 : w;
    for (const c of split ? [camera, camera2] : [camera]) { c.aspect = vw / h; c.updateProjectionMatrix(); }
    // EffectComposer.setSize resizes the canvas too: size the buffers for one view, then restore the canvas
    composer.setSize(vw, h, false);
    composer2?.setSize(vw, h, false);
    renderer.setSize(w, h, false);
    renderer.setViewport(0, 0, w, h);
    csm.updateFrustums();
  }
  window.addEventListener('resize', resize);

  return { renderer, scene, camera, camera2, csm, composer, ao, bloom, resize, render, setSplit, get split() { return split; }, exposure: v => { renderer.toneMappingExposure = v; } };
}
