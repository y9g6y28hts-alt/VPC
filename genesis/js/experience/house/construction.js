// Applies the construction clock to the residence's components.
//
// Clip-based components get their own material clone with a clipping plane in
// house space (rising walls, poured slabs, top-down render, dismantled
// scaffolding). Back faces revealed by the cut are shaded with the cut plane's
// normal so partially built elements read as solid, not hollow. Once a
// component is finished, it switches back to the shared material.
import * as THREE from 'three';
import { windowProgress, easeInOutSine, easeOutCubic, linear, lerp } from '../../core/easing.js';

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  d: new THREE.Vector3(0, 0, -1), // design d runs along local -Z
};

function capMaterial(base, plane) {
  const m = base.clone();
  m.side = THREE.DoubleSide;
  m.clippingPlanes = [plane];
  m.clipShadows = true;
  const cap = { value: new THREE.Vector3(0, 1, 0) };
  m.userData.cap = cap;
  const baseCompile = base.onBeforeCompile;
  const baseKey = base.customProgramCacheKey?.() || '';
  m.onBeforeCompile = (shader, renderer) => {
    if (baseCompile && baseCompile !== THREE.Material.prototype.onBeforeCompile) baseCompile(shader, renderer);
    shader.uniforms.uCapNormal = cap;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCapNormal;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nif (!gl_FrontFacing) { normal = normalize((viewMatrix * vec4(uCapNormal, 0.0)).xyz); }',
      );
  };
  m.customProgramCacheKey = () => `${baseKey}|cap`;
  return m;
}

export class ConstructionAnimator {
  /**
   * @param {{ group: THREE.Group, components: object[] }} residence
   * @param {{ glass: THREE.Material, downlight: THREE.Material, concreteFresh: THREE.Material }} lib
   */
  constructor(residence, lib) {
    this.residence = residence;
    this.lib = lib;
    this.group = residence.group;
    this.progress = -1;
    this.owned = [];
    this._tmpN = new THREE.Vector3();
    this._tmpP = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3();

    for (const c of residence.components) {
      c.state = { lastVisible: null };
      const clipSpecs = [c.build, c.remove].filter((a) => a && a.type === 'clip');
      if (clipSpecs.length) {
        c.plane = new THREE.Plane();
        c.clipMaterials = c.meshes.map((mesh) => {
          const m = capMaterial(mesh.userData.baseMaterial, c.plane);
          this.owned.push(m);
          return m;
        });
      }
      if (c.cure) {
        // Fresh concrete is darker and slightly glossy; it lightens as it cures.
        c.cureFrom = { color: lib.concreteFresh.color.clone(), roughness: lib.concreteFresh.roughness };
        c.cureTo = { color: c.meshes[0].userData.baseMaterial.color.clone(), roughness: c.meshes[0].userData.baseMaterial.roughness };
      }
      if (c.build?.type === 'slide') {
        c.meshes.forEach((m) => (m.userData.home = m.position.clone()));
      }
      if (c.build?.type === 'fade') {
        c.meshes.forEach((m) => {
          const mat = m.userData.baseMaterial;
          mat.userData.fullOpacity = mat.userData.fullOpacity ?? 1;
        });
      }
    }
  }

  /** Local-space plane keeping `keep` side of value h along axis. */
  _setPlane(c, spec, h) {
    const axis = AXES[spec.axis];
    // keep 'below': n = -axis, constant = h ; keep 'above': n = axis, constant = -h
    const nLocal = this._tmpN.copy(axis).multiplyScalar(spec.keep === 'below' ? -1 : 1);
    const pointLocal = this._tmpP.copy(axis).multiplyScalar(h);
    const m = this.group.matrixWorld;
    this._normalMatrix.getNormalMatrix(m);
    const nWorld = nLocal.clone().applyMatrix3(this._normalMatrix).normalize();
    const pWorld = pointLocal.clone().applyMatrix4(m);
    c.plane.setFromNormalAndCoplanarPoint(nWorld, pWorld);
    for (const mat of c.clipMaterials) mat.userData.cap.value.copy(nWorld).negate();
  }

