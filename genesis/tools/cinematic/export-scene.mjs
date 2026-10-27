// Exports the experience scene for offline path tracing (tools/cinematic/render.py).
//
// For a lot and a list of construction progress values it writes, into --out:
//   world.glb               roads, river, vegetation, survey markers, terrain geometry
//   house-<t>.glb           the residence exactly as built at progress t (visible
//                           components, transforms, clip planes in node extras)
//   ground-near-<t>.png     terrain albedo baked top-down around the lot (site
//                           clearing, lawn, pool cut-out as alpha)
//   ground-far.png          terrain albedo over the wider landscape
//   shot-<name>.json        camera (position, target, fov, aspect) + sun direction
//
//   node tools/cinematic/export-scene.mjs --lot=B-05 --t=0.08,0.2,1 --out=dir
//        [--shots=hero:24,3.4,-11.5,-6.5,4.2,14|garden] [--size=1600x900]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const LOT = args.lot || 'B-05';
const TS = (args.t || '1').split(',').map(Number);
const OUT = path.resolve(args.out || 'cinematic-out');
const [W, H] = (args.size || '1600x900').split('x').map(Number);
// name:x,y,d,tx,ty,td in lot design space (mirrored to the sunny side), or a named pose.
const SHOTS = (args.shots || 'hero:24,3.4,-11.5,-6.5,4.2,14').split('|').map((s) => {
  const [name, spec] = s.split(':');
  return { name, cam: spec ? spec.split(',').map(Number) : null };
});
const NEAR = Number(args.near || 160); // metres covered by the near ground bake
const FAR = Number(args.far || 1400);
fs.mkdirSync(OUT, { recursive: true });

const server = createServer().listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
await page.goto(`http://localhost:${port}/tools/harness.html?clean&tier=high`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.evaluate((lot) => {
  window.xp.debug.freeze(true);
  window.xp.select(lot);
  window.xp.machine.send('ARRIVED');
}, LOT);

// Shared in-page helpers: GLB export through a download, ground bake.
await page.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

  const drawable = (img) =>
    img && ((typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) || img instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas));

  // Render-target textures (baked tree impostors) → canvases the exporter can encode.
  const converted = new Map();
  function exportableTexture(tex) {
    if (!tex) return null;
    if (drawable(tex.image)) return tex;
    if (converted.has(tex)) return converted.get(tex);
    let out = null;
    const { renderer, vegetation } = window.xp.debug.internals();
    const imp = vegetation?.impostors?.find((i) => i.texture === tex);
    if (imp) {
      const { width: w, height: h } = imp.target;
      const half = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(imp.target, 0, 0, w, h, half);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const img = g.createImageData(w, h);
      const f = THREE.DataUtils.fromHalfFloat;
      const toSrgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = ((h - 1 - y) * w + x) * 4;
          const di = (y * w + x) * 4;
          const a = Math.min(1, Math.max(0, f(half[si + 3])));
          for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(255 * Math.min(1, toSrgb(Math.max(0, f(half[si + k]) / Math.max(a, 1e-4)))));
          img.data[di + 3] = Math.round(255 * a);
        }
      }
      g.putImageData(img, 0, 0);
      out = new THREE.CanvasTexture(c);
      out.colorSpace = THREE.SRGBColorSpace;
      out.flipY = tex.flipY;
    }
    converted.set(tex, out);
    return out;
  }

  /** Plain material for export (clip clones and custom shaders flattened). */
  function exportMaterial(m) {
    const base = m.userData?.exportBase || m;
    const out = (base.isMeshPhysicalMaterial ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial).prototype.clone.call(base);
    for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'clearcoatMap', 'transmissionMap']) {
      if (out[slot]) out[slot] = exportableTexture(out[slot]);
    }
    out.color = m.color ? m.color.clone() : out.color;
    out.clippingPlanes = null;
    out.onBeforeCompile = () => {};
    out.name = base.name || m.name || '';
    return out;
  }

  function cloneForExport(o) {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.every((m) => m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial))) return null;
    const material = Array.isArray(o.material) ? mats.map(exportMaterial) : exportMaterial(o.material);
    let copy;
    if (o.isInstancedMesh) {
      copy = new THREE.InstancedMesh(o.geometry, material, o.count);
      for (let i = 0; i < o.count; i++) {
        const m4 = new THREE.Matrix4();
        o.getMatrixAt(i, m4);
        copy.setMatrixAt(i, m4);
      }
    } else copy = new THREE.Mesh(o.geometry, material);
    o.updateWorldMatrix(true, false);
    o.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
    copy.name = o.name || o.parent?.name || '';
    const planes = mats.flatMap((m) => m.clippingPlanes || []);
    copy.userData = planes.length ? { clip: planes.map((p) => [p.normal.x, p.normal.y, p.normal.z, p.constant]) } : {};
    if (o.userData?.tag) copy.userData.tag = o.userData.tag;
    return copy;
  }

  function isVisible(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  window.__cine = {
    THREE,
    async exportGlb(filter, file) {
      const { scene } = window.xp.debug.internals();
      const root = new THREE.Scene();
      scene.updateMatrixWorld(true);
      const found = [];
      scene.traverse((o) => {
        if (!o.isMesh || !isVisible(o)) return;
        if (!filter(o)) return;
        // Skip degenerate (not yet grown) items.
        const s = new THREE.Vector3();
        o.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
        if (Math.min(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) < 0.01) return;
        found.push(o);
      });
      for (const o of found) {
        const c = cloneForExport(o);
        if (c) root.add(c);
      }
      const glb = await new GLTFExporter().parseAsync(root, { binary: true, maxTextureSize: 2048 });
      const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: file });
      document.body.append(a);
      a.click();
      a.remove();
      return root.children.length;
    },
    /** Top-down unlit albedo of terrain (and lot lawn) in a square around (cx, cz). */
    bakeGround(cx, cz, size, px) {
      const { scene, renderer } = window.xp.debug.internals();
      const keep = [];
      scene.traverse((o) => {
        if (o.isMesh || o.isLight || o.isLineSegments) keep.push([o, o.visible]);
      });
      for (const [o] of keep) o.visible = o.name === 'terrain' || o.name === 'lot-ground';
      // Re-show the ancestors of what we keep.
      for (const [o] of keep) if (o.visible) for (let p = o.parent; p; p = p.parent) p.visible = true;
      const amb = new THREE.AmbientLight(0xffffff, Math.PI);
      scene.add(amb);
      const prev = { env: scene.environment, bg: scene.background, fog: scene.fog, tone: renderer.toneMapping, target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
      scene.environment = null;
      scene.background = null;
      scene.fog = null;
      renderer.toneMapping = THREE.NoToneMapping;
      const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 2000);
      cam.position.set(cx, 500, cz);
      cam.up.set(0, 0, -1); // north at the top of the image
      cam.lookAt(cx, 0, cz);
      const rt = new THREE.WebGLRenderTarget(px, px, { samples: 4, colorSpace: THREE.SRGBColorSpace });
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);
      const buf = new Uint8Array(px * px * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
      renderer.setRenderTarget(prev.target);
      renderer.setClearColor(prev.clear, prev.alpha);
      renderer.toneMapping = prev.tone;
      scene.environment = prev.env;
      scene.background = prev.bg;
      scene.fog = prev.fog;
      scene.remove(amb);
      for (const [o, v] of keep) o.visible = v;
      rt.dispose();
      // Flip rows (GL origin is bottom-left) into a canvas and return PNG.
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      const img = g.createImageData(px, px);
      for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * px * 4, (px - y) * px * 4), y * px * 4);
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    },
  };
});

