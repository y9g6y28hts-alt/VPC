// Path-traced stills for the page: the development from the air and the
// finished residence from its garden (the closing image), desktop and mobile.
//
//   node tools/cinematic/make-stills.mjs [--lot=B-05] [--samples=96]
//
// Writes assets/renders/overview.webp and assets/renders/closing-{desktop,mobile}.webp.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split(/=(.*)/s);
    return [k, v ?? true];
  }),
);
const LOT = args.lot || 'B-05';
const SAMPLES = Number(args.samples || 96);
const OUT = path.join(root, 'assets', 'renders');

// Each still: the export viewport (the engine frames named poses for it), the
// render size, the pose, grass (only close to the camera) and WebP quality.
const STILLS = [
  { file: 'closing-desktop', viewport: '1600x900', size: '2400x1350', pose: 'garden', grass: true, q: 82 },
  { file: 'closing-mobile', viewport: '720x1280', size: '1080x1920', pose: 'garden', grass: true, q: 78 },
  { file: 'overview', viewport: '1600x820', size: '2400x1230', pose: 'overview', grass: false, q: 82 },
];

for (const s of STILLS) {
  const work = path.join(root, '.film-work', `stills-${LOT}-${s.viewport}`);
  if (!fs.existsSync(path.join(work, `shot-${s.pose}.json`))) {
    execFileSync('node', [path.join(root, 'tools/cinematic/export-scene.mjs'), `--lot=${LOT}`, '--t=1', `--out=${work}`, `--size=${s.viewport}`, `--shots=${s.pose}`], { stdio: 'inherit' });
  }
  const png = path.join(work, `${s.file}.png`);
  const t0 = Date.now();
  const r = spawnSync('python3', [path.join(root, 'tools/cinematic/render.py'), '--dir', work, '--t', '1.000', '--shot', s.pose, '--size', s.size, '--samples', String(SAMPLES), '--fog', '0.0007', ...(s.grass ? ['--grass'] : []), '--out', png], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 || !fs.existsSync(png)) {
    console.error(r.stdout?.slice(-2000), r.stderr?.slice(-2000));
    throw new Error(`render failed: ${s.file}`);
  }
  execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(png)}).convert('RGB').save(${JSON.stringify(path.join(OUT, `${s.file}.webp`))}, quality=${s.q}, method=6)`]);
  console.log(`${s.file} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}
