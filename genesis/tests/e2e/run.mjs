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
const site = `${base}viva-lago.html`;
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

  await check('Génesis home leads to the private neighbourhoods and on to Viva Lago Country', async () => {
    await page.goto(base);
    await page.waitForLoadState('networkidle');
    assert.match(await page.title(), /^Génesis/);
    assert.match(await page.textContent('h1'), /el comienzo de tu historia/i);
    assert.match(await page.textContent('.stats-card'), /datos del plano/);
    assert.ok(!/USD|Gs\b|\$/.test(await page.locator('main').textContent()), 'no prices on the home page');
    await snap(page, '00-genesis-home');
    assert.deepEqual(await page.locator('.category .btn--pill').allTextContents().then((t) => t.map((x) => x.replace(/\s*→$/, '').trim())), ['Conocer barrios privados', 'Conocer nuestros lotes disponibles', 'Conocer terrenos y futuras inversiones']);
    // The team: round portraits open “Conocé a …”, Escape closes it.
    await page.locator('#equipo').scrollIntoViewIfNeeded();
    await page.locator('.member', { hasText: 'Jinsu Annahas' }).click();
    await page.waitForSelector('.profile[open]');
    assert.match(await page.textContent('.profile__name'), /Conocé a\s*Jinsu Annahas/);
    await snap(page, '00-team-profile');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.profile[open]', { state: 'detached' }).catch(() => {});
    assert.equal(await page.locator('.profile[open]').count(), 0);
    assert.match(await page.textContent('.office'), /Ciudad del Este/);
    await page.locator('.category--feature').scrollIntoViewIfNeeded();
    await Promise.all([page.waitForURL(/barrios\.html/), page.click('.category--feature')]);
    assert.match(await page.textContent('h1'), /Barrios privados/);
    const card = page.locator('.project-card', { hasText: 'Viva Lago Country' });
    assert.equal(await card.count(), 1);
    assert.match(await card.locator('[data-maps-link]').getAttribute('href'), /^https:\/\/maps\.app\.goo\.gl\/MoXFWMTVsvddWcvg7/);
    await snap(page, '00-barrios');
    await Promise.all([page.waitForURL(/viva-lago\.html/), card.getByRole('link', { name: /Ver detalles/ }).click()]);
    assert.equal(await page.getAttribute('.nav__back', 'href'), 'barrios.html');
    assert.deepEqual(await page.locator('.crumbs a').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), ['./', 'barrios.html']);
  });

  await check('Viva Lago page renders headline, navigation and the surveyed figures', async () => {
    await page.goto(site);
    await page.waitForLoadState('networkidle');
    assert.match(await page.textContent('h1'), /El comienzo de/);
    assert.deepEqual(await page.locator('.nav a:not(.nav__back)').allTextContents(), ['El desarrollo', 'Ubicación', 'Lotes', 'El club', 'La obra', 'Contacto']);
    for (const id of await page.locator('.nav a:not(.nav__back)').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
      assert.equal(await page.locator(id).count(), 1, `${id} exists`);
    }
    const figures = await page.locator('.figures').textContent();
    assert.match(figures, /32/);
    assert.match(figures, /20\.000 m²/);
    assert.ok(!/USD|Gs\b|\$/.test(await page.locator('main').textContent()), 'no prices anywhere on the page');
    await snap(page, '01-home');
  });

  await check('location shows the surveyed coordinates and the Génesis map link', async () => {
    await page.locator('#ubicacion').scrollIntoViewIfNeeded();
    assert.equal(await page.textContent('[data-coords-decimal]'), '-25.460696, -54.682035');
    assert.equal(await page.textContent('[data-coords-dms]'), '25°27′39″ S, 54°40′55″ O');
    assert.match(await page.getAttribute('[data-maps-link]', 'href'), /^https:\/\/maps\.app\.goo\.gl\/MoXFWMTVsvddWcvg7/);
    assert.equal(await page.getAttribute('[data-maps-link]', 'target'), '_blank');
    assert.equal(await page.locator('[data-location-map] svg .map-site').count(), 1);
    await page.click('[data-copy-coords]');
    await page.waitForFunction(() => document.querySelector('[data-copy-status]').textContent.length > 0, null, { timeout: 5000 });
    assert.match(await page.textContent('[data-copy-status]'), /copiadas|Seleccionadas/);
    assert.equal(await page.locator('[data-infra] li.infra__item').count(), 4, 'four common areas from the plan table');
    await snap(page, '01c-location');
  });

  await check('stage viewer: buttons and scrubber move through the eight stages; closing image is labelled', async () => {
    await page.locator('#obra').scrollIntoViewIfNeeded();
    await page.waitForSelector('.stage-rail button', { timeout: 10000 });
    assert.equal(await page.locator('.stage-rail button').count(), 8);
    assert.match(await page.locator('.stage-caption').innerText(), /Residencia terminada/);
    await page.click('.stage-rail button >> nth=2');
    await page.waitForFunction(() => /Estructura metálica/.test(document.querySelector('.stage-caption').textContent));
    assert.equal(await page.getAttribute('.stage-rail button >> nth=2', 'aria-pressed'), 'true');
    await page.locator('.stage-range').focus();
    await page.keyboard.press('Home');
    await page.waitForFunction(() => /Terreno y replanteo/.test(document.querySelector('.stage-caption').textContent));
    assert.match(await page.getAttribute('.stage-range', 'aria-valuetext'), /Terreno y replanteo/);
    assert.match(await page.locator('.obra-note').textContent(), /no una obra existente/);
    assert.match(await page.locator('.closing__caption').textContent(), /Visualización conceptual/);
    await snap(page, '01e-stages');
  });

  await check('club showcase: arrows, thumbnails and the full-screen viewer; contact button is honest', async () => {
    await page.locator('#club').scrollIntoViewIfNeeded();
    await page.waitForSelector('.showcase__thumbs button', { state: 'attached' });
    assert.equal(await page.locator('.showcase__thumbs button').count(), 9);
    const first = await page.textContent('.showcase__caption');
    await page.click('.showcase__nav--next');
    assert.notEqual(await page.textContent('.showcase__caption'), first);
    assert.match(await page.textContent('.showcase__count'), /02 \/ 09/);
    await page.click('.showcase__thumbs button >> nth=2');
    assert.match(await page.textContent('.showcase__kind'), /Fotografía/);
    await page.click('.showcase__open');
    await page.waitForSelector('dialog.lightbox[open]');
    assert.match(await page.textContent('.lightbox__caption'), /Sombrillas de paja.*Fotografía/);
    await page.keyboard.press('ArrowRight');
    assert.match(await page.textContent('.lightbox__count'), /4 \/ 9/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('dialog.lightbox:not([open])', { state: 'attached' });
    assert.match(await page.textContent('.club-note'), /renders son ilustrativos/);
    // No WhatsApp number is configured: the button goes to the form, never to a made-up channel.
    assert.equal(await page.getAttribute('.fab', 'href'), '#contacto');
    assert.match(await page.textContent('.spec'), /Precio, disponibilidad y financiación/);
    assert.doesNotMatch(await page.textContent('.spec'), /USD|Gs\b|\$/);
  });

  await check('construction orbit video: poster, a playable source, labelled as a render; static with reduced motion', async () => {
    // Until the orbit is rendered the figure stays hidden and requests nothing.
    if (await page.locator('.film-video[hidden]').count()) {
      assert.equal(fs.existsSync(new URL('../../assets/cinematic/B-05/orbit.mp4', import.meta.url)), false, 'orbit exists: unhide the figure');
      assert.equal(await page.locator('[data-film-video] video').count(), 0);
      return;
    }
    await page.locator('[data-film-video]').scrollIntoViewIfNeeded();
    await page.waitForSelector('[data-film-video] video source', { state: 'attached', timeout: 10000 });
    const v = await page.evaluate(() => {
      const video = document.querySelector('[data-film-video] video');
      return { poster: video.poster, sources: [...video.querySelectorAll('source')].map((s) => s.type), muted: video.muted, controls: video.controls, label: video.getAttribute('aria-label') };
    });
    assert.match(v.poster, /orbit-poster\.webp$/);
    assert.ok(v.sources.length >= 1, 'at least one source this browser can play');
    assert.ok(v.muted, 'muted');
    assert.ok(v.controls, 'reduced motion: native controls, no autoplay');
    assert.match(v.label, /residencia conceptual/);
    assert.match(await page.locator('.film-video figcaption').textContent(), /Cycles/);
    // The figure stays visible: no media error with the available format.
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.film-video.is-unavailable').count(), 0);
  });

  await check('lot browser: filter, plan and list select the same lot, sheet shows plan data, inquiry keeps the lot', async () => {
    await page.locator('#lotes').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-lot-browser] polygon.lot').count(), 32);
    assert.equal(await page.locator('.lot-row').count(), 8, 'the full list opens folded');
    await page.click('.lot-list__more');
    assert.equal(await page.locator('.lot-row').count(), 32);
    await page.click('.lot-filter .chip[data-block="C"]');
    assert.equal(await page.locator('.lot-row').count(), 4);
    assert.equal(await page.locator('[data-lot-browser] polygon.lot.is-dim').count(), 28);
    await page.click('.lot-row:has-text("C-02") .lot-row__btn');
    const sheet = await page.locator('.lot-sheet').innerText();
    assert.match(sheet, /Manzana C · Lote 2/i);
    assert.match(sheet, /383,02/);
    assert.match(sheet, /Vendido/);
    assert.ok(await page.locator('[data-lot-browser] polygon.lot.is-selected').count() === 1, 'plan shows the selection');
    await page.click('.lot-filter .chip[data-block=""]');
    await page.locator('[data-lot-browser] polygon.lot').nth(8).click();
    assert.match(await page.locator('.lot-sheet').innerText(), /B-06/);
    await snap(page, '01d-lots');
    await page.click('.lot-sheet button:has-text("Consultar por este lote")');
    assert.equal(await page.inputValue('[data-contact-form] select[name="lot"]'), 'B-06');
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'name');
  });

  await check('with reduced motion the hero shows the finished residence without scroll-scrubbing', async () => {
    const last = await page.evaluate(async () => (await (await fetch('assets/renders/hero/manifest.json')).json()).frames - 1);
    assert.match(await page.getAttribute('[data-hero-poster]', 'src'), new RegExp(`f${String(last).padStart(2, '0')}\\.webp$`));
    assert.equal(await page.locator('[data-hero-media] canvas').count(), 0);
    assert.match(await page.textContent('[data-hero-stage]'), /Residencia terminada/);
  });

  await check('hero builds the residence as the visitor scrolls', async () => {
    const motion = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    await motion.goto(site);
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
    // Choosing e-mail as the channel requires an address.
    await page.fill('[data-contact-form] input[name="phone"]', '0981 000 000');
    await page.check('[data-contact-form] input[type="radio"][value="email"]', { force: true });
    await page.click('[data-contact-form] button[type="submit"]');
    assert.match(await page.locator('[data-contact-form] .error').allTextContents().then((t) => t.join(' ')), /correo/);
    await page.check('[data-contact-form] input[type="radio"][value="whatsapp"]', { force: true });
    await page.selectOption('[data-contact-form] select[name="topic"]', 'visit');
    await page.selectOption('[data-contact-form] select[name="lot"]', 'B-05');
    await page.click('[data-contact-form] button[type="submit"]');
    const status = await page.locator('[data-contact-form] .form-status').textContent();
    assert.match(status, /coordinar una visita al predio/);
    assert.match(status, /contacten por whatsapp/);
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

  await check('overview: the club and river view flies there and back; life in the scene is labelled illustrative', async () => {
    const cam = () => page.evaluate(async () => (await import('./js/explorer.js'))._debugExperience().debug.info().camera);
    await page.click('.xp-place[data-place="club"]');
    assert.equal(await page.getAttribute('.xp-place[data-place="club"]', 'aria-pressed'), 'true');
    await page.waitForFunction(async () => (await import('./js/explorer.js'))._debugExperience().debug.info().camera[0] > 120, null, { timeout: 60000 });
    assert.ok((await cam())[0] > 120, 'camera off the club');
    await page.click('.xp-place[data-place="portal"]');
    await page.waitForFunction(async () => (await import('./js/explorer.js'))._debugExperience().debug.info().camera[0] < -100, null, { timeout: 60000 });
    await page.click('.xp-place-back');
    await page.waitForFunction(async () => (await import('./js/explorer.js'))._debugExperience().debug.info().camera[0] < 0 && (await import('./js/explorer.js'))._debugExperience().debug.info().camera[1] > 40, null, { timeout: 60000 });
    assert.equal(await page.locator('.xp-place[aria-pressed="true"]').count(), 0);
    await page.click('.xp-chip:has-text("Sobre esta escena")');
    assert.match(await page.textContent('#xp-disclosure'), /personas, vehículos y embarcaciones que se ven en la escena son ilustrativos/i);
    await page.click('.xp-chip:has-text("Sobre esta escena")');
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

  await check('the lot’s own path-traced film takes over the build and gives way to the 3D view', async () => {
    await page.waitForSelector('.xp-cinema.is-visible', { timeout: 30000 });
    const caption = await page.locator('.xp-cinema__caption').textContent();
    assert.match(caption, /lote B-05 · Cycles/);
    assert.doesNotMatch(caption, /referencia/);
    await page.waitForFunction(() => document.querySelector('.xp-cinema__frame img')?.naturalWidth > 0, null, { timeout: 30000 });
    const toggle = page.locator('.xp-view-toggle');
    assert.match(await toggle.textContent(), /Vista 3D interactiva/);
    await snap(page, '04b-film');
    await toggle.click();
    await page.waitForSelector('.xp-cinema:not(.is-visible)', { state: 'attached' });
    assert.match(await toggle.textContent(), /Vista cinematográfica/);
    await toggle.click();
    await page.waitForSelector('.xp-cinema.is-visible');
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
    // A camera view hands the live scene back from the film.
    await page.waitForSelector('.xp-cinema:not(.is-visible)', { state: 'attached' });
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
    // The submit handler is async; with the scene software-rendered behind the
    // sheet, give it time to write its status.
    await page.waitForFunction(() => document.querySelector('.xp-sheet .form-status')?.textContent.trim().length > 0, null, { timeout: 30000 });
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
    await page.click('.xp-close', { timeout: 180000 });
    // Disposal waits for the GPU to finish queued work. Under SwiftShader that
    // includes compositing the film's image layers (seconds per frame), so the
    // backlog can reach a minute; on hardware it is a few milliseconds.
    await page.waitForSelector('#explorer', { state: 'hidden', timeout: 180000 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-locked')), false);
    assert.equal(await xpState(page), null, 'experience disposed on close');
  });

  await check('deep link #lote=C-03 opens the experience on that lot', async () => {
    await page.goto(`${site}#lote=C-03`);
    await waitState(page, ['approaching', 'building', 'complete', 'exploring']);
    assert.match(await page.locator('.xp-bar__lot').textContent(), /Manzana C · Lote 3/);
    assert.equal(await page.inputValue('[data-contact-form] select[name="lot"]'), 'C-03');
    // C-03 has no film of its own: the one shown is labelled as a reference.
    await waitState(page, ['building', 'complete', 'exploring']);
    await page.waitForSelector('.xp-cinema.is-visible', { timeout: 30000 });
    assert.match(await page.locator('.xp-cinema__caption').textContent(), /^Render de referencia: .*lote [BE]-0[57]/);
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
    await page.goto(site);
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
    await page.goto(site);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
    await snap(page, 'm01-home');
    await page.click('.nav-toggle');
    assert.ok(await page.locator('.nav a:has-text("Contacto")').isVisible());
    await snap(page, 'm02-menu');
    await page.click('.nav-toggle');
  });
  await check('mobile: the lot plan turns upright with tappable lots', async () => {
    await page.locator('#lotes').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-lot-browser] .plan-svg--portrait').count(), 1);
    const box = await page.locator('[data-lot-browser] polygon.lot').nth(8).boundingBox();
    assert.ok(Math.min(box.width, box.height) >= 20, `lot target ${box.width.toFixed(0)}×${box.height.toFixed(0)} px`);
    await page.locator('[data-lot-browser] polygon.lot').nth(8).tap();
    assert.match(await page.locator('.lot-sheet').innerText(), /B-06/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
    await snap(page, 'm02b-lots');
    await page.evaluate(() => scrollTo(0, 0));
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
    await page.goto(site);
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
