// Small, dependency-free math helpers shared by the experience and the tests.

export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : clamp((v - a) / (b - a)));

export const linear = (t) => t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);

/** Progress of `t` through the window [start, end], clamped to 0..1 and eased. */
export function windowProgress(t, start, end, ease = linear) {
  if (end <= start) return t >= end ? 1 : 0;
  return ease(clamp((t - start) / (end - start)));
}

/** Frame-rate independent exponential smoothing factor for a given half-life (s). */
export function damp(halfLife, dt) {
  return 1 - Math.pow(0.5, dt / Math.max(halfLife, 1e-6));
}
