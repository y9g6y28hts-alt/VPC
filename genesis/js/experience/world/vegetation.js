// Vegetation: broadleaf canopy trees (ez-tree geometry, re-lit with crown
// normals), yellow lapacho accents, pindó palms, shrubs, and a far tree line made
// of baked impostors. All repeated plants are GPU-instanced.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tree, TreePreset } from '../../../vendor/ez-tree/index.js';
import { mulberry32, fbm } from '../../core/noise.js';
import { distanceToPolyline, pointInPolygon } from '../../core/lot-layout.js';
import { ROADS, NAUTICAL_ACCESS, COMMON_AREAS, SITE, insideSite } from '../../data/viva-lago.js';

const nextFrame = () => new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

/** Geometry budget shared by all broadleaf species (~6k triangles per tree). */
function budget(o, leafScale = 1.3, leafCount = 0.6) {
  const b = o.branch;
  b.sections = { 0: Math.min(b.sections[0], 8), 1: Math.min(b.sections[1], 5), 2: Math.min(b.sections[2], 4), 3: Math.min(b.sections[3], 2) };
  b.segments = { 0: Math.min(b.segments[0], 7), 1: Math.min(b.segments[1], 4), 2: 3, 3: 3 };
  o.leaves.count = Math.max(3, Math.round(o.leaves.count * leafCount));
  o.leaves.size *= leafScale;
}

/** Species: ez-tree preset, height (m), leaf card texture, tint, bark and shape tuning. */
export const SPECIES = {
  // Broad umbrella crown, like the large shade trees of Alto Paraná.
  canopyLarge: {
    preset: 'ash_large', height: 13.5, leaf: 'leaf_ash', tint: '#eef2c4', bark: 'oak',
    tune: (o) => {
      o.branch.angle = { 1: 58, 2: 46, 3: 50 };
      o.branch.children = { 0: 9, 1: 4, 2: 3 };
      o.branch.start = { 1: 0.42, 2: 0.3, 3: 0 };
      o.branch.length[1] *= 1.12;
      o.branch.force.strength = -0.018;
      budget(o, 1.35, 0.6);
    },
  },
  canopyMedium: { preset: 'ash_medium', height: 9.5, leaf: 'leaf_ash', tint: '#f0f4c6', bark: 'oak', tune: (o) => budget(o, 1.3, 0.55) },
  shadeLarge: {
    preset: 'oak_large', height: 12.5, leaf: 'leaf_oak', tint: '#dfe8b2', bark: 'oak',
    tune: (o) => {
      o.branch.children = { 0: 8, 1: 4, 2: 3 };
      budget(o, 1.3, 0.6);
    },
  },
  shadeMedium: { preset: 'oak_medium', height: 8.5, leaf: 'leaf_oak', tint: '#e6edb8', bark: 'willow', tune: (o) => budget(o, 1.25, 0.6) },
  // Yellow lapacho (tajy sa'yju) in bloom: rounded crown of golden flowers.
  lapacho: {
    preset: 'oak_medium', height: 8.5, leaf: 'leaf_aspen', tint: '#fff6c8', bark: 'willow',
    tune: (o) => {
      o.branch.angle = { 1: 50, 2: 50, 3: 40 };
      budget(o, 1.15, 0.75);
    },
  },
  shrub: { preset: 'bush_1', height: 2.1, leaf: 'leaf_oak', tint: '#d9e2ad', bark: 'willow', tune: (o) => budget(o, 1.2, 0.7) },
  shrubB: { preset: 'bush_2', height: 1.6, leaf: 'leaf_ash', tint: '#e2eab4', bark: 'willow', tune: (o) => budget(o, 1.2, 0.8) },
};

