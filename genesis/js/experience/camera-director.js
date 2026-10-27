// Camera direction: authored shots per lot, smooth interruptible flights, a slow
// "timelapse" dolly tied to the construction clock, and bounded user control.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { easeInOutCubic, easeInOutSine, clamp, lerp } from '../core/easing.js';
import { lotToWorld } from '../core/lot-layout.js';

export const OVERVIEW_POSE = Object.freeze({
  position: new THREE.Vector3(-112, 64, 150),
  target: new THREE.Vector3(26, 0, -6),
});

/**
 * Converts lot-local design coordinates (x, y, d) to a world Vector3. Design
 * coordinates follow the residence as it is fitted to the lot (houseScale), so
 * authored shots frame the house the same way on narrow and wide lots.
 */
export function lotPoint(lot, x, y, d) {
  const k = lot.houseScale || { x: 1, z: 1 };
  const p = lotToWorld(lot.frame, x * k.x, d * k.z);
  return new THREE.Vector3(p.x, y, p.z);
}

/**
 * Picks which front three-quarter side (+1 right, -1 left, seen from the
 * street) gets the most sun on the façades the camera sees.
 */
export function sunnySide(lot, sunDir) {
  const facing = (side) => {
    const cam = lotPoint(lot, side * 22, 0, -16);
    const centre = lotPoint(lot, 0, 0, 14);
    return cam.sub(centre).setY(0).normalize().dot(new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize());
  };
  return facing(1) >= facing(-1) ? 1 : -1;
}

/** Authored shots for a lot (all positions in lot design space). */
export function lotShots(lot, side, aspect) {
  // Pull back on narrow (portrait) screens so the house still fits.
  const widen = aspect < 1 ? 1 + (1 - aspect) * 1.05 : 1;
  const s = side;
  const shot = (x, y, d, tx, ty, td) => ({
    position: lotPoint(lot, x * widen, y * (widen > 1 ? 1 + (widen - 1) * 0.5 : 1), d * widen + (1 - widen) * 14),
    target: lotPoint(lot, tx, ty, td),
  });
  return {
    arrival: shot(s * 27, 10.5, -19, 0, 2.2, 15),
    buildStart: shot(s * 29, 9.5, -17, 0, 2.4, 15),
    buildEnd: shot(s * 20, 6.5, -21, s * -0.5, 3.0, 14.5),
    hero: shot(s * 19, 2.6, -9, s * -1.2, 3.6, 13),
    front: shot(s * 19, 2.6, -9, s * -1.2, 3.6, 13),
    // From the back corner, beside the planting: facade, deck and pool in view.
    garden: shot(-s * 22, 2.4, 33, -s * 1, 2.8, 18),
    aerial: shot(s * 34, 30, -24, 0, 1.5, 17),
    orbitTarget: lotPoint(lot, 0, 3.0, 15),
  };
}

export class CameraDirector {
  constructor(camera, domElement, { reducedMotion = false } = {}) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
    this.controls = new OrbitControls(camera, domElement);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.8;
    c.panSpeed = 0.7;
    c.maxPolarAngle = THREE.MathUtils.degToRad(84);
    c.target.copy(OVERVIEW_POSE.target);
    camera.position.copy(OVERVIEW_POSE.position);
    camera.lookAt(OVERVIEW_POSE.target);
    this.flight = null;
    this.dolly = null;
    this.bounds = null;
    this.onInterrupt = null;
    this.userControl = false;

