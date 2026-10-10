// Renderer + the post-processing chain that gives the cinematic look:
//   scene -> N8AO ambient occlusion -> [depth of field, menu/tour only]
//         -> chromatic aberration (high) + sun shafts + bloom + eye adaptation + AgX + film grade (one merged pass)
//         -> SMAA.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, DepthOfFieldEffect, ChromaticAberrationEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { AutoExposureEffect } from './post/exposure.js';
import { SunShaftsEffect } from './post/shafts.js';
import { GradeEffect } from './post/grade.js';

export function createRenderer(canvas, { quality = 'high' } = {}) {
  const high = quality === 'high';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 1.5 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: hardware PCF, 5 Vogel-disk taps rotated per pixel, soft with shadow.radius

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 40000);

  const shadowMapSize = high ? 2048 : 1024;
  const csm = new CSM({
    camera, parent: scene, cascades: high ? 3 : 2, maxFar: high ? 1800 : 900, mode: 'practical', shadowMapSize,
    lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), lightIntensity: 3, lightNear: 1, lightFar: 6000, lightMargin: 400, shadowBias: -0.00002,
  });
  csm.fade = true;
  // Bias in proportion to each cascade's texel size: enough to kill acne on the far, coarse cascades without
  // making contact shadows on the near one float (peter-panning). Penumbrae get wider on the near cascades,
  // where a texel is small, so the softness reads about the same everywhere.
  const RADIUS = high ? [2.6, 2.0, 1.4, 1.2] : [1.8, 1.3, 1.0];
  function tuneShadows() {
    csm.lights.forEach((l, i) => {
      const cam = l.shadow.camera;
      const texel = (cam.right - cam.left) / shadowMapSize;
      l.shadow.normalBias = texel * 1.4;
      l.shadow.bias = -texel * 0.6 / (cam.far - cam.near);
      l.shadow.radius = RADIUS[i] ?? 1;
    });
  }
  const updateFrustums = csm.updateFrustums.bind(csm);
  csm.updateFrustums = () => { updateFrustums(); tuneShadows(); };
  csm.updateFrustums();

  // depth of field state (menu orbit, tour): faded in and out by scaling the bokeh
  const dof = { enabled: false, amount: 0, focusDistance: 7.5, focusRange: 4, bokehScale: high ? 3.2 : 2.2, target: null };

  function makeComposer(cam) {
    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, cam));
    const ao = new N8AOPostPass(scene, cam, window.innerWidth, window.innerHeight);
    ao.configuration.aoRadius = 4;
    ao.configuration.distanceFalloff = 1.5;
    ao.configuration.intensity = 2.2;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = !high;
    ao.setQualityMode(high ? 'Medium' : 'Performance');
    composer.addPass(ao);

    const dofEffect = new DepthOfFieldEffect(cam, { focusDistance: dof.focusDistance, focusRange: dof.focusRange, bokehScale: 0, resolutionScale: high ? 0.5 : 0.35 });
    const dofPass = new EffectPass(cam, dofEffect);
    dofPass.enabled = false;
    composer.addPass(dofPass);

    const ca = high ? new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0009, 0.0006), radialModulation: true, modulationOffset: 0.42 }) : null;
    const shafts = new SunShaftsEffect(cam, { resolutionScale: high ? 0.35 : 0.25 });
    const bloom = new BloomEffect({ intensity: 0.4, luminanceThreshold: 1.1, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.7 });
    const exposure = new AutoExposureEffect();
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const grade = new GradeEffect({ grain: high ? 0.012 : 0.008 });
    composer.addPass(new EffectPass(cam, ...[ca, shafts, bloom, exposure, tone, grade].filter(Boolean)));
    composer.addPass(new EffectPass(cam, new SMAAEffect({ preset: high ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));
    Object.assign(composer, { ao, bloom, dofEffect, dofPass, ca, shafts, exposure, tone, grade });
    return composer;
  }
  const composer = makeComposer(camera);
  const ao = composer.ao, bloom = composer.bloom;

  // split screen: a second camera and composer, each drawn into half the canvas
  const camera2 = new THREE.PerspectiveCamera(55, 1, 0.5, 40000);
  let composer2 = null, split = false;
  const composers = () => (composer2 ? [composer, composer2] : [composer]);
  function setSplit(on) {
    split = on;
    if (on && !composer2) { composer2 = makeComposer(camera2); applyPost(); }
    resize();
  }

  function updateDof(dt) {
    const k = 1 - Math.exp(-dt * 3);
    dof.amount += ((dof.enabled ? 1 : 0) - dof.amount) * k;
    if (!dof.enabled && dof.amount < 0.01) dof.amount = 0;
    for (const c of composers()) {
      c.dofPass.enabled = dof.amount > 0;
      if (!c.dofPass.enabled) continue;
      const e = c.dofEffect;
      e.target = dof.target;
      if (!dof.target) e.cocMaterial.focusDistance = dof.focusDistance;
      e.cocMaterial.focusRange = dof.focusRange;
      e.bokehScale = dof.bokehScale * dof.amount;
    }
  }

  function render(dt, beforeView) {
    updateDof(dt);
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

  // post settings, applied to both composers
  const post = { autoExposure: true, exposure: 1, shafts: 1, grain: high ? 0.012 : 0.008, chromaticAberration: high, vignette: 0.32 };
  function applyPost() {
    for (const c of composers()) {
      c.exposure.params.strength.value = post.autoExposure ? 0.55 : 0;
      c.exposure.manualExposure = post.exposure;
      c.shafts.intensity = post.shafts;
      c.grade.set({ grain: post.grain, vignette: post.vignette });
      if (c.ca) c.ca.blendMode.opacity.value = post.chromaticAberration ? 1 : 0;
    }
  }
  applyPost();

  return {
    renderer, scene, camera, camera2, csm, composer, ao, bloom, resize, render, setSplit, get split() { return split; },
    exposure: v => { renderer.toneMappingExposure = v; post.exposure = v; applyPost(); },
    /**
     * Cinematic depth of field (fades in/out over ~1 s). Focus either on a world point (`target`, re-evaluated every
     * frame, e.g. the rider) or at a fixed `focusDistance` (m). `focusRange` is the depth (m) that stays sharp.
     *   R.setDof({ enabled: true, target: vec3, focusRange: 3 }); R.setDof({ enabled: false });
     */
    setDof({ enabled = dof.enabled, target, focusDistance, focusRange, bokehScale } = {}) {
      dof.enabled = enabled;
      if (target !== undefined) dof.target = target;
      if (focusDistance !== undefined) { dof.focusDistance = focusDistance; if (target === undefined) dof.target = null; }
      if (focusRange !== undefined) dof.focusRange = focusRange;
      if (bokehScale !== undefined) dof.bokehScale = bokehScale;
    },
    get dof() { return dof; },
    /** Toggles / strengths: { autoExposure, exposure, shafts, grain, chromaticAberration, vignette } */
    setPost(p) { Object.assign(post, p); applyPost(); },
    get post() { return post; },
    get composers() { return composers(); },
  };
}
