// Renderer and post chain. The scene always renders into a multisampled HDR
// target so that fog, sky and materials are composed in linear light, then
// OutputPass applies tone mapping and sRGB once. On the high tier the target's
// depth also feeds GTAO, so clipped construction geometry never leaves
// ambient-occlusion ghosts.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function isWebGL2Available() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2'));
  } catch {
    return false;
  }
}

export class SceneRenderer {
  constructor(container, settings) {
    this.settings = settings;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // MSAA happens in the HDR render target
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    r.setClearColor(0x000000, 1);
    r.domElement.classList.add('xp-canvas');
    container.appendChild(r.domElement);

    this.pixelRatio = Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio);
    r.setPixelRatio(this.pixelRatio);
    this.width = 1;
    this.height = 1;

    const targetOptions = { type: THREE.HalfFloatType, samples: settings.msaa };
    if (settings.ao) targetOptions.depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    if (settings.ao) this.aoTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.outputPass = new OutputPass();
    // Ambient occlusion fades out during camera flights (where it costs the
    // most and is least visible) and back in when the camera settles.
    this.aoMix = 1;
    this.motion = false;
  }

  attach(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    if (this.settings.ao) {
      // Passing the depth texture to the constructor crashes in r184 (it reads its
      // own normal target unconditionally), so swap the G-buffer afterwards. The
      // internal normal target is then never bound, hence never allocated.
      this.gtao = new GTAOPass(scene, camera, 1, 1);
      this.gtao.setGBuffer(this.sceneTarget.depthTexture);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    }
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = `${this.width}px`;
    this.renderer.domElement.style.height = `${this.height}px`;
    const w = Math.floor(this.width * this.pixelRatio);
    const h = Math.floor(this.height * this.pixelRatio);
    this.sceneTarget.setSize(w, h);
    this.aoTarget?.setSize(w, h);
    this.gtao?.setSize(w, h);
  }

  /** Lower the resolution when frames are consistently slow. */
  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.setSize(this.width, this.height);
  }

  /** Camera in flight: drop the costliest pass so the move stays fluid. */
  setMotion(on) {
    this.motion = on;
  }

  /** @returns {boolean} true while the AO is still fading (needs more frames). */
  render(dt = 0) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneTarget);
    r.render(this.scene, this.camera);
    let source = this.sceneTarget;
    const goal = this.motion ? 0 : 1;
    this.aoMix = dt > 0 ? goal + (this.aoMix - goal) * Math.exp(-dt / 0.12) : goal;
    if (Math.abs(this.aoMix - goal) < 0.01) this.aoMix = goal;
    if (this.gtao && this.aoMix > 0) {
      this.gtao.blendIntensity = 0.85 * this.aoMix;
      this.gtao.render(r, this.aoTarget, this.sceneTarget);
      source = this.aoTarget;
    }
    this.outputPass.renderToScreen = true;
    this.outputPass.render(r, null, source);
    return Boolean(this.gtao) && this.aoMix !== goal;
  }

  dispose() {
    this.gtao?.dispose();
    this.outputPass?.dispose();
    this.sceneTarget?.dispose();
    this.aoTarget?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}
