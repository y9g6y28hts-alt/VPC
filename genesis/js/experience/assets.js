// Loads the experience's textures and HDRI with real progress reporting.
// A failed asset resolves to null instead of rejecting so the scene can still
// render with flat materials; failures are collected for diagnostics.
import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

const base = new URL('../../assets/', import.meta.url);

/** Tile sizes in metres (mirrors tools/generate-textures.py). */
export const TILE_M = {
  plaster: 2.0,
  concrete: 2.4,
  brick: 1.0,
  stone: 2.0,
  timber: 0.6,
  cladding: 0.6,
  grass: 4.0,
  soil: 4.0,
  asphalt: 4.0,
  gravel: 1.5,
  pavers: 2.4,
  deck: 1.12,
  sand: 2.0,
  plywood: 2.44,
};

const MATERIAL_TEXTURES = Object.keys(TILE_M);

export class AssetLibrary {
  constructor(renderer) {
    this.renderer = renderer;
    this.textures = {};
    this.environment = null;
    this.failures = [];
    this.loaded = 0;
    this.total = 0;
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  }

  /**
   * @param {(fraction: number) => void} onProgress real fraction of files finished
   */
  async load(onProgress = () => {}) {
    const jobs = [];
    const tex = (key, file, { srgb = false } = {}) => jobs.push({ key, kind: 'texture', url: new URL(file, base).href, srgb });

    for (const name of MATERIAL_TEXTURES) {
      tex(`${name}_albedo`, `textures/${name}_albedo.webp`, { srgb: true });
      tex(`${name}_normal`, `textures/${name}_normal.webp`);
    }
    tex('water_normal', 'textures/water_normal.webp');
    tex('macro_variation', 'textures/macro_variation.webp');
    tex('bark_oak_color', 'trees/bark_oak_color.webp', { srgb: true });
    tex('bark_oak_normal', 'trees/bark_oak_normal.webp');
    tex('bark_willow_color', 'trees/bark_willow_color.webp', { srgb: true });
    tex('bark_willow_normal', 'trees/bark_willow_normal.webp');
    tex('leaf_oak', 'trees/leaf_oak.webp', { srgb: true });
    tex('leaf_ash', 'trees/leaf_ash.webp', { srgb: true });
    tex('leaf_aspen', 'trees/leaf_aspen.webp', { srgb: true });
    jobs.push({ key: 'environment', kind: 'exr', url: new URL('env/sunrise.exr', base).href });

    this.total = jobs.length;
    this.loaded = 0;
    onProgress(0);

    const textureLoader = new THREE.TextureLoader();
    const exrLoader = new EXRLoader();
    await Promise.all(
      jobs.map(async (job) => {
        try {
          if (job.kind === 'texture') {
            const t = await textureLoader.loadAsync(job.url);
            t.colorSpace = job.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            t.anisotropy = Math.min(8, this.maxAnisotropy);
            this.textures[job.key] = t;
          } else {
            exrLoader.setDataType(THREE.FloatType);
            const hdr = await exrLoader.loadAsync(job.url);
            // The HDRI's sun pixel exceeds half-float range; left as is it turns
            // into Inf/NaN in the PMREM blur and blackens reflective surfaces.
            // The sun itself is a separate light, so clamp the map.
            const data = hdr.image.data;
            for (let i = 0; i < data.length; i++) {
              const v = data[i];
              data[i] = Number.isFinite(v) ? Math.min(v, 64) : 0;
            }
            hdr.mapping = THREE.EquirectangularReflectionMapping;
            hdr.needsUpdate = true;
            this.environmentSource = hdr;
          }
        } catch (err) {
          this.failures.push({ url: job.url, error: String(err?.message || err) });
          if (job.kind === 'texture') this.textures[job.key] = null;
        } finally {
          this.loaded += 1;
          onProgress(this.loaded / this.total);
        }
      }),
    );
    return this;
  }

  /**
   * A texture clone with a repeat suited to world-space UVs in metres. Clones
   * share the GPU upload of the source image.
   */
  tiled(key, tileMetres) {
    const t = this.textures[key];
    if (!t) return null;
    const c = t.clone();
    c.repeat.set(1 / tileMetres, 1 / tileMetres);
    c.needsUpdate = true;
    return c;
  }

  dispose() {
    for (const t of Object.values(this.textures)) t?.dispose();
    this.environmentSource?.dispose();
    this.textures = {};
  }
}
