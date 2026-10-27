// Load-performance measurement in headless Chromium: Largest Contentful Paint,
// Cumulative Layout Shift, long tasks (as a Total Blocking Time estimate) and
// bytes transferred by type on first load, for a desktop and a throttled phone
// profile (4× CPU slowdown, ~9 Mbps / 40 ms RTT). Headless numbers are relative
// indicators for this codebase, not field data.
//   node tools/perf.mjs [--runs=3]
import { createRequire } from 'node:module';
import { createServer } from './serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const RUNS = Number(args.runs || 3);

const PROFILES = {
  desktop: { viewport: { width: 1440, height: 900 }, cpu: 1, network: null },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, cpu: 4, network: { latency: 40, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 } },
};

const OBSERVE = () => {
  window.__perf = { lcp: 0, lcpEl: '', cls: 0, longTasks: [] };
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      window.__perf.lcp = e.startTime;
      window.__perf.lcpEl = e.element ? `${e.element.tagName.toLowerCase()}${e.element.className ? '.' + String(e.element.className).split(' ')[0] : ''}` : '';
    }),
  ).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__perf.cls += e.value))).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.longTasks.push(e.duration))).observe({ type: 'longtask', buffered: true });
};

async function measure(browser, port, profile) {
  const ctx = await browser.newContext({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.hasTouch });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile.network) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profile.network });
  if (profile.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  const bytes = {};
  let loaded = false;
  page.on('load', () => (loaded = true));
  cdp.on('Network.loadingFinished', (e) => (bytes[e.requestId] = { ...(bytes[e.requestId] || {}), size: e.encodedDataLength, afterLoad: loaded }));
  cdp.on('Network.responseReceived', (e) => (bytes[e.requestId] = { ...(bytes[e.requestId] || {}), type: e.type, url: e.response.url }));
  await page.addInitScript(OBSERVE);
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(2500); // let LCP settle and idle work finish
  const perf = await page.evaluate(() => window.__perf);
  // Bytes needed to reach the load event vs. bytes streamed afterwards.
  const byType = {};
  let deferred = 0;
  for (const r of Object.values(bytes)) {
    if (!r.size) continue;
    if (r.afterLoad) deferred += r.size;
    else byType[r.type || 'Other'] = (byType[r.type || 'Other'] || 0) + r.size;
  }
  const tbt = perf.longTasks.reduce((s, d) => s + Math.max(0, d - 50), 0);
  await ctx.close();
  return { lcpEl: perf.lcpEl, lcp: perf.lcp, cls: perf.cls, tbt, loadMs, byType, deferred, requests: Object.keys(bytes).length };
}

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const server = createServer().listen(0);
const port = server.address().port;
const browser = await chromium.launch();
for (const [name, profile] of Object.entries(PROFILES)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, port, profile));
  const types = {};
  for (const r of runs) for (const [t, v] of Object.entries(r.byType)) (types[t] ||= []).push(v);
  console.log(`\n${name} (median of ${RUNS})`);
  console.log(`  LCP ${median(runs.map((r) => r.lcp)).toFixed(0)} ms (${runs[0].lcpEl || 'n/a'}) · CLS ${median(runs.map((r) => r.cls)).toFixed(3)} · TBT ~${median(runs.map((r) => r.tbt)).toFixed(0)} ms · load ${median(runs.map((r) => r.loadMs))} ms · ${median(runs.map((r) => r.requests))} requests`);
  console.log(`  until load: ${Object.entries(types).map(([t, v]) => `${t} ${kb(median(v))}`).join(' · ')}`);
  console.log(`  streamed after load: ${kb(median(runs.map((r) => r.deferred)))}`);
}
await browser.close();
server.close();
