// Development capture: loads the harness in headless Chromium and saves
// screenshots for a list of steps. Usage:
//   node tools/shoot.mjs <outDir> <width>x<height> [tier] [steps-json]
// Steps: [{ "lot": "B-05", "t": 0.5, "pose": "buildStart", "name": "mid" }, ...]
import { createRequire } from 'node:module';
import { createServer } from './serve.mjs';
import fs from 'node:fs';

import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const [outDir = 'shots', size = '1440x900', tier = 'high', stepsJson] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const steps = stepsJson ? JSON.parse(stepsJson) : [{ pose: 'overview', name: 'overview' }];
fs.mkdirSync(outDir, { recursive: true });

const server = createServer().listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const consoleLines = [];
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/tools/harness.html?clean&tier=${tier}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 600000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`, await page.evaluate(() => window.__ready));
await page.evaluate(() => window.xp?.debug.freeze(true));
const errors = await page.evaluate(() => window.__errors);
if (errors.length) console.log('errors:', errors);

for (const step of steps) {
  const s0 = Date.now();
  await page.evaluate(async (st) => {
    const xp = window.xp;
    if (st.lot && xp.lot?.id !== st.lot) {
      xp.select(st.lot);
      // let the flight start, then jump
      await new Promise((r) => setTimeout(r, 50));
      xp.machine.send('ARRIVED');
    }
    if (st.t != null) xp.debug.setProgress(st.t);
    if (st.pose) xp.debug.setPose(st.pose);
    if (st.eval) await eval(st.eval);
    xp.debug.renderNow();
  }, step);
  const r0 = Date.now();
  await page.evaluate(() => window.xp.debug.renderNow());
  console.log(`  frame rendered in ${((Date.now() - r0) / 1000).toFixed(1)}s`);
  await page.waitForTimeout(step.wait ?? 200);
  const file = path.join(outDir, `${step.name}.png`);
  await page.screenshot({ path: file, timeout: 600000 });
  const info = await page.evaluate(() => window.xp.debug.info());
  console.log(`${file} (${((Date.now() - s0) / 1000).toFixed(1)}s)`, JSON.stringify(info));
}
const errors2 = await page.evaluate(() => window.__errors);
if (errors2.length) console.log('errors:', errors2);
fs.writeFileSync(path.join(outDir, 'console.log'), consoleLines.join('\n'));
console.log(consoleLines.filter((l) => /error|warn/i.test(l)).slice(0, 30).join('\n'));
await browser.close();
server.close();