    c.addEventListener('start', () => {
      // Any direct manipulation hands control to the user.
      if (this.flight || this.dolly) {
        const interrupted = this.flight;
        this.flight = null;
        this.dolly = null;
        this.onInterrupt?.(interrupted);
      }
      this.userControl = true;
    });
    this.setMode('overview');
  }

  get busy() {
    return Boolean(this.flight);
  }

  /**
   * overview: bounded drone-style orbit over the masterplan.
   * lot: orbit around a house; eye-level views (camera below its target) allowed.
   * cinematic: no constraints, so authored shots are never nudged.
   */
  setMode(mode, { center } = {}) {
    const c = this.controls;
    this.mode = mode;
    c.enabled = true;
    if (mode === 'overview') {
      c.enablePan = true;
      c.minDistance = 40;
      c.maxDistance = 520;
      c.minPolarAngle = THREE.MathUtils.degToRad(18);
      c.maxPolarAngle = THREE.MathUtils.degToRad(80);
      this.bounds = { min: new THREE.Vector3(-200, 0, -150), max: new THREE.Vector3(240, 0, 170) };
    } else if (mode === 'lot') {
      c.enablePan = true;
      c.minDistance = 8;
      c.maxDistance = 90;
      c.minPolarAngle = THREE.MathUtils.degToRad(20);
      c.maxPolarAngle = THREE.MathUtils.degToRad(100);
      const k = center || c.target;
      this.bounds = { min: new THREE.Vector3(k.x - 26, 0.3, k.z - 26), max: new THREE.Vector3(k.x + 26, 9, k.z + 26) };
    } else {
      c.minDistance = 0;
      c.maxDistance = Infinity;
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI;
      this.bounds = null;
    }
  }

  /** Fly to a pose. Resolves true when it lands, false if interrupted. */
  flyTo(pose, { duration = 3.2, arc = 0.18, ease = easeInOutCubic } = {}) {
    if (this.flight) this.flight.resolve(false);
    this.dolly = null;
    const from = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    if (this.reducedMotion) {
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.controls.update();
      return Promise.resolve(true);
    }
    const dist = from.position.distanceTo(pose.position);
    const mid = from.position.clone().lerp(pose.position, 0.5);
    mid.y += dist * arc;
    return new Promise((resolve) => {
      this.flight = { from, to: pose, mid, arc, t: 0, duration, ease, resolve };
    });
  }

  /** Moves the destination of the flight in progress (no-op otherwise). */
  retarget(pose) {
    const f = this.flight;
    if (!f) return;
    f.to = pose;
    f.mid = f.from.position.clone().lerp(pose.position, 0.5);
    f.mid.y += f.from.position.distanceTo(pose.position) * f.arc;
  }

  /** Construction dolly: position follows the construction clock (pauses with it). */
  startDolly(startPose, endPose) {
    if (this.flight) this.flight.resolve(false);
    this.flight = null;
    this.dolly = { startPose, endPose, progress: 0, smoothed: null };
    this.userControl = false;
  }

  setDollyProgress(p) {
    if (this.dolly) this.dolly.progress = clamp(p);
  }

  stop() {
    if (this.flight) this.flight.resolve(false);
    this.flight = null;
    this.dolly = null;
  }

  update(dt) {
    const cam = this.camera;
    const c = this.controls;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = f.ease(f.t);
      // Quadratic Bézier through a lifted midpoint for a natural arc.
      const a = f.from.position;
      const b = f.mid;
      const d = f.to.position;
      const u = 1 - k;
      cam.position.set(
        u * u * a.x + 2 * u * k * b.x + k * k * d.x,
        u * u * a.y + 2 * u * k * b.y + k * k * d.y,
        u * u * a.z + 2 * u * k * b.z + k * k * d.z,
      );
      c.target.lerpVectors(f.from.target, f.to.target, easeInOutSine(f.t));
      cam.lookAt(c.target);
      if (f.t >= 1) {
        this.flight = null;
        c.update();
        f.resolve(true);
      }
      return true;
    }
    if (this.dolly) {
      const d = this.dolly;
      const k = easeInOutSine(d.progress);
      const pos = d.startPose.position.clone().lerp(d.endPose.position, k);
      const tgt = d.startPose.target.clone().lerp(d.endPose.target, k);
      if (!d.smoothed) d.smoothed = { pos: cam.position.clone(), tgt: c.target.clone() };
      const s = 1 - Math.pow(0.02, dt);
      d.smoothed.pos.lerp(pos, s);
      d.smoothed.tgt.lerp(tgt, s);
      cam.position.copy(d.smoothed.pos);
      c.target.copy(d.smoothed.tgt);
      cam.lookAt(c.target);
      return true;
    }
    const changed = c.update(dt);
    if (this.bounds) {
      const before = c.target.clone();
      c.target.clamp(this.bounds.min, this.bounds.max);
      if (!before.equals(c.target)) cam.position.add(c.target.clone().sub(before));
    }
    // Keep the camera above the ground.
    if (cam.position.y < 1.2) cam.position.y = 1.2;
    return changed;
  }

  /** Adjust the lens for the viewport: wider on portrait screens. */
  fitLens(aspect) {
    this.camera.fov = aspect >= 1 ? 34 : lerp(34, 52, clamp((1 - aspect) / 0.5));
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.stop();
    this.controls.dispose();
  }
}
