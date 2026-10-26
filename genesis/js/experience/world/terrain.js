// Ground, roads and lake of the surveyed masterplan.
//
// The terrain is one warped grid (dense near the development, coarse towards the
// horizon). Heights are flat inside the development so lots and slabs sit level,
// roll gently beyond it and drop under the lake. A custom MeshStandardMaterial
// shader blends lawn and red laterite soil with anti-tiling and drives the
// "site preparation" and "lawn returns" construction stages for the selected lot.
import * as THREE from 'three';
import { fbm } from '../../core/noise.js';
import { distanceToPolyline, pointInPolygon } from '../../core/lot-layout.js';
import { SITE, ROADS, NAUTICAL_ACCESS, ENTRANCE_PAD, OUTSIDE_STREETS, lakePolygon, insideSite } from '../../data/viva-lago.js';
import { TILE_M } from '../assets.js';

export const WATER_LEVEL = -0.28;

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class TerrainModel {
  constructor() {
    this.site = SITE;
    this.siteRing = [...SITE, SITE[0]];
    this.streets = OUTSIDE_STREETS;
    this.lake = lakePolygon();
    this.lakeRing = [...this.lake, this.lake[0]];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of this.lake) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    this.lakeBox = { minX: minX - 40, maxX: maxX + 40, minZ: minZ - 40, maxZ: maxZ + 40 };
  }

  /** Distance to the development (0 inside the title boundary). */
  devDistance(x, z) {
    const p = { x, z };
    return insideSite(p) ? 0 : distanceToPolyline(p, this.siteRing);
  }

  /** Distance to the nearest public street centreline outside the site. */
  streetDistance(x, z) {
    let d = Infinity;
    for (const s of this.streets) d = Math.min(d, distanceToPolyline({ x, z }, s.points) - s.width / 2);
    return d;
  }

  /** Signed distance to the shoreline: negative inside the lake. */
  lakeDistance(x, z) {
    const b = this.lakeBox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return 1e4;
    const d = distanceToPolyline({ x, z }, this.lakeRing);
    return pointInPolygon({ x, z }, this.lake) ? -d : d;
  }

  sample(x, z) {
    const dev = this.devDistance(x, z);
    const flatness = Math.min(smooth(18, 220, dev), smooth(4, 40, this.streetDistance(x, z)));
    const rolling = fbm(x * 0.0032, z * 0.0032, 4) * 9 + fbm(x * 0.013, z * 0.013, 3) * 1.4;
    let h = rolling * flatness;
    const lake = this.lakeDistance(x, z);
    let shore = 0;
    if (lake < 0) {
      h = Math.min(h, WATER_LEVEL - 0.15 - 2.4 * smooth(0, 35, -lake));
      shore = 1 - smooth(0, 6, -lake);
    } else if (lake < 14) {
      const t = smooth(0, 14, lake);
      h = WATER_LEVEL - 0.12 + (h - (WATER_LEVEL - 0.12)) * t;
      shore = 1 - smooth(1, 5, lake);
    }
    // The development itself is level; the riverbank falls away outside it.
    if (dev <= 0) {
      h = 0;
      shore = 0;
    } else if (lake > 0) {
      h *= smooth(0, 3, dev);
    }
    // 1 = mowed development lawn, 0 = open field.
    const mowed = 1 - smooth(3, 14, dev);
    return { h, mowed, shore };
  }
}

function warpedAxis(segments, extent, power) {
  const out = [];
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * 2 - 1;
    out.push(Math.sign(u) * extent * Math.pow(Math.abs(u), power));
  }
  return out;
}

const TERRAIN_VERT_PARS = /* glsl */ `
#ifdef LOT_TINT
attribute vec3 aLotTint;
varying vec3 vLotTint;
#endif
attribute float aMowed;
attribute float aShore;
varying vec3 vGPos;
varying vec3 vGNormal;
varying float vMowed;
varying float vShore;
`;

