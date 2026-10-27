// Path-traced construction orbit: one continuous camera move around the lot
// while the residence is built, rendered with Cycles and assembled into video.
//
//   node tools/cinematic/make-orbit.mjs --lot=B-05 [--seconds=10] [--fps=24]
//        [--states=24] [--size=1280x720] [--samples=16] [--fog=0.0007]
//        [--preview=6]   (renders N stills of the path on the finished house)
//
// Each construction state is rendered for its stretch of the path (plus a few
// overlapping frames), so the scene loads once per state; overlapping frames
// dissolve into the next state. Resumable: existing frames are skipped.
// Writes assets/cinematic/<lot>/orbit.mp4 (H.264), orbit.webm (VP9) and
// orbit-poster.webp.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOTS } from '../../js/data/viva-lago.js';
import { lotToWorld } from '../../js/core/lot-layout.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split(/=(.*)/s);
    return [k, v ?? true];
  }),
);
const LOT = args.lot || 'B-05';
const FPS = Number(args.fps || 24);
const SECONDS = Number(args.seconds || 10);
const STATES = Number(args.states || 24);
const SIZE = args.size || '1280x720';
const SAMPLES = Number(args.samples || 16);
const FOG = Number(args.fog ?? 0.0007);
const OVERLAP = 3; // frames of dissolve between construction states
const FOV = 36;
const WORK = path.resolve(args.work || path.join(root, '.film-work', `${LOT}-orbit`));
const OUT = path.join(root, 'assets', 'cinematic', LOT);
const lot = LOTS.find((l) => l.id === LOT);
if (!lot) throw new Error(`unknown lot ${LOT}`);
fs.mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------- the path
// Lot space: x across the frontage, d into the lot (house ≈ x −7.5..7.5,
// d 2.5..24). θ = 0 looks at the house from the street; positive θ swings
// towards the sunny side (the side the hero shot uses).
const point = (x, y, d, side) => {
  const k = lot.houseScale || { x: 1, z: 1 };
  const p = lotToWorld(lot.frame, x * side * k.x, d * k.z);
  return [p.x, y, p.z];
};
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u); // sine in-out: no jolt at either end
function pose(u, side) {
  const e = ease(u);
  const theta = ((-50 + 130 * e) * Math.PI) / 180;
  const radius = 34 - 4 * e; // slow push-in
  const height = 4.2 + 5.8 * e * e; // rises late, ending on an elevated reveal
  // The house centre is placed with the lot's fitting; the camera's offset
  // from it is in true metres (the fitting scales the house, not the orbit).
  const c = point(0, 0, 14 + 1.0 * e, side);
  const o0 = lotToWorld(lot.frame, 0, 0);
  const ox = lotToWorld(lot.frame, side, 0);
  const od = lotToWorld(lot.frame, 0, 1);
  const ax = [ox.x - o0.x, ox.z - o0.z];
  const ad = [od.x - o0.x, od.z - o0.z];
  const sx = radius * Math.sin(theta);
  const sd = -radius * Math.cos(theta);
  const position = [c[0] + ax[0] * sx + ad[0] * sd, height, c[2] + ax[1] * sx + ad[1] * sd];
  const target = [c[0], 2.8 + 0.8 * e, c[2]];
  return { position, target };
}

// ---------------------------------------------------------------- export
const TS = Array.from({ length: STATES }, (_, i) => +(i / (STATES - 1)).toFixed(3));
const tag = (t) => t.toFixed(3);
const exported = TS.every((t) => fs.existsSync(path.join(WORK, `house-${tag(t)}.glb`))) && fs.existsSync(path.join(WORK, 'shot-orbit.json'));
if (!exported) {
  execFileSync('node', [path.join(root, 'tools/cinematic/export-scene.mjs'), `--lot=${LOT}`, `--t=${TS.join(',')}`, `--out=${WORK}`, `--size=${SIZE}`, '--shots=orbit:24,3.4,-11.5,-6.5,4.2,14', '--near=200'], { stdio: 'inherit' });
}
// The export picks the sunny side for its shot; the path follows it.
const shot = JSON.parse(fs.readFileSync(path.join(WORK, 'shot-orbit.json'), 'utf8'));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const side = dist(shot.position, point(24, 3.4, -11.5, 1)) < dist(shot.position, point(24, 3.4, -11.5, -1)) ? 1 : -1;

