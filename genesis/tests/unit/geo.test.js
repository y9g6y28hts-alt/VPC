import test from 'node:test';
import assert from 'node:assert/strict';
import { utmToLatLon, formatDms, formatDecimal } from '../../js/core/geo.js';
import { DEVELOPMENT, SITE_LOCATION } from '../../js/data/viva-lago.js';

// Reference values from PROJ (pyproj, EPSG:32721 → EPSG:4326).
const REFERENCE = [
  { e: 733065.77, n: 7182011.0, lat: -25.460696055750606, lon: -54.68203546215591 },
  { e: 733230.41, n: 7181952.74, lat: -25.461195881370422, lon: -54.68038900878198 },
  { e: 732937.16, n: 7181984.83, lat: -25.460952378746956, lon: -54.68330920484242 },
];

test('UTM 21S → WGS 84 matches PROJ to the centimetre', () => {
  for (const r of REFERENCE) {
    const { lat, lon } = utmToLatLon(r.e, r.n, { zone: 21, south: true });
    // 1e-7 degrees ≈ 1 cm.
    assert.ok(Math.abs(lat - r.lat) < 1e-7, `lat ${lat} vs ${r.lat}`);
    assert.ok(Math.abs(lon - r.lon) < 1e-7, `lon ${lon} vs ${r.lon}`);
  }
});

test('site location is the centre of the surveyed monuments, with the given map link', () => {
  assert.ok(Math.abs(SITE_LOCATION.lat - -25.460696) < 1e-6);
  assert.ok(Math.abs(SITE_LOCATION.lon - -54.682035) < 1e-6);
  assert.equal(formatDecimal(SITE_LOCATION), '-25.460696, -54.682035');
  assert.equal(formatDms(SITE_LOCATION), '25°27′39″ S, 54°40′55″ O');
  assert.match(DEVELOPMENT.mapsUrl, /^https:\/\/maps\.app\.goo\.gl\/MoXFWMTVsvddWcvg7/);
});