const TERRAIN_FRAG_PARS = /* glsl */ `
#ifdef LOT_TINT
varying vec3 vLotTint;
#endif
uniform sampler2D tGrass;
uniform sampler2D tGrassN;
uniform sampler2D tSoil;
uniform sampler2D tSoilN;
uniform sampler2D tMacro;
uniform float uGrassTile;
uniform float uSoilTile;
uniform vec2 uSiteOrigin;
uniform vec2 uSiteRight;
uniform vec2 uSiteIn;
uniform vec2 uSiteHalfWidthDepth;
uniform float uSiteSoil;
uniform float uSiteLawn;
uniform vec4 uHole; // lot-local x0, x1, d0, d1 cut away for the pool basin
uniform float uHoleActive;
varying vec3 vGPos;
varying vec3 vGNormal;
varying float vMowed;
varying float vShore;

vec4 sampleAntiTile(sampler2D t, vec2 p, float tile, float macro) {
  vec2 uvA = p / tile;
  float a = 0.6435; // ~37 degrees
  vec2 uvB = mat2(cos(a), -sin(a), sin(a), cos(a)) * p / (tile * 2.37) + 0.37;
  return mix(texture2D(t, uvA), texture2D(t, uvB), smoothstep(0.35, 0.65, macro));
}

float siteMask(vec2 p, out float lx, out float ld) {
  vec2 rel = p - uSiteOrigin;
  lx = dot(rel, uSiteRight);
  ld = dot(rel, uSiteIn);
  float inX = 1.0 - smoothstep(uSiteHalfWidthDepth.x - 0.6, uSiteHalfWidthDepth.x, abs(lx));
  float inD = smoothstep(0.0, 0.6, ld) * (1.0 - smoothstep(uSiteHalfWidthDepth.y - 0.6, uSiteHalfWidthDepth.y, ld));
  return inX * inD;
}
`;

/**
 * @param {object} assets
 * @param {{ shared?: object, lotTint?: boolean }} options `shared` reuses another
 *   terrain material's uniforms (the lot overlay must follow the same site state).
 */