  _useClipMaterials(c, on) {
    if (!c.clipMaterials) return;
    c.meshes.forEach((mesh, i) => {
      mesh.material = on ? c.clipMaterials[i] : mesh.userData.baseMaterial;
    });
  }

  _setVisible(c, visible) {
    if (c.state.lastVisible === visible) return;
    c.state.lastVisible = visible;
    for (const m of c.meshes) m.visible = visible;
    if (c.holder) c.holder.visible = visible;
  }

  /** Apply construction progress t in [0, 1]. */
  apply(t) {
    this.progress = t;
    this.group.updateMatrixWorld(true);
    const glowComponent = this.residence.components.find((c) => c.effect === 'glow');
    for (const c of this.residence.components) {
      const b = c.build;
      const pb = windowProgress(t, b.window[0], b.window[1], b.type === 'grow' ? easeOutCubic : b.type === 'clip' ? linear : easeInOutSine);
      const r = c.remove;
      const pr = r ? windowProgress(t, r.window[0], r.window[1], easeInOutSine) : 0;

      if (c.effect === 'glow') continue;
      const visible = pb > 0 && pr < 1;
      this._setVisible(c, visible);
      if (!visible) continue;

      // Clip-based building / removal, and concrete curing (which needs the
      // per-component material clone for its colour).
      const removing = Boolean(r && r.type === 'clip' && pr > 0);
      const cureK = c.cure ? windowProgress(t, c.cure.window[0], c.cure.window[1], easeInOutSine) : 1;
      if (c.plane) {
        const needsClip = pb < 1 || removing || cureK < 1;
        this._useClipMaterials(c, needsClip);
        if (needsClip) {
          if (removing) {
            this._setPlane(c, r, lerp(r.from, r.to, pr));
          } else if (pb < 1) {
            let h = lerp(b.from, b.to, pb);
            // Masonry is laid course by course.
            if (b.quantize) h = b.from + Math.floor((h - b.from) / b.quantize + 1e-6) * b.quantize;
            this._setPlane(c, b, h);
          } else {
            this._setPlane(c, b, b.to + (b.keep === 'below' ? 1000 : -1000));
          }
          if (c.cure) {
            for (const mat of c.clipMaterials) {
              mat.color.copy(c.cureFrom.color).lerp(c.cureTo.color, cureK);
              mat.roughness = lerp(c.cureFrom.roughness, c.cureTo.roughness, cureK);
            }
          }
        }
      }

      if (b.type === 'growY') c.holder.scale.y = Math.max(0.001, pb);
      if (b.type === 'pop' || b.type === 'grow') {
        const s = b.type === 'pop' ? pb : 0.12 + 0.88 * pb;
        if (c.holder) c.holder.scale.setScalar(Math.max(0.001, s * (c.holder.userData.finalScale ?? 1)));
        else this._scaleAbout(c, b.anchor, Math.max(0.001, s), 1);
      }
      if (r && r.type === 'shrink' && pr > 0) this._scaleAbout(c, r.anchor, 1, Math.max(0.001, 1 - pr));
      if (b.type === 'slide') {
        const k = 1 - pb;
        for (const m of c.meshes) m.position.copy(m.userData.home).addScaledVector(this._tmpN.set(...b.offset), k);
      }
      if (b.type === 'fill') {
        for (const m of c.meshes) m.position.y = lerp(b.from, b.to, pb);
      }
      if (b.type === 'fade') {
        for (const m of c.meshes) m.material.opacity = pb * (b.to ?? 1);
      }
    }
    if (glowComponent) {
      const g = windowProgress(t, glowComponent.build.window[0], glowComponent.build.window[1], easeInOutSine);
      this.lib.glass.emissiveIntensity = g * 0.5;
    }
  }

  _scaleAbout(c, anchor = [0, 0, 0], sXZ, sY) {
    // Scale meshes about a design-space anchor (x, y, d).
    const a = new THREE.Vector3(anchor[0], anchor[1], -anchor[2]);
    for (const m of c.meshes) {
      m.scale.set(sXZ, sXZ * sY, sXZ);
      m.position.copy(a).sub(a.clone().multiply(m.scale));
    }
  }

  dispose() {
    for (const m of this.owned) m.dispose();
  }
}