const lotInfo = await page.evaluate(() => {
  const { lot } = window.xp.debug.internals();
  return { id: lot.id, centroid: lot.centroid, origin: lot.frame.origin };
});
const cx = lotInfo.centroid.x;
const cz = lotInfo.centroid.z;

// World (once): everything that is neither the residence nor the baked ground.
await page.evaluate(() => window.xp.debug.setProgress(1));
const [dlw] = await Promise.all([
  page.waitForEvent('download', { timeout: 900000 }),
  page.evaluate(() => {
    const { residence } = window.xp.debug.internals();
    const skipNames = new Set(['lot-ground', 'lake-sky']);
    return window.__cine.exportGlb((o) => {
      for (let p = o; p; p = p.parent) if (p === residence.group || p.name === 'lot-pick') return false;
      if (skipNames.has(o.name)) return false;
      if (o.isLineSegments2 || o.material?.isLineMaterial) return false;
      if (o.geometry?.type === 'SphereGeometry' || o.material?.isShaderMaterial) return false; // sky dome
      return true;
    }, 'world.glb');
  }),
]);
await dlw.saveAs(path.join(OUT, 'world.glb'));
console.log('world.glb');

const far = await page.evaluate(({ cx, cz, size }) => window.__cine.bakeGround(cx, cz, size, 4096), { cx, cz, size: FAR });
fs.writeFileSync(path.join(OUT, 'ground-far.png'), Buffer.from(far.split(',')[1], 'base64'));

for (const t of TS) {
  const tag = t.toFixed(3);
  await page.evaluate((tt) => window.xp.debug.setProgress(tt), t);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 900000 }),
    page.evaluate((file) => {
      const { residence } = window.xp.debug.internals();
      return window.__cine.exportGlb((o) => {
        for (let p = o; p; p = p.parent) if (p === residence.group) return true;
        return false;
      }, file);
    }, `house-${tag}.glb`),
  ]);
  await dl.saveAs(path.join(OUT, `house-${tag}.glb`));
  const near = await page.evaluate(({ cx, cz, size }) => window.__cine.bakeGround(cx, cz, size, 4096), { cx, cz, size: NEAR });
  fs.writeFileSync(path.join(OUT, `ground-near-${tag}.png`), Buffer.from(near.split(',')[1], 'base64'));
  console.log(`t=${tag}`);
}

for (const shot of SHOTS) {
  const data = await page.evaluate(({ shot, w, h }) => {
    const x = window.xp;
    if (shot.cam) x.debug.setLotCamera(...shot.cam);
    else x.debug.setPose(shot.name);
    const { camera, sunDir } = x.debug.internals();
    const target = x.debug.info().target;
    return { name: shot.name, position: camera.position.toArray(), target, fov: camera.fov, aspect: w / h, sun: sunDir.toArray() };
  }, { shot, w: W, h: H });
  fs.writeFileSync(path.join(OUT, `shot-${shot.name}.json`), JSON.stringify({ ...data, lot: lotInfo, near: { cx, cz, size: NEAR }, far: { cx, cz, size: FAR } }, null, 2));
  console.log(`shot ${shot.name}`);
}

await browser.close();
server.close();
