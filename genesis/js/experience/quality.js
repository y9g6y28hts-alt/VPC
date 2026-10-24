// Chooses a rendering tier from coarse device signals. 'high' enables ambient
// occlusion, MSAA and larger shadow maps; 'low' keeps phones cool and fluid.

export function detectTier({ force } = {}) {
  if (force === 'high' || force === 'low') return force;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = typeof innerWidth === 'number' && Math.min(innerWidth, innerHeight) < 700;
  const memory = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 8;
  if ((coarse && small) || memory <= 4 || cores <= 4) return 'low';
  return 'high';
}

export function tierSettings(tier) {
  return tier === 'high'
    ? { tier, maxPixelRatio: 2, ao: true, msaa: 4, shadowMap: 4096, treeDensity: 1, farForest: true, grassDetail: true }
    : { tier, maxPixelRatio: 1.5, ao: false, msaa: 4, shadowMap: 2048, treeDensity: 0.55, farForest: true, grassDetail: false };
}