export function makeTreeGeometry(speciesKey, seed, { lowDetail = false } = {}) {
  const spec = SPECIES[speciesKey];
  const tree = new Tree();
  const opts = structuredClone(TreePreset[spec.preset]);
  if (!opts) throw new Error(`Unknown preset ${spec.preset}`);
  tree.options.copy(opts);
  tree.options.seed = seed;
  tree.options.bark.textured = false;
  spec.tune?.(tree.options);
  if (lowDetail) {
    const b = tree.options.branch;
    b.levels = Math.min(b.levels, 2);
    for (const k of Object.keys(b.segments)) b.segments[k] = Math.min(b.segments[k], 4);
    for (const k of Object.keys(b.sections)) b.sections[k] = Math.max(2, Math.ceil(b.sections[k] / 2));
    tree.options.leaves.count = Math.max(4, Math.round(tree.options.leaves.count * 1.4));
    tree.options.leaves.size *= 2.0;
  }
  tree.generate();
  const branches = tree.branchesMesh.geometry;
  const leaves = tree.leavesMesh.geometry;
  // Normalise height and set the trunk base on y = 0.
  branches.computeBoundingBox();
  leaves.computeBoundingBox();
  const box = branches.boundingBox.clone().union(leaves.boundingBox);
  const scale = spec.height / Math.max(0.001, box.max.y - box.min.y);
  for (const g of [branches, leaves]) {
    g.translate(0, -box.min.y, 0);
    g.scale(scale, scale, scale);
  }
  // Crown normals: leaves shade like a soft volume instead of flat cards.
  leaves.computeBoundingBox();
  const centre = leaves.boundingBox.getCenter(new THREE.Vector3());
  centre.y -= (leaves.boundingBox.max.y - leaves.boundingBox.min.y) * 0.15;
  const pos = leaves.attributes.position;
  const nrm = leaves.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).sub(centre).normalize();
    v.y = v.y * 0.7 + 0.45;
    v.normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  tree.branchesMesh.material.dispose();
  tree.leavesMesh.material.dispose();
  return { branches, leaves, height: spec.height };
}

export function barkMaterial(assets, kind) {
  const map = assets.textures[`bark_${kind}_color`]?.clone() || null;
  const normalMap = assets.textures[`bark_${kind}_normal`]?.clone() || null;
  for (const t of [map, normalMap]) {
    if (t) {
      t.repeat.set(2, 0.6);
      t.needsUpdate = true;
    }
  }
  return new THREE.MeshStandardMaterial({ map, normalMap, color: map ? '#d8d0c4' : '#5a4a3c', roughness: 0.92 });
}

/**
 * Alpha-tested foliage thins out with distance because mipmaps average the
 * leaf alpha down. Scale alpha by the sampled mip level to keep crowns dense.
 */
function preserveCoverage(material, textureSize = 512) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      #ifdef USE_MAP
        vec2 texel = vMapUv * ${textureSize.toFixed(1)};
        vec2 ddx = dFdx(texel);
        vec2 ddy = dFdy(texel);
        float mipLevel = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
        diffuseColor.a *= 1.0 + mipLevel * 0.3;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `coverage-${textureSize}`;
  return material;
}

