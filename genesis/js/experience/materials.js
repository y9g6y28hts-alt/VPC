// Physically based material library. Textured materials expect UVs in metres
// (see applyBoxUV in house/geometry.js); the texture repeat converts metres to
// tiles. Every material degrades to a plain colour if its texture failed to load.
import * as THREE from 'three';
import { TILE_M } from './assets.js';

export function createMaterials(assets) {
  const textured = (name, { color = 0xffffff, fallback, roughness = 0.9, metalness = 0, normalScale = 1, ...rest } = {}) => {
    const map = assets.tiled(`${name}_albedo`, TILE_M[name]);
    const normalMap = assets.tiled(`${name}_normal`, TILE_M[name]);
    const m = new THREE.MeshStandardMaterial({
      name,
      map,
      normalMap,
      normalScale: new THREE.Vector2(normalScale, normalScale),
      color: map ? color : fallback ?? color,
      roughness,
      metalness,
      ...rest,
    });
    return m;
  };

  const lib = {
    plaster: textured('plaster', { fallback: '#e8e3da', roughness: 0.92, normalScale: 0.6 }),
    // Slightly warm, used for slab fascias and soffit returns.
    plasterWarm: textured('plaster', { color: new THREE.Color(0.96, 0.94, 0.9), fallback: '#ddd6cb', roughness: 0.92, normalScale: 0.5 }),
    concrete: textured('concrete', { fallback: '#a9a59d', roughness: 0.86, normalScale: 0.8 }),
    concreteFresh: textured('concrete', { color: new THREE.Color(0.62, 0.62, 0.62), fallback: '#6d6b67', roughness: 0.6, normalScale: 0.6 }),
    concreteLight: textured('concrete', { color: new THREE.Color(1.12, 1.1, 1.06), fallback: '#bdb9b0', roughness: 0.85, normalScale: 0.5 }),
    brick: textured('brick', { fallback: '#b25c3b', roughness: 0.88, normalScale: 1.2 }),
    stone: textured('stone', { fallback: '#b2a184', roughness: 0.84, normalScale: 1.4 }),
    timber: textured('timber', { color: new THREE.Color(0.92, 0.9, 0.88), fallback: '#7b4c2e', roughness: 0.62, normalScale: 0.5 }),
    timberDark: textured('timber', { color: new THREE.Color(0.36, 0.32, 0.3), fallback: '#4a3324', roughness: 0.6, normalScale: 0.5 }),
    cladding: textured('cladding', { color: new THREE.Color(0.95, 0.92, 0.9), fallback: '#6e4a33', roughness: 0.66, normalScale: 0.8 }),
    deck: textured('deck', { fallback: '#8a5a38', roughness: 0.7, normalScale: 0.8 }),
    pavers: textured('pavers', { fallback: '#b7b0a4', roughness: 0.82, normalScale: 0.8 }),
    gravel: textured('gravel', { fallback: '#a8a196', roughness: 0.95, normalScale: 1.0 }),
    sand: textured('sand', { fallback: '#c2a27a', roughness: 0.97 }),
    plywood: textured('plywood', { fallback: '#6a3a26', roughness: 0.55, normalScale: 0.4 }),
    soil: textured('soil', { fallback: '#8a4329', roughness: 0.96 }),

    // Dark bronze anodised aluminium (window frames, copings, railings).
    metalDark: new THREE.MeshStandardMaterial({ name: 'metalDark', color: '#2a2622', roughness: 0.38, metalness: 0.65 }),
    // Galvanised steel (scaffolding, props).
    steelGalv: new THREE.MeshStandardMaterial({ name: 'steelGalv', color: '#9ea3a6', roughness: 0.45, metalness: 0.8 }),
    rebar: new THREE.MeshStandardMaterial({ name: 'rebar', color: '#5e3a26', roughness: 0.75, metalness: 0.55 }),
    // Painted steel column / structural details.
    steelPainted: new THREE.MeshStandardMaterial({ name: 'steelPainted', color: '#2f2c2a', roughness: 0.5, metalness: 0.4 }),
    // Structural steel, shop-primed in graphite micaceous paint.
    steelStructural: new THREE.MeshStandardMaterial({ name: 'steelStructural', color: '#3b3e42', roughness: 0.42, metalness: 0.55 }),
    poolTile: new THREE.MeshStandardMaterial({ name: 'poolTile', color: '#8fbfc0', roughness: 0.35 }),
    stringLine: new THREE.MeshBasicMaterial({ name: 'stringLine', color: '#f1e9da', transparent: true, opacity: 0.9 }),
    stake: new THREE.MeshStandardMaterial({ name: 'stake', color: '#a07a52', roughness: 0.85 }),
    markerTape: new THREE.MeshStandardMaterial({ name: 'markerTape', color: '#d0612f', roughness: 0.7 }),
  };

  // Architectural glass: opaque, dark and reflective, as façades read in
  // daylight. The interior glow is emissive and ramps in at completion.
  lib.glass = new THREE.MeshPhysicalMaterial({
    name: 'glass',
    color: '#0d1316',
    roughness: 0.02,
    metalness: 0,
    ior: 1.52,
    specularIntensity: 1,
    envMapIntensity: 2.2,
    clearcoat: 0.0,
    emissive: new THREE.Color('#ffb36b'),
    emissiveIntensity: 0,
  });
  lib.glassRail = new THREE.MeshPhysicalMaterial({
    name: 'glassRail',
    color: '#b8c7c4',
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    envMapIntensity: 1.4,
    depthWrite: false,
  });
  lib.water = new THREE.MeshPhysicalMaterial({
    name: 'poolWater',
    color: '#2f8c8e',
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.78,
    envMapIntensity: 1.2,
    normalMap: assets.textures.water_normal || null,
    normalScale: new THREE.Vector2(0.15, 0.15),
  });
  if (lib.water.normalMap) {
    lib.water.normalMap = lib.water.normalMap.clone();
    lib.water.normalMap.repeat.set(0.35, 0.35);
    lib.water.normalMap.needsUpdate = true;
  }
  lib.downlight = new THREE.MeshBasicMaterial({ name: 'downlight', color: '#ffd9a8', transparent: true, opacity: 0 });
  return lib;
}

export function disposeMaterials(lib) {
  for (const m of Object.values(lib)) {
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      if (m[key]) m[key].dispose();
    }
    m.dispose();
  }
}