export function createTerrainMaterial(assets, { shared, lotTint = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0 });
  if (lotTint) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
  }
  const uniforms = shared || {
    tGrass: { value: assets.textures.grass_albedo },
    tGrassN: { value: assets.textures.grass_normal },
    tSoil: { value: assets.textures.soil_albedo },
    tSoilN: { value: assets.textures.soil_normal },
    tMacro: { value: assets.textures.macro_variation },
    uGrassTile: { value: TILE_M.grass },
    uSoilTile: { value: TILE_M.soil },
    uSiteOrigin: { value: new THREE.Vector2(1e5, 1e5) },
    uSiteRight: { value: new THREE.Vector2(1, 0) },
    uSiteIn: { value: new THREE.Vector2(0, 1) },
    uSiteHalfWidthDepth: { value: new THREE.Vector2(9.6, 39.6) },
    uSiteSoil: { value: 0 },
    uSiteLawn: { value: 0 },
    uHole: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHoleActive: { value: 0 },
  };
  const hasTextures = Boolean(uniforms.tGrass.value && uniforms.tSoil.value && uniforms.tMacro.value && uniforms.tGrassN.value && uniforms.tSoilN.value);
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines || {}), TERRAIN_TEXTURED: hasTextures ? 1 : 0 };
    if (lotTint) shader.defines.LOT_TINT = 1;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_VERT_PARS}`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGNormal = normalize(mat3(modelMatrix) * objectNormal);
        vMowed = aMowed;
        vShore = aShore;
        #ifdef LOT_TINT
        vLotTint = aLotTint;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_PARS}`)
      .replace(
        '#include <map_fragment>',
        `
        vec2 gp = vGPos.xz;
        #if TERRAIN_TEXTURED
          vec3 macro = texture2D(tMacro, gp / 210.0).rgb;
          vec3 macro2 = texture2D(tMacro, gp / 47.0 + 0.5).rgb;
          vec3 grass = sampleAntiTile(tGrass, gp, uGrassTile, macro2.g).rgb;
          grass = mix(grass, vec3(dot(grass, vec3(0.299, 0.587, 0.114))), 0.28);
          // Mowed lawn inside the development, rougher dry pasture in the fields.
          vec3 field = grass * vec3(1.1, 0.96, 0.7) * (0.82 + 0.34 * macro.r);
          vec3 lawn = grass * vec3(0.98, 0.95, 0.76) * (0.86 + 0.24 * macro.g);
          vec3 soil = sampleAntiTile(tSoil, gp, uSoilTile, macro.b).rgb;
          // Farmland patchwork beyond the development: pasture, stubble,
          // young crop rows and ploughed red earth, with grassy margins.
          const float fr = 0.38;
          vec2 fp = mat2(cos(fr), -sin(fr), sin(fr), cos(fr)) * gp;
          vec2 cellSize = vec2(230.0, 150.0);
          vec2 cell = floor(fp / cellSize);
          vec2 inCell = fract(fp / cellSize);
          float hsh = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
          float edgeDist = min(min(inCell.x, 1.0 - inCell.x) * cellSize.x, min(inCell.y, 1.0 - inCell.y) * cellSize.y);
          vec3 farm;
          if (hsh < 0.32) farm = field * vec3(0.95, 1.04, 0.92);
          else if (hsh < 0.52) farm = field * vec3(1.25, 1.08, 0.72);
          else if (hsh < 0.8) {
            float rows = 0.5 + 0.5 * sin(fp.x * 2.4);
            farm = mix(soil * 0.95, grass * vec3(0.9, 1.12, 0.72), 0.55 + 0.35 * rows);
          } else {
            float furrow = 0.5 + 0.5 * sin(fp.y * 1.7 + macro.r * 4.0);
            farm = soil * (0.82 + 0.26 * furrow);
          }
          farm = mix(field, farm, smoothstep(3.0, 9.0, edgeDist));
          vec3 ground = mix(farm, lawn, vMowed);
          ground *= 0.88 + 0.24 * macro2.b;
          #ifdef LOT_TINT
            ground *= vLotTint;
          #endif
        #else
          vec3 ground = mix(vec3(0.36, 0.42, 0.2), vec3(0.3, 0.4, 0.18), vMowed);
          vec3 soil = vec3(0.5, 0.25, 0.15);
          vec3 macro = vec3(0.5);
        #endif
        vec3 wetShore = mix(soil * vec3(0.55, 0.5, 0.45), vec3(0.32, 0.28, 0.22), 0.5);
        ground = mix(ground, wetShore, smoothstep(0.55, 0.95, vShore));

        float lx; float ld;
        float site = siteMask(gp, lx, ld);
        if (uHoleActive > 0.5 && lx > uHole.x && lx < uHole.y && ld > uHole.z && ld < uHole.w) discard;
        // Site clearing sweeps from the street towards the back with a ragged edge.
        float n1 = macro.r * 0.6 + macro.g * 0.4;
        float clearFront = uSiteSoil * 1.35 - (ld / (uSiteHalfWidthDepth.y * 2.0)) * 0.35 - n1 * 0.25;
        float soilAmt = site * smoothstep(0.0, 0.08, clearFront);
        // Lawn returns patchily during landscaping.
        float lawnAmt = smoothstep(0.0, 0.12, uSiteLawn * 1.3 - n1 * 0.3);
        soilAmt *= 1.0 - lawnAmt;
        vec3 groundColor = mix(ground, soil, soilAmt);
        diffuseColor.rgb *= groundColor;
        float vSoilAmt = soilAmt;
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        #if TERRAIN_TEXTURED
        {
          vec3 nG = sampleAntiTile(tGrassN, gp, uGrassTile, macro2.g).xyz * 2.0 - 1.0;
          vec3 nS = sampleAntiTile(tSoilN, gp, uSoilTile, macro.b).xyz * 2.0 - 1.0;
          vec3 nm = normalize(mix(nG, nS, vSoilAmt));
          vec3 N = normalize(vGNormal);
          vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
          vec3 B = cross(T, N);
          vec3 wn = normalize(T * nm.x + B * nm.y + N * nm.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }
        #endif
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.78, smoothstep(0.3, 0.9, vShore));`,
      );
  };
  mat.customProgramCacheKey = () => `terrain-${hasTextures ? 1 : 0}-${lotTint ? 1 : 0}`;
  return mat;
}