let fallbackLeaves = null;
/** Procedural leaf-cluster card, used only if the leaf textures fail to load. */
function fallbackLeafTexture() {
  if (fallbackLeaves || typeof document === 'undefined') return fallbackLeaves;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rnd = mulberry32(3);
  for (let i = 0; i < 70; i++) {
    const x = 20 + rnd() * 88;
    const y = 10 + rnd() * 100;
    g.fillStyle = `rgb(${50 + rnd() * 40}, ${80 + rnd() * 50}, ${30 + rnd() * 20})`;
    g.beginPath();
    g.ellipse(x, y, 5 + rnd() * 6, 3 + rnd() * 3, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  fallbackLeaves = new THREE.CanvasTexture(c);
  fallbackLeaves.colorSpace = THREE.SRGBColorSpace;
  return fallbackLeaves;
}

export function leafMaterial(assets, key, tint) {
  const map = assets.textures[key] || fallbackLeafTexture();
  return preserveCoverage(new THREE.MeshStandardMaterial({
    map,
    // The leaf cards are photographed in shade; lift them to sunlit albedo.
    color: new THREE.Color(tint).multiplyScalar(1.45),
    // Light transmitted through foliage keeps shaded crowns green, not black.
    emissive: map ? new THREE.Color(tint).multiply(new THREE.Color('#5d7a2c')) : new THREE.Color(0),
    emissiveMap: map,
    emissiveIntensity: 0.22,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0,
    transparent: false,
    ...(map ? {} : { color: new THREE.Color('#4d6a33') }),
  }));
}

// ------------------------------------------------------------------- palm

/** Pindó (queen palm): slender ringed trunk and arching, drooping fronds. */
export function makePalmGeometry(seed, height = 9) {
  const rnd = mulberry32(seed);
  const lean = new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize().multiplyScalar(0.35 + rnd() * 0.5);
  const trunkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(lean.x * 0.3, height * 0.35, lean.z * 0.3),
    new THREE.Vector3(lean.x * 0.8, height * 0.7, lean.z * 0.8),
    new THREE.Vector3(lean.x, height, lean.z),
  ]);
  const trunk = new THREE.TubeGeometry(trunkCurve, 24, 0.17, 8, false);
  // Taper and ring texture via vertex colours.
  const tp = trunk.attributes.position;
  const colors = [];
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const t = y / height;
    const ring = 0.86 + 0.14 * Math.sin(y * 9.0);
    colors.push(0.3 * ring, 0.28 * ring, 0.25 * ring);
    // flare at the base, slimmer at the top
    const c = trunkCurve.getPoint(Math.min(1, Math.max(0, t)));
    const f = (1.35 - 0.45 * t) * (t < 0.05 ? 1.25 : 1);
    tp.setX(i, c.x + (tp.getX(i) - c.x) * f);
    tp.setZ(i, c.z + (tp.getZ(i) - c.z) * f);
  }
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  trunk.deleteAttribute('uv');

  const top = trunkCurve.getPoint(1);
  const parts = [trunk];
  // Crown shaft
  const shaft = new THREE.CylinderGeometry(0.16, 0.2, 0.9, 8);
  shaft.translate(top.x, top.y + 0.3, top.z);
  shaft.deleteAttribute('uv');
  shaft.setAttribute('color', new THREE.Float32BufferAttribute(new Array(shaft.attributes.position.count).fill(0).flatMap(() => [0.34, 0.4, 0.22]), 3));
  parts.push(shaft);

  const fronds = 18;
  const leafPos = [];
  const leafCol = [];
  for (let f = 0; f < fronds; f++) {
    const az = (f / fronds) * Math.PI * 2 + rnd() * 0.4;
    const up = 0.55 - rnd() * 0.9; // initial elevation
    const len = 3.2 + rnd() * 0.9;
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const origin = new THREE.Vector3(top.x, top.y + 0.7, top.z);
    const steps = 18;
    let prev = origin.clone();
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      // Arching rachis: rises then droops under its own weight.
      const p = origin
        .clone()
        .addScaledVector(dir, len * t)
        .add(new THREE.Vector3(0, len * (up * t - 0.75 * t * t), 0));
      const along = p.clone().sub(prev).normalize();
      // Leaflets hang down on both sides.
      const leafLen = 0.95 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.15;
      for (const sgn of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const base = prev.clone().lerp(p, k / 2);
          const droop = new THREE.Vector3(0, -0.55 - rnd() * 0.3, 0);
          const outward = side.clone().multiplyScalar(sgn).add(droop).normalize();
          const tip = base.clone().addScaledVector(outward, leafLen).addScaledVector(along, 0.12);
          const w = along.clone().multiplyScalar(0.06);
          leafPos.push(
            base.x - w.x, base.y - w.y, base.z - w.z,
            base.x + w.x, base.y + w.y, base.z + w.z,
            tip.x, tip.y, tip.z,
          );
          const g = 0.85 + rnd() * 0.25;
          const yellow = 1 - t * 0.3;
          for (let c = 0; c < 3; c++) leafCol.push(0.2 * g * (1.15 - yellow * 0.15), 0.3 * g, 0.1 * g);
        }
      }
      // rachis segment as a thin quad
      const w2 = side.clone().multiplyScalar(0.025);
      leafPos.push(prev.x - w2.x, prev.y, prev.z - w2.z, prev.x + w2.x, prev.y, prev.z + w2.z, p.x, p.y, p.z);
      for (let c = 0; c < 3; c++) leafCol.push(0.3, 0.33, 0.18);
      prev = p;
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(leafPos, 3));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(leafCol, 3));
  leaves.computeVertexNormals();
  // Crown normals for soft shading.
  const lp = leaves.attributes.position;
  const ln = leaves.attributes.normal;
  const c = new THREE.Vector3(top.x, top.y - 0.4, top.z);
  const v = new THREE.Vector3();
  for (let i = 0; i < lp.count; i++) {
    v.fromBufferAttribute(lp, i).sub(c).normalize();
    v.y = v.y * 0.6 + 0.5;
    v.normalize();
    ln.setXYZ(i, v.x, v.y, v.z);
  }
  for (const p of parts) if (!p.attributes.normal) p.computeVertexNormals();
  const trunkGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  return { trunk: trunkGeo, leaves };
}

