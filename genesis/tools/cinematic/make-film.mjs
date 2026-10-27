// Produces the path-traced construction film of a lot for the explorer:
// export (engine) → render (Blender Cycles) → grade → WebP, resumable.
//
//   node tools/cinematic/make-film.mjs --lot=B-05 [--variants=desktop,mobile]
//        [--samples=64] [--work=/tmp/film-B-05]
// Writes assets/cinematic/<lot>/<variant>/fNN.webp and updates
// assets/cinematic/manifest.json (films, frames with progress, shots, lots).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split(/=(.*)/s);
    return [k, v ?? true]; // a bare flag (--hero) is true
  }),
);
const LOT = args.lot || 'B-05';
const VARIANTS = (args.variants || 'desktop,mobile').split(',');
const SAMPLES = Number(args.samples || 64);
const WORK = path.resolve(args.work || path.join(root, '.film-work', LOT));
// Construction moments of the film (progress on the experience's clock).
const TS = (args.t || '0,0.06,0.17,0.27,0.36,0.47,0.55,0.64,0.74,0.84,0.92,1').split(',').map(Number);
const SHOTS = {
  desktop: { size: '1600x900', cam: [24, 3.4, -11.5, -6.5, 4.2, 14] },
  mobile: { size: '720x1280', cam: [18, 3.2, -16, -2, 4.6, 15] },
};
const OUT = path.join(root, 'assets', 'cinematic', LOT);

fs.mkdirSync(WORK, { recursive: true });
const tag = (t) => t.toFixed(3);

// 1. Export (once per lot; skipped when present).
const exported = TS.every((t) => fs.existsSync(path.join(WORK, `house-${tag(t)}.glb`))) && VARIANTS.every((v) => fs.existsSync(path.join(WORK, `shot-${v}.json`)));
if (!exported) {
  for (const v of VARIANTS) {
    const s = SHOTS[v];
    execFileSync('node', [path.join(root, 'tools/cinematic/export-scene.mjs'), `--lot=${LOT}`, `--t=${TS.join(',')}`, `--out=${WORK}`, `--size=${s.size}`, `--shots=${v}:${s.cam.join(',')}`], { stdio: 'inherit' });
  }
}

// 2. Render + grade each frame (resumable).
for (const v of VARIANTS) {
  const dir = path.join(OUT, v);
  fs.mkdirSync(dir, { recursive: true });
  TS.forEach((t, i) => {
    const webp = path.join(dir, `f${String(i).padStart(2, '0')}.webp`);
    // Done unless the scene was exported again after this frame was made.
    const glb = path.join(WORK, `house-${tag(t)}.glb`);
    if (fs.existsSync(webp) && fs.statSync(webp).mtimeMs > fs.statSync(glb).mtimeMs) return;
    const png = path.join(WORK, `${v}-${tag(t)}.png`);
    const t0 = Date.now();
    const r = spawnSync('python3', [path.join(root, 'tools/cinematic/render.py'), '--dir', WORK, '--t', tag(t), '--shot', v, '--size', SHOTS[v].size, '--samples', String(SAMPLES), '--grass', '--fog', '0.0007', '--out', png], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0 || !fs.existsSync(png)) {
      console.error(r.stdout?.slice(-2000), r.stderr?.slice(-2000));
      throw new Error(`render failed: ${v} t=${t}`);
    }
    execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(png)}).convert('RGB').save(${JSON.stringify(webp)}, quality=${v === 'mobile' ? 78 : 82}, method=6)`]);
    console.log(`${LOT} ${v} ${i + 1}/${TS.length} (t=${tag(t)}) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  });
}

// 3. Manifest entry.
const manifestPath = path.join(root, 'assets', 'cinematic', 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { films: [] };
const entry = {
  id: LOT,
  dir: LOT,
  lot: LOT,
  lots: [LOT],
  mobile: VARIANTS.includes('mobile'),
  caption: `Render de la residencia conceptual sobre el lote ${LOT} · Cycles`,
  shots: Object.fromEntries(VARIANTS.map((v) => [v, SHOTS[v].cam])),
  frames: TS.map((t, i) => ({ t, file: `f${String(i).padStart(2, '0')}.webp` })),
};
const prev = manifest.films.find((f) => f.id === LOT);
if (prev) entry.lots = Array.from(new Set([...prev.lots, LOT]));
manifest.films = manifest.films.filter((f) => f.id !== LOT).concat(entry);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('manifest updated');

// 4. --hero: the home page's scroll sequence and stage viewer use this film.
if (args.hero) {
  const { CONSTRUCTION_STAGES } = await import('../../js/core/timeline.js');
  const heroPath = path.join(root, 'assets', 'renders', 'hero', 'manifest.json');
  const first = (t) => Math.max(0, TS.findIndex((x) => x >= t - 1e-6));
  const hero = {
    source: `../../cinematic/${LOT}/`,
    frames: TS.length,
    lot: LOT,
    // Construction progress of each frame; a film's frames also sit at that
    // scroll position (scroll progress is construction progress).
    progress: TS,
    positions: TS,
    stages: CONSTRUCTION_STAGES.map((s) => ({ label: s.label, frame: first(s.start), start: s.start })),
    desktop: SHOTS.desktop.size.split('x').map(Number),
    mobile: SHOTS.mobile.size.split('x').map(Number),
    note: 'Path-traced with Blender Cycles from the Viva Lago experience scene (tools/cinematic/). Conceptual visualisation.',
  };
  fs.writeFileSync(heroPath, JSON.stringify(hero, null, 2) + '\n');
  console.log('hero manifest updated');
}
