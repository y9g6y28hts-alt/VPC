// Renders the site's still imagery with the experience engine itself, so every
// picture on the page is the same conceptual scene the visitor can explore:
//   assets/renders/hero/{desktop,mobile}/fNN.webp  – construction sequence (scroll hero)
//   assets/renders/hero/manifest.json               – frame count and stage labels
//   assets/renders/overview.webp                    – development overview poster
//   node tools/capture-renders.mjs [--only=hero|overview] [--variant=desktop|mobile] [--frames=30]
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './serve.mjs';
import { CONSTRUCTION_STAGES } from '../js/core/timeline.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const FRAMES = Number(args.frames || 30);
const LOT = args.lot || 'B-05';
const out = (...p) => path.join(root, 'assets', 'renders', ...p);

// Construction progress per frame: denser where the most visible change happens.
export function frameProgress(frames = FRAMES) {
  const keys = [0, 0.05, 0.12, 0.2, 0.27, 0.33, 0.39, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.76, 0.82, 0.88, 0.94, 1];
  const list = [];
  for (let i = 0; i < frames; i++) {
    const u = (i / (frames - 1)) * (keys.length - 1);
    const k = Math.floor(u);
    const f = u - k;
    list.push(k >= keys.length - 1 ? 1 : keys[k] + (keys[k + 1] - keys[k]) * f);
  }
  return list;
}

// Lot-space camera (x, y, d → target x, y, d); x is mirrored to the sunny side.
const POSES = {
  desktop: { size: [1600, 900], camera: [24, 3.4, -11.5, -6.5, 4.2, 14] },
  mobile: { size: [720, 1280], camera: [28, 4.5, -30, -1, 1.0, 13] },
};

async function launch() {
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

async function openHarness(browser, [w, h], port) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${port}/tools/harness.html?clean&tier=high`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.evaluate(() => window.xp.debug.freeze(true));
  return page;
}

function toWebp(png, webp, quality = 80) {
  execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(png)}).convert('RGB').save(${JSON.stringify(webp)}, quality=${quality}, method=6)`]);
  fs.rmSync(png);
}

async function captureHero(browser, port) {
  const progress = frameProgress();
  for (const [variant, pose] of Object.entries(POSES)) {
    if (args.variant && args.variant !== variant) continue;
    const dir = out('hero', variant);
    fs.mkdirSync(dir, { recursive: true });
    const page = await openHarness(browser, pose.size, port);
    await page.evaluate((lot) => {
      window.xp.select(lot);
      window.xp.machine.send('ARRIVED');
    }, LOT);
    for (let i = 0; i < progress.length; i++) {
      await page.evaluate(
        ({ t, cam }) => {
          window.xp.debug.setProgress(t);
          window.xp.debug.setLotCamera(...cam);
          window.xp.debug.renderNow();
        },
        { t: progress[i], cam: pose.camera },
      );
      const png = path.join(dir, `f${String(i).padStart(2, '0')}.png`);
      await page.screenshot({ path: png, timeout: 600000 });
      toWebp(png, png.replace(/\.png$/, '.webp'), variant === 'mobile' ? 74 : 78);
      process.stdout.write(`${variant} ${i + 1}/${progress.length}\r`);
    }
    await page.close();
    console.log(`\n${variant}: ${progress.length} frames`);
  }
  // Stage labels by frame (first frame at or after each stage starts).
  const stages = CONSTRUCTION_STAGES.map((s) => ({ label: s.label, frame: progress.findIndex((t) => t >= s.start) }));
  fs.writeFileSync(
    out('hero', 'manifest.json'),
    JSON.stringify({ frames: progress.length, lot: LOT, progress: progress.map((t) => +t.toFixed(3)), stages, desktop: POSES.desktop.size, mobile: POSES.mobile.size, note: 'Rendered with the Viva Lago experience engine (tools/capture-renders.mjs). Conceptual visualisation.' }, null, 2),
  );
}

async function captureOverview(browser, port) {
  const page = await openHarness(browser, [1600, 820], port);
  await page.evaluate(() => {
    window.xp.debug.setPose('overview');
    window.xp.debug.renderNow();
  });
  const png = out('overview.png');
  await page.screenshot({ path: png, timeout: 600000 });
  toWebp(png, out('overview.webp'), 80);
  await page.close();
  console.log('overview: done');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createServer().listen(0);
  const port = server.address().port;
  const browser = await launch();
  fs.mkdirSync(out(), { recursive: true });
  if (!args.only || args.only === 'overview') await captureOverview(browser, port);
  if (!args.only || args.only === 'hero') await captureHero(browser, port);
  await browser.close();
  server.close();
}
