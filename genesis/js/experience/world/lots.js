// Lot boundaries, corner markers, picking and hover/selection feedback.
// Boundaries are hairlines in screen space so they stay legible but quiet at
// any distance; corners carry small concrete survey markers ("mojones").
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { mulberry32 } from '../../core/noise.js';

const IVORY = new THREE.Color('#f3ede2');
const SURVEY = new THREE.Color('#e9dfc9');
// Selection reads in the brand's lilac: green would vanish against the lawn.
const LIME = new THREE.Color('#d4a3d7');

export class LotLayer {
  /**
   * @param {object[]} lots
   * @param {object} materials shared material library
   * @param {{ groundMaterial?: THREE.Material }} options terrain-shader variant
   *   with per-lot tint; parcels then read through slightly different lawn
   *   tones (as in aerial photographs) rather than through heavy outlines.
   */
  constructor(lots, materials, { groundMaterial } = {}) {
    this.lots = lots;
    this.group = new THREE.Group();
    this.group.name = 'lots';
    this.hoverId = null;
    this.selectedId = null;

    if (groundMaterial) {
      const rnd = mulberry32(4242);
      const pos = [];
      const tint = [];
      for (const lot of lots) {
        // Surveyed lots can have curved street fronts: triangulate the outline.
        const contour = lot.polygon.map((p) => new THREE.Vector2(p.x, p.z));
        const tris = THREE.ShapeUtils.triangulateShape(contour, []);
        const k = rnd() * 2 - 1;
        const w = rnd() * 2 - 1;
        // Some parcels freshly mown, some left longer and drier.
        const t = [1 + k * 0.1 + w * 0.05, 1 + k * 0.08, 1 + k * 0.04 - w * 0.08];
        for (const tri of tris) {
          for (const i of tri) {
            pos.push(contour[i].x, 0.0, contour[i].y);
            tint.push(...t);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      // Faces must point up regardless of polygon winding.
      const n = g.attributes.normal;
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        if (n.getY(i) >= 0) continue;
        const t1 = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
        p.setXYZ(i + 2, ...t1);
      }
      g.computeVertexNormals();
      g.setAttribute('aLotTint', new THREE.Float32BufferAttribute(tint, 3));
      g.setAttribute('aMowed', new THREE.Float32BufferAttribute(new Array(p.count).fill(1), 1));
      g.setAttribute('aShore', new THREE.Float32BufferAttribute(new Array(p.count).fill(0), 1));
      this.ground = new THREE.Mesh(g, groundMaterial);
      this.ground.receiveShadow = true;
      this.ground.name = 'lot-ground';
      this.group.add(this.ground);
    }

    // All boundaries in one hairline batch.
    const segs = [];
    for (const lot of lots) {
      const p = lot.polygon;
      for (let i = 0; i < p.length; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        segs.push(a.x, 0.12, a.z, b.x, 0.12, b.z);
      }
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(segs);
    this.baseMaterial = new LineMaterial({
      color: SURVEY,
      linewidth: 1.0,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      worldUnits: false,
      // Lines sit a hair above the ground and the lot overlay (which is itself
      // polygon-offset over the terrain), so pull them forward in depth.
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.lines = new LineSegments2(geo, this.baseMaterial);
    this.lines.renderOrder = 2;
    this.group.add(this.lines);

    // Highlight outline (reused for hover and selection).
    const lift = { polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 };
    this.hoverMaterial = new LineMaterial({ color: IVORY, linewidth: 2.0, transparent: true, opacity: 0.95, depthWrite: false, ...lift });
    this.selectMaterial = new LineMaterial({ color: LIME, linewidth: 2.4, transparent: true, opacity: 1, depthWrite: false, ...lift });
    this.hoverLine = new LineSegments2(new LineSegmentsGeometry(), this.hoverMaterial);
    this.selectLine = new LineSegments2(new LineSegmentsGeometry(), this.selectMaterial);
    this.hoverLine.visible = false;
    this.selectLine.visible = false;
    this.hoverLine.renderOrder = 3;
    this.selectLine.renderOrder = 4;
    this.group.add(this.hoverLine, this.selectLine);

    // Soft fill on the ground for hover/selection.
    this.fillMaterial = new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0, depthWrite: false });
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMaterial);
    this.fill.renderOrder = 1;
    this.fill.visible = false;
    this.group.add(this.fill);

    // Concrete corner markers (deduplicated shared corners).
    const corners = new Map();
    for (const lot of lots) {
      for (const c of lot.corners || lot.polygon) corners.set(`${c.x.toFixed(1)}:${c.z.toFixed(1)}`, c);
    }
    const markerGeo = new THREE.BoxGeometry(0.14, 0.32, 0.14);
    markerGeo.translate(0, 0.12, 0);
    this.markers = new THREE.InstancedMesh(markerGeo, materials.concreteLight, corners.size);
    const m = new THREE.Matrix4();
    let k = 0;
    for (const c of corners.values()) {
      m.makeRotationY((k * 0.37) % Math.PI);
      m.setPosition(c.x, 0, c.z);
      this.markers.setMatrixAt(k++, m);
    }
    this.markers.castShadow = true;
    this.markers.receiveShadow = true;
    this.group.add(this.markers);

    // Invisible pick surfaces.
    this.pickGroup = new THREE.Group();
    this.pickGroup.name = 'lot-pick';
    for (const lot of lots) {
      const shape = new THREE.Shape(lot.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.05, 0);
      const mesh = new THREE.Mesh(g, this.fillMaterial);
      mesh.visible = false; // raycasting ignores visibility; rendering skips it
      mesh.userData.lotId = lot.id;
      this.pickGroup.add(mesh);
    }
    this.group.add(this.pickGroup);
    this.byId = new Map(lots.map((l) => [l.id, l]));
    this._fillTarget = 0;
    this.interactive = true;
  }

  setResolution(width, height) {
    for (const mat of [this.baseMaterial, this.hoverMaterial, this.selectMaterial]) mat.resolution.set(width, height);
  }

  _outline(line, lot) {
    const segs = [];
    const p = lot.polygon;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      segs.push(a.x, 0.13, a.z, b.x, 0.13, b.z);
    }
    line.geometry.dispose();
    const g = new LineSegmentsGeometry();
    g.setPositions(segs);
    line.geometry = g;
  }

  _setFill(lot) {
    const shape = new THREE.Shape(lot.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.055, 0);
    this.fill.geometry.dispose();
    this.fill.geometry = g;
  }

  /** Returns the lot id under a raycaster, or null. */
  pick(raycaster) {
    if (!this.interactive) return null;
    const hit = raycaster.intersectObjects(this.pickGroup.children, false)[0];
    return hit ? hit.object.userData.lotId : null;
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    const lot = id && id !== this.selectedId ? this.byId.get(id) : null;
    this.hoverLine.visible = Boolean(lot);
    if (lot) this._outline(this.hoverLine, lot);
    this._updateFill();
  }

  setSelected(id) {
    this.selectedId = id;
    const lot = id ? this.byId.get(id) : null;
    this.selectLine.visible = Boolean(lot);
    if (lot) this._outline(this.selectLine, lot);
    if (this.hoverId === id) this.hoverLine.visible = false;
    this._updateFill();
  }

  _updateFill() {
    const id = this.selectedId || this.hoverId;
    const lot = id ? this.byId.get(id) : null;
    if (lot) this._setFill(lot);
    this.fill.visible = Boolean(lot);
    this._fillTarget = lot ? (this.selectedId ? 0.14 : 0.08) : 0;
  }

  /** While a lot is under construction its fill gives way to the site itself. */
  setSiteActive(active) {
    this._siteActive = active;
  }

  /** Overall emphasis of the boundary network (quieter close to the house). */
  setEmphasis(value) {
    this.baseMaterial.opacity = 0.11 * Math.max(0.25, value);
    this.selectMaterial.opacity = value;
    this.selectLine.visible = Boolean(this.selectedId) && value > 0.01;
    this.markers.visible = true;
  }

  update(dt) {
    const target = this._siteActive ? 0 : this._fillTarget;
    const k = 1 - Math.pow(0.001, dt);
    this.fillMaterial.opacity += (target - this.fillMaterial.opacity) * k;
    this.fill.visible = this.fillMaterial.opacity > 0.003;
  }

  dispose() {
    this.lines.geometry.dispose();
    this.hoverLine.geometry.dispose();
    this.selectLine.geometry.dispose();
    this.fill.geometry.dispose();
    this.ground?.geometry.dispose();
    this.ground?.material.dispose();
    this.markers.geometry.dispose();
    for (const c of this.pickGroup.children) c.geometry.dispose();
    this.baseMaterial.dispose();
    this.hoverMaterial.dispose();
    this.selectMaterial.dispose();
    this.fillMaterial.dispose();
  }
}