const render = (t, frames, outdir, size = SIZE, samples = SAMPLES) => {
  const camsFile = path.join(WORK, `cams-${path.basename(outdir)}.json`);
  fs.writeFileSync(camsFile, JSON.stringify({ fov: FOV, frames }));
  const r = spawnSync('python3', [path.join(root, 'tools/cinematic/render.py'), '--dir', WORK, '--t', tag(t), '--shot', 'orbit', '--size', size, '--samples', String(samples), '--fast', '--grass', '--grass-window', '44', '--fog', String(FOG), '--cams', camsFile, '--outdir', outdir], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(r.stdout?.slice(-3000), r.stderr?.slice(-3000));
    throw new Error(`render failed at t=${t}`);
  }
};

// ---------------------------------------------------------------- preview
if (args.preview) {
  const n = Number(args.preview);
  const frames = Array.from({ length: n }, (_, i) => ({ i, ...pose(i / (n - 1), side) }));
  const dir = path.join(WORK, 'preview');
  render(1, frames, dir, '640x360', 12);
  console.log(`preview stills in ${dir}`);
  process.exit(0);
}

// ---------------------------------------------------------------- frames
const TOTAL = Math.round(FPS * SECONDS);
const per = TOTAL / STATES;
const startOf = (k) => Math.round(k * per);
TS.forEach((t, k) => {
  const from = Math.max(0, startOf(k) - OVERLAP);
  const to = k === STATES - 1 ? TOTAL : startOf(k + 1);
  const frames = [];
  for (let i = from; i < to; i++) frames.push({ i, ...pose(i / (TOTAL - 1), side) });
  const dir = path.join(WORK, `s${String(k).padStart(2, '0')}`);
  const t0 = Date.now();
  render(t, frames, dir);
  console.log(`${LOT} orbit state ${k + 1}/${STATES} (t=${tag(t)}, frames ${from}–${to - 1}) in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
});

// ---------------------------------------------------------------- composite
// Frame i belongs to state k; its last OVERLAP frames dissolve into k + 1
// (rendered at the same camera positions).
const seq = path.join(WORK, 'seq');
fs.mkdirSync(seq, { recursive: true });
const py = [];
for (let i = 0; i < TOTAL; i++) {
  let k = 0;
  while (k < STATES - 1 && i >= startOf(k + 1)) k++;
  const a = path.join(WORK, `s${String(k).padStart(2, '0')}`, `${String(i).padStart(4, '0')}.png`);
  let b = null;
  let w = 0;
  if (k < STATES - 1 && i >= startOf(k + 1) - OVERLAP) {
    // These frames exist in both state k (its tail) and state k + 1 (its lead-in).
    b = path.join(WORK, `s${String(k + 1).padStart(2, '0')}`, `${String(i).padStart(4, '0')}.png`);
    w = (i - (startOf(k + 1) - OVERLAP) + 1) / (OVERLAP + 1);
  }
  py.push([a, b, w, path.join(seq, `${String(i).padStart(4, '0')}.png`)]);
}
fs.writeFileSync(path.join(WORK, 'composite.json'), JSON.stringify(py));
execFileSync('python3', ['-c', `
import json
from PIL import Image
for a, b, w, out in json.load(open(${JSON.stringify(path.join(WORK, 'composite.json'))})):
    im = Image.open(a).convert('RGB')
    if b:
        im = Image.blend(im, Image.open(b).convert('RGB'), w)
    im.save(out)
`]);

// ---------------------------------------------------------------- encode
fs.mkdirSync(OUT, { recursive: true });
const mp4 = path.join(OUT, 'orbit.mp4');
// 60 fps by motion-compensated interpolation of the rendered frames (the
// camera path is smooth, so in-between frames are reliable), scaled to 1080p,
// H.264 for reach.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(seq, '%04d.png'), '-vf', `minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,scale=1920:1080:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
// VP9 for browsers without H.264.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', path.join(OUT, 'orbit.webm')], { stdio: 'inherit' });
execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(path.join(seq, `${String(TOTAL - 1).padStart(4, '0')}.png`))}).convert('RGB').save(${JSON.stringify(path.join(OUT, 'orbit-poster.webp'))}, quality=82, method=6)`]);
console.log(`wrote ${path.relative(root, mp4)} (${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB)`);
