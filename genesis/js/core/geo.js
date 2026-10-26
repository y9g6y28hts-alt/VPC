// Geodesy helpers: the survey is in UTM (zone 21 south, WGS 84); maps and
// visitors want latitude/longitude. Inverse transverse Mercator after Krüger's
// series (as in Karney 2011), accurate to well under a millimetre in-zone.

const A = 6378137; // WGS 84 semi-major axis
const F = 1 / 298.257223563;
const K0 = 0.9996;

const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const RECT = (A / (1 + N)) * (1 + N2 / 4 + (N2 * N2) / 64);
const BETA = [N / 2 - (2 / 3) * N2 + (37 / 96) * N3, N2 / 48 + N3 / 15, (17 / 480) * N3];
const DELTA = [2 * N - (2 / 3) * N2 - 2 * N3, (7 / 3) * N2 - (8 / 5) * N3, (56 / 15) * N3];

/**
 * @param {number} easting metres
 * @param {number} northing metres
 * @param {{ zone: number, south: boolean }} zone
 * @returns {{ lat: number, lon: number }} degrees
 */
export function utmToLatLon(easting, northing, { zone, south }) {
  const xi = (northing - (south ? 10000000 : 0)) / (K0 * RECT);
  const eta = (easting - 500000) / (K0 * RECT);
  let xi1 = xi;
  let eta1 = eta;
  for (let j = 1; j <= 3; j++) {
    xi1 -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta1 -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lambda = lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
  return { lat: (phi * 180) / Math.PI, lon: (lambda * 180) / Math.PI };
}

/** "25°27′38″ S, 54°40′55″ O" style, as used on Paraguayan documents. */
export function formatDms({ lat, lon }) {
  const part = (v, pos, neg) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    const s = Math.round(((a - d) * 60 - m) * 60);
    return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″ ${v < 0 ? neg : pos}`;
  };
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'O')}`;
}

/** Decimal pair for maps and clipboards: "-25.460696, -54.682035". */
export function formatDecimal({ lat, lon }, digits = 6) {
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}