// --------------------------------------------------------------- impostors

function bakeImpostor(renderer, branches, leaves, barkMat, leafMat, size = 256) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(branches, barkMat), new THREE.Mesh(leaves, leafMat));
  scene.add(group);
  // Bake albedo, not lighting: an ambient light of intensity π makes Lambert
  // shading return the base colour, so the impostors are lit once, in the scene.
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const box = new THREE.Box3().setFromObject(group);
  const h = box.max.y - box.min.y;
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const half = Math.max(h, w) / 2;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 200);
  cam.position.set(0, box.min.y + half, 60);
  cam.lookAt(0, box.min.y + half, 0);
  // Render targets receive linear output, so the texture stays linear (half float avoids banding).
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, type: THREE.HalfFloatType });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.toneMapping = prevTone;
  return { texture: rt.texture, target: rt, aspectHeight: half * 2, baseOffset: half - (box.min.y + half) };
}

// ---------------------------------------------------------------- placement

/** The club's waterfront and beach (club frame: a along the bank, b inland). */
function inClubBeach(x, z) {
  const dx = x - 132.3;
  const dz = z - 22.6;
  const a = dx * 0.6716 + dz * 0.7408;
  const b = dx * -0.7408 + dz * 0.6716;
  return a > -10 && a < 44 && b > -45 && b < 14;
}

export class Vegetation {
  constructor({ assets, renderer, settings, terrain, lots, lake }) {
    this.assets = assets;
    this.renderer = renderer;
    this.settings = settings;
    this.terrain = terrain;
    this.lots = lots;
    this.lake = lake;
    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    this.disposables = [];
    this.roadRing = [...ROADS, ROADS[0]];
    this.accessRing = [...NAUTICAL_ACCESS, NAUTICAL_ACCESS[0]];
  }

  _blocked(x, z, clearance = 2) {
    const p = { x, z };
    if (pointInPolygon(p, ROADS) || distanceToPolyline(p, this.roadRing) < clearance) return true;
    if (pointInPolygon(p, NAUTICAL_ACCESS) || distanceToPolyline(p, this.accessRing) < clearance * 0.5) return true;
    if (this.terrain.streetDistance(x, z) < clearance + 1) return true;
    if (this.terrain.lakeDistance(x, z) < clearance) return true;
    for (const lot of this.lots) {
      const c = lot.centroid;
      if (Math.abs(c.x - x) < 40 && Math.abs(c.z - z) < 40 && pointInPolygon(p, lot.polygon)) return true;
    }
    return false;
  }