export function buildTerrain(model, assets, { segments = 360, extent = 2600 } = {}) {
  const xs = warpedAxis(segments, extent, 1.75);
  const zs = xs;
  const n = (segments + 1) * (segments + 1);
  const positions = new Float32Array(n * 3);
  const mowed = new Float32Array(n);
  const shore = new Float32Array(n);
  let i = 0;
  for (let zi = 0; zi <= segments; zi++) {
    for (let xi = 0; xi <= segments; xi++) {
      const x = xs[xi];
      const z = zs[zi];
      const s = model.sample(x, z);
      positions[i * 3] = x;
      positions[i * 3 + 1] = s.h;
      positions[i * 3 + 2] = z;
      mowed[i] = s.mowed;
      shore[i] = s.shore;
      i++;
    }
  }
  const index = [];
  for (let zi = 0; zi < segments; zi++) {
    for (let xi = 0; xi < segments; xi++) {
      const a = zi * (segments + 1) + xi;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aMowed', new THREE.BufferAttribute(mowed, 1));
  geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = createTerrainMaterial(assets);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

// --------------------------------------------------------------------- roads

function ribbon(points, halfWidth, y, { uvAcross = true } = {}) {
  // points: dense centreline [{x,z}], returns BufferGeometry with metre UVs.
  const pos = [];
  const uv = [];
  const idx = [];
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const o = points[Math.max(i - 1, 0)];
    let tx = q.x - o.x;
    let tz = q.z - o.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz;
    const nz = tx;
    if (i > 0) along += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    pos.push(p.x + nx * halfWidth, y, p.z + nz * halfWidth, p.x - nx * halfWidth, y, p.z - nz * halfWidth);
    if (uvAcross) uv.push(0, along, halfWidth * 2, along);
    else uv.push(along, 0, along, halfWidth * 2);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ensure the ribbon faces up regardless of path direction.
  if (g.attributes.normal.getY(0) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

/** Curb: a small extruded profile following a polyline offset. */
function curb(points, offset, { width = 0.15, height = 0.13, y = 0 } = {}) {
  const pos = [];
  const idx = [];
  const uv = [];
  let along = 0;
  const rows = 4; // outer-bottom, outer-top, inner-top, inner-bottom
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[Math.min(i + 1, points.length - 1)];
    const o = points[Math.max(i - 1, 0)];
    let tx = q.x - o.x;
    let tz = q.z - o.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz;
    const nz = tx;
    if (i > 0) along += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
    const o1 = offset - width / 2;
    const o2 = offset + width / 2;
    pos.push(p.x + nx * o1, y, p.z + nz * o1);
    pos.push(p.x + nx * o1, y + height, p.z + nz * o1);
    pos.push(p.x + nx * o2, y + height, p.z + nz * o2);
    pos.push(p.x + nx * o2, y, p.z + nz * o2);
    uv.push(along, 0, along, height, along, height + width, along, height * 2 + width);
    if (i > 0) {
      const a = (i - 1) * rows;
      const b = i * rows;
      for (let r = 0; r < rows - 1; r++) idx.push(a + r, b + r, a + r + 1, a + r + 1, b + r, b + r + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function densify(points, step = 2) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** Flat polygon with metre UVs (world x / -z), lying at height y. */
function flatPolygon(points, y) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getX(k), -p.getZ(k));
  g.translate(0, y, 0);
  return g;
}

/** Outline segments of a polygon that are not on the title boundary (those get curbs). */
function curbRuns(points, boundaryRing) {
  const runs = [];
  let run = [];
  for (let i = 0; i <= points.length; i++) {
    const a = points[i % points.length];
    const b = points[(i + 1) % points.length];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const onBoundary = distanceToPolyline(mid, boundaryRing) < 0.6;
    if (!onBoundary && i < points.length) {
      if (!run.length) run.push(a);
      run.push(b);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

export function buildRoads(model, assets, materials) {
  const group = new THREE.Group();
  group.name = 'roads';

  const asphalt = new THREE.MeshStandardMaterial({
    map: assets.tiled('asphalt_albedo', TILE_M.asphalt),
    normalMap: assets.tiled('asphalt_normal', TILE_M.asphalt),
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0xffffff,
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (!asphalt.map) asphalt.color.set('#3b3b3d');
  const earth = new THREE.MeshStandardMaterial({
    map: assets.tiled('soil_albedo', TILE_M.soil),
    normalMap: assets.tiled('soil_normal', TILE_M.soil),
    color: new THREE.Color(0.64, 0.54, 0.5),
    roughness: 0.97,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  if (!earth.map) earth.color.set('#8a4329');
  const curbMat = materials.concreteLight;

  const add = (geo, mat, { cast = false } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    m.castShadow = cast;
    group.add(m);
    return m;
  };

  // Main avenue and streets 1 and 2: one surveyed road parcel, curbed except
  // where it meets the title boundary (the entrance).
  add(flatPolygon(ROADS, 0.02), asphalt);
  for (const run of curbRuns(ROADS, model.siteRing)) add(curb(densify(run, 1), 0.075), curbMat);

  // Nautical access: a paved walk down to the river.
  add(flatPolygon(NAUTICAL_ACCESS, 0.025), materials.pavers);
  for (const run of curbRuns(NAUTICAL_ACCESS, model.siteRing)) add(curb(densify(run, 1), 0.06, { height: 0.08 }), curbMat);

  // Entrance pad marked "ACCESO" on the plan, beside the administration.
  if (ENTRANCE_PAD.length) add(flatPolygon(ENTRANCE_PAD, 0.03), materials.concreteLight);

  // Public red-earth streets outside the site.
  for (const s of model.streets) {
    const pts = densify(s.points, 3).map((p) => ({ ...p }));
    const g = ribbon(pts, s.width / 2, 0.0);
    // Follow the terrain (the streets leave the levelled site).
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, model.sample(pos.getX(k), pos.getZ(k)).h + 0.03);
    g.computeVertexNormals();
    add(g, earth);
  }
  return group;
}

// --------------------------------------------------------------------- lake

export function buildLake(model, assets, env) {
  const shape = new THREE.Shape(model.lake.map((p) => new THREE.Vector2(p.x, -p.z)));
  const geo = new THREE.ShapeGeometry(shape, 24);
  geo.rotateX(-Math.PI / 2);
  // World-space UVs for the ripple normal map.
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getX(k) / 38, p.getZ(k) / 38);
  geo.translate(0, WATER_LEVEL, 0);

  const normalMap = assets.textures.water_normal?.clone() || null;
  if (normalMap) {
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1b2a26'),
    roughness: 0.05,
    metalness: 0,
    envMap: env.skyEnvMap,
    envMapIntensity: 0.55,
    normalMap,
    normalScale: new THREE.Vector2(0.22, 0.22),
  });
  // Wind patches: rippled water next to calm, mirror-like stretches.
  const macro = assets.textures.macro_variation;
  if (macro && normalMap) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tLakeMacro = { value: macro };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vLakePos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLakePos = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tLakeMacro;\nvarying vec2 vLakePos;')
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float lakeWind = smoothstep(0.3, 0.72, texture2D(tLakeMacro, vLakePos / 340.0).g * 0.7 + texture2D(tLakeMacro, vLakePos / 90.0).b * 0.3);
          roughnessFactor = mix(0.025, 0.09, lakeWind);`)
        .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * mix(0.25, 1.7, lakeWind);');
    };
    mat.customProgramCacheKey = () => 'lake-wind';
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'lake';
  mesh.userData.tick = (t) => {
    if (normalMap) normalMap.offset.set(t * 0.004, t * 0.0025);
  };
  return mesh;
}
