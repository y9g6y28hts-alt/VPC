// End-to-end checks in headless Chromium (software WebGL).
//   node tests/e2e/run.mjs [screenshotDir]
// Covers: page content and honesty notices, explorer loading, lot selection →
// automatic construction, pause/resume, finish, details with pending data,
// inquiry (no false "sent"), return to overview, close; mobile layout; and the
// no-WebGL fallback. Construction is advanced with the UI's own controls
// because software rendering is far too slow to watch it in real time.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../../tools/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv[2] || null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const server = createServer().listen(0);
const base = `http://localhost:${server.address().port}/`;
const results = [];
let failures = 0;

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failures++;
    results.push(`✗ ${name}\n    ${String(err.stack || err).split('\n').slice(0, 4).join('\n    ')}`);
  }
}

const snap = async (page, name) => {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), timeout: 600000 });
};

const xpState = (page) => page.evaluate(async () => (await import('./js/explorer.js'))._debugExperience()?.state ?? null);

// The explorer mirrors its state on #explorer[data-state]. (waitForFunction
// cannot be used with an async predicate: the returned Promise is truthy.)
async function waitState(page, states, timeout = 300000) {
  const list = Array.isArray(states) ? states : [states];
  await page.waitForSelector(list.map((s) => `#explorer[data-state="${s}"]`).join(', '), { state: 'attached', timeout });
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|404/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  return errors;
}

const gpuArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// ---------------------------------------------------------------- desktop
{
  const browser = await chromium.launch({ args: gpuArgs });
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = collectErrors(page);

  await check('homepage renders headline, navigation and the surveyed project facts', async () => {
    await page.goto(base);
    await page.waitForLoadState('networkidle');
    assert.match(await page.textContent('h1'), /El comienzo de/);
    assert.equal(await page.locator('.nav a').count(), 4);
    const facts = await page.locator('[data-project-facts]').textContent();
    assert.match(facts, /32 lotes en 5 manzanas/);
    assert.match(facts, /20\.000 m²/);
    assert.ok(!/USD|Gs\b|\$/.test(facts), 'no prices');
    assert.deepEqual(await page.locator('[data-project-facts] .pending').allTextContents(), ['Consultar con un asesor']);
    assert.equal(await page.locator('[data-plan-figure] svg polygon.lot').count(), 32, 'plan figure drawn from the surveyed lots');
    await snap(page, '01-home');
  });

  await check('with reduced motion the hero shows the finished residence without scroll-scrubbing', async () => {
    assert.match(await page.getAttribute('[data-hero-poster]', 'src'), /f29\.webp$/);
    assert.equal(await page.locator('[data-hero-media] canvas').count(), 0);
    assert.match(await page.textContent('[data-hero-stage]'), /Residencia terminada/);
  });

  await check('hero builds the residence as the visitor scrolls', async () => {
    const motion = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    await motion.goto(base);
    await motion.waitForSelector('[data-hero-media] canvas', { state: 'attached', timeout: 20000 });
    const before = await motion.textContent('[data-hero-stage]');
    const heroHeight = await motion.evaluate(() => document.getElementById('inicio').offsetHeight - innerHeight);
    await motion.evaluate((y) => scrollTo(0, y), Math.round(heroHeight * 0.6));
    await motion.waitForTimeout(600);
    const after = await motion.textContent('[data-hero-stage]');
    assert.notEqual(after, before, `stage label follows scroll (${before} → ${after})`);
    const width = await motion.evaluate(() => parseFloat(document.querySelector('[data-hero-progress]').style.width));
    assert.ok(width > 40 && width < 80, `progress ${width}%`);
    await snap(motion, '01b-hero-scrolled');
    await motion.close();
  });

  await check('contact form states that no channel is integrated and never claims to send', async () => {
    await page.locator('#contacto').scrollIntoViewIfNeeded();
    const notice = await page.locator('[data-contact-form] .notice').textContent();
    assert.match(notice, /no envía mensajes/);
    await page.fill('[data-contact-form] input[name="name"]', 'Ana Benítez');
    await page.click('[data-contact-form] button[type="submit"]');
    assert.match(await page.locator('[data-contact-form] .error').allTextContents().then((t) => t.join(' ')), /teléfono o un correo/);
    await page.fill('[data-contact-form] input[name="phone"]', '0981 000 000');
    await page.selectOption('[data-contact-form] select[name="lot"]', 'B-05');
    await page.click('[data-contact-form] button[type="submit"]');
    const status = await page.locator('[data-contact-form] .form-status').textContent();
    assert.match(status, /no fue enviada/);
    assert.match(status, /lote B-05/);
    assert.doesNotMatch(status, /Recibimos/);
    await snap(page, '02-contact');
  });

  await check('explorer opens, reports real loading progress and reaches the overview', async () => {
    await page.evaluate(() => scrollTo(0, 0));
    await page.click('.hero [data-open-explorer]');
    await page.waitForSelector('#explorer.is-open');
    await waitState(page, 'overview');
    await page.waitForSelector('.xp-loading.is-done', { state: 'attached' });
    assert.ok(await page.locator('.xp-overview.is-visible').isVisible());
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-locked')), true);
    await snap(page, '03-overview');
  });

  await check('selecting a lot starts construction automatically (no confirmation step)', async () => {
    await page.selectOption('#xp-lot-select', 'B-05');
    await waitState(page, ['approaching', 'building']);
    await waitState(page, 'building');
    assert.ok(await page.locator('.xp-build.is-visible').isVisible());
    assert.match(await page.locator('.xp-bar__lot').textContent(), /Manzana B · Lote 5/);
    assert.match(page.url(), /#lote=B-05$/);
    await snap(page, '04-building');
  });

  await check('construction can be paused, scrubbed by stage and resumed', async () => {
    await page.click('.xp-build__controls .icon-btn:has-text("Pausar")');
    assert.equal(await page.evaluate(async () => (await import('./js/explorer.js'))._debugExperience().playing), false);
    await page.click('.xp-track button:nth-child(4)');
    const p = await page.evaluate(async () => (await import('./js/explorer.js'))._debugExperience().progress);
    assert.ok(Math.abs(p - 0.4) < 0.02, `seeked to masonry stage (${p})`);
    assert.match(await page.locator('.xp-build__stage').textContent(), /Mampostería/);
    await snap(page, '05-masonry');
    await page.click('.xp-build__controls .icon-btn:has-text("Reanudar")');
    assert.equal(await page.evaluate(async () => (await import('./js/explorer.js'))._debugExperience().playing), true);
  });

  await check('finishing reveals the residence and the lot panel shows the plan surfaces, no prices', async () => {
    await page.click('.xp-build__controls .icon-btn:has-text("Ver terminada")');
    await waitState(page, ['complete', 'exploring']);
    await page.waitForSelector('.xp-details.is-visible');
    const rows = await page.locator('.xp-details .facts dd').allTextContents();
    assert.equal(rows[0], '384,00 m²', rows.join('|'));
    assert.match(rows.join('|'), /619,32 m²/);
    assert.ok(!rows.some((r) => /USD|Gs\b|\$/.test(r)), 'no prices');
    assert.equal(rows.at(-1), 'Consultar con un asesor');
    assert.match(await page.locator('.xp-details .concept').textContent(), /No incluida en el precio del lote/);
    await snap(page, '06-complete');
  });

  await check('views and replay work from the completed residence', async () => {
    await page.click('.segmented button:has-text("Jardín")');
    await snap(page, '07-garden');
    await page.click('.xp-details .actions button:has-text("Repetir construcción")');
    await waitState(page, 'building');
    await page.click('.xp-build__controls .icon-btn:has-text("Ver terminada")');
    await waitState(page, ['complete', 'exploring']);
  });

  await check('inquiry from the explorer keeps the selected lot and is honest about delivery', async () => {
    await page.click('.xp-details .actions .btn:has-text("Consultar por este lote")');
    await page.waitForSelector('.xp-sheet.is-visible');
    assert.equal(await page.inputValue('.xp-sheet select[name="lot"]'), 'B-05');
    await page.fill('.xp-sheet input[name="name"]', 'Ana Benítez');
    await page.fill('.xp-sheet input[name="email"]', 'ana@example.com');
    await page.click('.xp-sheet button[type="submit"]');
    assert.match(await page.locator('.xp-sheet .form-status').textContent(), /no fue enviada/);
    await snap(page, '08-inquiry');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.xp-sheet:not(.is-visible)', { state: 'attached' });
  });

  await check('returning to the overview and closing releases the page', async () => {
    await page.click('.xp-details .actions button:has-text("Volver al desarrollo")');
    await waitState(page, 'overview');
    assert.ok(await page.locator('.xp-overview.is-visible').isVisible());
    await snap(page, '09-back-overview');
    await page.click('.xp-close');
    await page.waitForSelector('#explorer', { state: 'hidden', timeout: 5000 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-locked')), false);
    assert.equal(await xpState(page), null, 'experience disposed on close');
  });

  await check('deep link #lote=C-03 opens the experience on that lot', async () => {
    await page.goto(`${base}#lote=C-03`);
    await waitState(page, ['approaching', 'building', 'complete', 'exploring']);
    assert.match(await page.locator('.xp-bar__lot').textContent(), /Manzana C · Lote 3/);
    assert.equal(await page.inputValue('[data-contact-form] select[name="lot"]'), 'C-03');
  });

  await check('no uncaught errors or failed requests on desktop', async () => {
    assert.deepEqual(errors, []);
  });
  await browser.close();
}

// ---------------------------------------------------------------- real-time approach (no reduced motion)
{
  const browser = await chromium.launch({ args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
  await check('without reduced motion the camera flies to the lot and construction starts by itself', async () => {
    await page.goto(`${base}tools/harness.html?clean&tier=low`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
    await page.evaluate(() => window.xp.select('E-05'));
    assert.equal(await page.evaluate(() => window.xp.state), 'approaching');
    await page.waitForFunction(() => window.xp.state === 'building', null, { timeout: 600000, polling: 1000 });
    await page.waitForFunction(() => window.xp.progress > 0, null, { timeout: 300000, polling: 1000 });
  });
  await browser.close();
}

// ---------------------------------------------------------------- asset failure
{
  const browser = await chromium.launch({ args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: 800, height: 500 }, reducedMotion: 'reduce' });
  await page.route('**/assets/textures/**', (r) => r.abort());
  await page.route('**/assets/env/**', (r) => r.abort());
  await check('missing textures and HDRI degrade gracefully and are reported', async () => {
    await page.goto(base);
    await page.click('.hero [data-open-explorer]');
    await waitState(page, 'overview');
    assert.match(await page.locator('.xp-toast').textContent(), /texturas/);
    await page.selectOption('#xp-lot-select', 'D-02');
    await waitState(page, 'building');
    await page.click('.xp-build__controls button[aria-label="Ver terminada"]');
    await waitState(page, ['complete', 'exploring']);
    await snap(page, 'a01-degraded');
  });
  await browser.close();
}

// ---------------------------------------------------------------- mobile
{
  const browser = await chromium.launch({ args: gpuArgs });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await check('mobile: home has no horizontal overflow and the menu opens', async () => {
    await page.goto(base);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
    await snap(page, 'm01-home');
    await page.click('.nav-toggle');
    assert.ok(await page.locator('.nav a:has-text("Contacto")').isVisible());
    await snap(page, 'm02-menu');
    await page.click('.nav-toggle');
  });
  await check('mobile: experience runs, details appear as a bottom sheet', async () => {
    await page.click('.hero [data-open-explorer]');
    await waitState(page, 'overview');
    await snap(page, 'm03-overview');
    await page.selectOption('#xp-lot-select', 'A-03');
    await waitState(page, 'building');
    await snap(page, 'm04-building');
    await page.click('.xp-build__controls button[aria-label="Ver terminada"]');
    await waitState(page, ['complete', 'exploring']);
    await page.waitForSelector('.xp-details.is-visible');
    const box = await page.locator('.xp-details').boundingBox();
    assert.ok(box.y > 844 * 0.3, 'panel sits in the lower part of the screen');
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'panel fits the width');
    await snap(page, 'm05-complete');
  });
  await check('no uncaught errors on mobile', async () => assert.deepEqual(errors, []));
  await browser.close();
}

// ---------------------------------------------------------------- fallback (no WebGL)
{
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = collectErrors(page);
  await check('without WebGL the explorer offers the 2D plan with the same lot actions', async () => {
    await page.goto(base);
    await page.click('.hero [data-open-explorer]');
    await page.waitForSelector('.xp-fallback:not([hidden])');
    assert.match(await page.locator('.xp-fallback .notice').textContent(), /no permite mostrar la escena 3D/);
    await page.click('.xp-fallback polygon.lot >> nth=7');
    await page.waitForSelector('.xp-details.is-visible');
    const rows = await page.locator('.xp-details .facts dd').allTextContents();
    assert.match(rows[0], /^\d{3},\d{2} m²$/);
    assert.ok(!rows.some((r) => /USD|Gs\b|\$/.test(r)), 'no prices');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700); // let the overlay finish fading in
    await snap(page, 'f01-fallback');
    await page.click('.xp-details .actions .btn:has-text("Consultar por este lote")');
    await page.waitForSelector('.xp-sheet.is-visible');
    assert.notEqual(await page.inputValue('.xp-sheet select[name="lot"]'), '');
  });
  await check('no uncaught errors in the fallback', async () => assert.deepEqual(errors.filter((e) => !/WebGL/.test(e)), []));
  await browser.close();
}

server.close();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed.`);
process.exit(failures ? 1 : 0);