  _instanced(geo, mat, transforms, { castShadow = true, receiveShadow = true } = {}) {
    if (!transforms.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
    transforms.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  _matrix(x, z, scale, rot, yOffset = 0) {
    const y = this.terrain.sample(x, z).h + yOffset;
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(scale, scale, scale));
    return m;
  }

  async build(onStep = () => {}) {
    const rnd = mulberry32(20241024);
    const density = this.settings.treeDensity;
    const placements = { canopyLarge: [], canopyMedium: [], shadeLarge: [], shadeMedium: [], lapacho: [], shrub: [], shrubB: [], palm: [] };

    const tryPlace = (kind, x, z, clearance = 3, scaleRange = [0.85, 1.15]) => {
      if (this._blocked(x, z, clearance)) return false;
      placements[kind].push(this._matrix(x, z, scaleRange[0] + rnd() * (scaleRange[1] - scaleRange[0]), rnd() * Math.PI * 2));
      return true;
    };
    const pickBroadleaf = (r) => (r < 0.32 ? 'canopyLarge' : r < 0.55 ? 'shadeLarge' : r < 0.75 ? 'canopyMedium' : r < 0.9 ? 'shadeMedium' : 'shrub');

    const scatter = (poly, count, pick, clearance = 3) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const q of poly) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
        minZ = Math.min(minZ, q.z);
        maxZ = Math.max(maxZ, q.z);
      }
      let placed = 0;
      for (let k = 0; k < count * 10 && placed < count; k++) {
        const x = minX + rnd() * (maxX - minX);
        const z = minZ + rnd() * (maxZ - minZ);
        if (!pointInPolygon({ x, z }, poly)) continue;
        if (tryPlace(pick(rnd()), x, z, clearance)) placed++;
      }
    };

    // 1. Riverbank: the strip between the title boundary and the water keeps
    //    its gallery forest.
    for (let k = 0; k < 520; k++) {
      const x = 20 + rnd() * 200;
      const z = -140 + rnd() * 260;
      if (insideSite({ x, z })) continue;
      const shore = this.terrain.lakeDistance(x, z);
      if (shore < 1.5 || shore > 16) continue;
      if (this.terrain.devDistance(x, z) < 1.5) continue;
      if (inClubBeach(x, z)) continue; // the club's beach stays open to the water
      if (rnd() > 0.5 + 0.5 * density) continue;
      tryPlace(pickBroadleaf(rnd()), x, z, 2.5);
    }

    // 2. Common areas: the club grounds and the administration parcel, with
    //    yellow lapachos as accents (their final design is not yet defined).
    // The club is built (js/experience/world/club.js): planting only at its
    // inland edge, behind the quinchos and around the playground.
    const club = COMMON_AREAS.find((c) => c.id === 'club');
    if (club) {
      const edge = club.polygon.filter((p) => p.x < 120);
      scatter(edge.length >= 3 ? edge : club.polygon, Math.round(4 + 3 * density), (r) => (r < 0.35 ? 'lapacho' : 'shrubB'), 3);
    }
    const admin = COMMON_AREAS.find((c) => c.id === 'administracion');
    if (admin) scatter(admin.polygon, 3, (r) => (r < 0.5 ? 'lapacho' : 'shrub'), 2);
    // Pindó palms flank the entrance from the west street.
    const entrance = ROADS.filter((q) => Math.abs(q.x - SITE[3].x) < 14).sort((a, b) => a.z - b.z);
    if (entrance.length) {
      const zs = [entrance[0].z - 2.5, entrance[entrance.length - 1].z + 2.5];
      for (const z of zs) placements.palm.push(this._matrix(SITE[3].x - 3 - rnd(), z, 0.95 + rnd() * 0.2, rnd() * Math.PI * 2));
    }

    // 3. Neighbouring land: a windbreak along the northern property line and
    //    scattered trees in the fields to the west and south.
    for (let k = 0; k < 2600; k++) {
      const x = -360 + rnd() * 560;
      const z = -260 + rnd() * 520;
      const dev = this.terrain.devDistance(x, z);
      if (dev < 4) continue;
      const band = dev < 26 ? 0.22 : dev < 60 ? 0.03 : 0;
      if (rnd() > band * (0.5 + density * 0.5)) continue;
      tryPlace(pickBroadleaf(rnd()), x, z, 3, [0.8, 1.2]);
    }

    // Generate geometry only for species in use (yield between species to keep the UI responsive).
    let seed = 11;
    const kinds = Object.keys(placements).filter((k) => placements[k].length);
    let step = 0;
    const color = new THREE.Color();
    for (const kind of kinds) {
      if (kind === 'palm') {
        const palm = makePalmGeometry(7);
        const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        const frondMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
        this._instanced(palm.trunk, trunkMat, placements.palm);
        this._instanced(palm.leaves, frondMat, placements.palm);
        this.disposables.push(palm.trunk, palm.leaves, trunkMat, frondMat);
        this.palmGeometry = palm;
        this.palmMaterials = { trunkMat, frondMat };
      } else {
        this.getSpecies(kind, seed);
        seed += 2;
        const sp = this.speciesCache[kind];
        sp.variants.forEach((v, vi) => {
          const list = placements[kind].filter((_, i) => i % 2 === vi);
          this._instanced(v.branches, sp.bark, list);
          const leaves = this._instanced(v.leaves, sp.leaf, list);
          // Per-tree variation in foliage tone.
          list.forEach((_, i) => {
            const k = rnd();
            color.setRGB(0.86 + k * 0.24, 0.9 + k * 0.16 + rnd() * 0.06, 0.82 + k * 0.12);
            leaves?.setColorAt(i, color);
          });
          if (leaves?.instanceColor) leaves.instanceColor.needsUpdate = true;
        });
      }
      onStep(++step / (kinds.length + 1));
      await nextFrame();
    }

    if (this.settings.farForest) this._buildLandscape(rnd);
    onStep(1);
    return this;
  }

  /** Lazily generate (and cache) a species' two geometry variants and materials. */
  getSpecies(kind, seed = 101) {
    this.speciesCache = this.speciesCache || {};
    if (this.speciesCache[kind]) return this.speciesCache[kind];
    const spec = SPECIES[kind];
    // Phones get the reduced-detail generator (two branch levels, larger leaf cards).
    const lowDetail = this.settings.tier === 'low';
    const variants = [makeTreeGeometry(kind, seed, { lowDetail }), makeTreeGeometry(kind, seed * 7 + 3, { lowDetail })];
    const bark = barkMaterial(this.assets, spec.bark);
    const leaf = leafMaterial(this.assets, spec.leaf, spec.tint);
    for (const v of variants) this.disposables.push(v.branches, v.leaves);
    this.disposables.push(bark, leaf, bark.map, bark.normalMap);
    this.speciesCache[kind] = { variants, bark, leaf };
    return this.speciesCache[kind];
  }

  /**
   * The wider landscape as baked impostors (two crossed cards per tree): tree
   * lines along the field margins, remnant forest patches, scattered pasture
   * trees and the far lake shore. Cheap enough to be generous.
   */
  _buildLandscape(rnd) {
    const kinds = ['canopyLarge', 'shadeLarge'];
    const impostors = kinds.map((kind, i) => {
      const spec = SPECIES[kind];
      const low = makeTreeGeometry(kind, 300 + i, { lowDetail: true });
      const bark = barkMaterial(this.assets, spec.bark);
      const leaf = leafMaterial(this.assets, spec.leaf, spec.tint);
      const baked = bakeImpostor(this.renderer, low.branches, low.leaves, bark, leaf);
      low.branches.dispose();
      low.leaves.dispose();
      bark.map?.dispose();
      bark.normalMap?.dispose();
      bark.dispose();
      leaf.dispose();
      return baked;
    });

    const spots = [];
    const ok = (x, z) =>
      this.terrain.devDistance(x, z) > 60 &&
      this.terrain.lakeDistance(x, z) > 7 &&
      this.terrain.streetDistance(x, z) > 5;
    const add = (x, z, s = 1) => {
      if (ok(x, z)) spots.push([x, z, s]);
    };
    const fr = 0.38;
    const toWorld = (fx, fy) => [Math.cos(fr) * fx - Math.sin(fr) * fy, Math.sin(fr) * fx + Math.cos(fr) * fy];
    const hash = (a, b) => {
      const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return h - Math.floor(h);
    };
    const W = 230;
    const H = 150;
    const keep = 0.45 + 0.55 * this.settings.treeDensity;
    // Tree lines on field margins (matching the farmland cells in the terrain shader).
    for (let i = -9; i <= 9; i++) {
      for (let j = -14; j <= 14; j++) {
        if (hash(i, j) < 0.48) {
          for (let f = 0; f < W; f += 8 + rnd() * 7) {
            if (rnd() < keep) add(...toWorld(i * W + f, j * H + (rnd() - 0.5) * 3), 0.8 + rnd() * 0.5);
          }
        }
        if (hash(i + 31, j - 17) < 0.4) {
          for (let f = 0; f < H; f += 8 + rnd() * 7) {
            if (rnd() < keep) add(...toWorld(i * W + (rnd() - 0.5) * 3, j * H + f), 0.8 + rnd() * 0.5);
          }
        }
      }
    }
    // Remnant forest patches and the far side of the lake.
    for (let k = 0; k < 26000 * keep; k++) {
      const x = (rnd() - 0.5) * 4200;
      const z = (rnd() - 0.5) * 4200 - 300;
      const patch = fbm(x * 0.0021, z * 0.0021, 4);
      const farShore = z < -330 ? 0.25 : 0;
      if (patch + farShore > 0.2 && rnd() < 0.55) add(x, z, 0.85 + rnd() * 0.55);
      else if (rnd() < 0.012) add(x, z, 0.7 + rnd() * 0.5); // lone pasture trees
    }

    impostors.forEach((imp, i) => {
      const g1 = new THREE.PlaneGeometry(imp.aspectHeight, imp.aspectHeight);
      g1.translate(0, imp.aspectHeight / 2, 0);
      const g2 = g1.clone().rotateY(Math.PI / 2);
      const geo = mergeGeometries([g1, g2]);
      g1.dispose();
      g2.dispose();
      const n = geo.attributes.normal;
      for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
      const mat = preserveCoverage(new THREE.MeshStandardMaterial({
        map: imp.texture,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 1,
        // Same transmitted-light term as the full trees.
        emissive: new THREE.Color('#9fb070'),
        emissiveMap: imp.texture,
        emissiveIntensity: 0.25,
      }), 256);
      const mine = spots.filter((_, k) => k % 2 === i);
      const transforms = mine.map(([x, z, sc]) => this._matrix(x, z, sc, rnd() * Math.PI));
      const mesh = this._instanced(geo, mat, transforms, { castShadow: false, receiveShadow: false });
      if (mesh) {
        const c = new THREE.Color();
        mine.forEach((_, k) => {
          const v = rnd();
          mesh.setColorAt(k, c.setRGB(0.8 + v * 0.3, 0.84 + v * 0.24, 0.74 + v * 0.2));
        });
        mesh.instanceColor.needsUpdate = true;
      }
      this.disposables.push(geo, mat, imp.target);
    });
    this.impostors = impostors;
    this.landscapeCount = spots.length;
  }

  /** Geometry and materials for planting inside a residence garden. */
  plantKit() {
    return {
      species: this.speciesCache || {},
      ensure: (kind) => this.getSpecies(kind),
      palm: this.palmGeometry,
      palmMaterials: this.palmMaterials,
      makePalm: (seed, height) => makePalmGeometry(seed, height),
    };
  }

  dispose() {
    for (const d of this.disposables) d?.dispose?.();
    this.group.clear();
  }
}
