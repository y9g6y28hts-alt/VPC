// Golden-hour environment: physical sky, low warm sun with fitted shadows,
// image-based lighting from a CC0 HDRI (Poly Haven, via @pmndrs/assets) and
// aerial-perspective fog matched to the horizon.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { skyRadiance } from './sky-model.js';

// Sun from the west-north-west, low over the horizon (late afternoon, 25° S).
export const SUN = Object.freeze({ azimuthDeg: 292, elevationDeg: 16 });

export function sunDirection({ azimuthDeg, elevationDeg } = SUN) {
  // Azimuth measured clockwise from north (-Z) towards east (+X).
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export class Environment {
  constructor(scene, renderer, assets, settings) {
    this.scene = scene;
    this.settings = settings;
    this.sunDir = sunDirection();
    this.fogMatch = 0.95; // slightly below the sky so silhouettes keep some depth

    // Sky dome
    const sky = new Sky();
    sky.scale.setScalar(9000);
    const u = sky.material.uniforms;
    this.skyParams = { turbidity: 2.6, rayleigh: 1.55, mieCoefficient: 0.0038, mieDirectionalG: 0.82 };
    for (const [k, v] of Object.entries(this.skyParams)) u[k].value = v;
    u.sunPosition.value.copy(this.sunDir);
    // A few high, thin clouds catch the low sun.
    if (u.cloudCoverage) {
      u.cloudCoverage.value = 0.22;
      u.cloudDensity.value = 0.32;
      u.cloudElevation.value = 0.62;
      u.cloudScale.value = 0.00016;
      u.cloudSpeed.value = 0.0;
    }
    // Sky exposure: Preetham radiance near a low sun overpowers the land under
    // filmic tone mapping; the fog colour applies the same factor.
    this.skyExposure = 0.62;
    sky.material.uniforms.skyExposure = { value: this.skyExposure };
    sky.material.fragmentShader = sky.material.fragmentShader
      .replace('uniform float time;', 'uniform float time;\nuniform float skyExposure;')
      // Keep the sun disc inside half-float range of the HDR render target.
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * skyExposure, vec3( 3000.0 ) ), 1.0 );');
    sky.material.depthWrite = false;
    sky.frustumCulled = false;
    this.sky = sky;
    scene.add(sky);

    // Aerial perspective. The colour follows the sky radiance at the horizon in
    // the view direction (see updateFog), so the far terrain melts into the sky.
    scene.fog = new THREE.FogExp2(new THREE.Color(), 0.00038);
    this._fogDir = new THREE.Vector3();
    this.updateFog(new THREE.Vector3(0.6, 0, -0.8));

    // Sun
    const sun = new THREE.DirectionalLight(new THREE.Color('#ffd09c'), 5.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.5;
    const sc = sun.shadow.camera;
    sc.near = 1;
    sc.far = 1200;
    this.sun = sun;
    scene.add(sun);
    scene.add(sun.target);

    // Cool sky fill from above, warm bounce from the ground.
    this.hemi = new THREE.HemisphereLight(new THREE.Color('#9db4cf'), new THREE.Color('#6b5a3f'), 0.18);
    scene.add(this.hemi);

    // Image-based lighting
    const pmrem = new THREE.PMREMGenerator(renderer);
    if (assets.environmentSource) {
      this.envMap = pmrem.fromEquirectangular(assets.environmentSource).texture;
      scene.environment = this.envMap;
      scene.environmentIntensity = 0.42;
    }
    // A sky-only environment for water reflections, consistent with the visible sky.
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(1000);
    skyCopy.material.uniforms.turbidity.value = u.turbidity.value;
    skyCopy.material.uniforms.rayleigh.value = u.rayleigh.value;
    skyCopy.material.uniforms.mieCoefficient.value = u.mieCoefficient.value;
    skyCopy.material.uniforms.mieDirectionalG.value = u.mieDirectionalG.value;
    skyCopy.material.uniforms.sunPosition.value.copy(this.sunDir);
    // No sun disc in the reflection probe: its radiance overflows half floats.
    if (skyCopy.material.uniforms.showSunDisc) skyCopy.material.uniforms.showSunDisc.value = 0;
    skyScene.add(skyCopy);
    this.skyEnvMap = pmrem.fromScene(skyScene, 0, 1, 2000).texture;
    skyCopy.geometry.dispose();
    skyCopy.material.dispose();
    pmrem.dispose();

    this.focus = new THREE.Vector3();
    this.radius = 300;
    this.fitShadows(new THREE.Vector3(0, 0, 0), 320);
  }

  /** Set the fog colour to the sky's horizon radiance around a view direction. */
  updateFog(viewDir) {
    const d = this._fogDir.set(viewDir.x, 0, viewDir.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    d.normalize();
    const acc = [0, 0, 0];
    // Average across the frame width so the haze matches the whole horizon band.
    for (const yaw of [-0.35, 0, 0.35]) {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const dir = { x: d.x * c - d.z * s, y: 0.035, z: d.x * s + d.z * c };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const r = skyRadiance({ x: dir.x / len, y: dir.y / len, z: dir.z / len }, this.sunDir, this.skyParams);
      for (let i = 0; i < 3; i++) acc[i] += r[i] / 3;
    }
    const k = this.fogMatch * this.skyExposure;
    this.scene.fog.color.setRGB(acc[0] * k, acc[1] * k, acc[2] * k);
  }

  /** Fit the sun's orthographic shadow frustum around a focus area. */
  fitShadows(center, radius) {
    this.focus.copy(center);
    this.radius = radius;
    const sc = this.sun.shadow.camera;
    sc.left = -radius;
    sc.right = radius;
    sc.top = radius;
    sc.bottom = -radius;
    sc.updateProjectionMatrix();
    const dist = Math.max(400, radius * 2.5);
    this.sun.position.copy(center).addScaledVector(this.sunDir, dist);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    sc.far = dist * 2;
    sc.updateProjectionMatrix();
    // Texel snapping is unnecessary: the focus only changes during camera flights.
  }

  dispose() {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.envMap?.dispose();
    this.skyEnvMap?.dispose();
    this.sun.shadow.map?.dispose();
  }
}
