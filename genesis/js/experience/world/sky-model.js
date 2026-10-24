// CPU port of the Preetham sky used by three's Sky shader (without clouds).
// Used to drive the fog colour so that distant terrain dissolves into exactly
// the sky radiance behind it, whichever way the camera looks.

const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const cutoffAngle = 1.6110731556870734;
const steepness = 1.5;
const EE = 1000.0;
const rayleighZenithLength = 8.4e3;
const mieZenithLength = 1.25e3;

const sunIntensity = (zenithAngleCos) => {
  const c = Math.min(1, Math.max(-1, zenithAngleCos));
  return EE * Math.max(0, 1 - Math.exp(-((cutoffAngle - Math.acos(c)) / steepness)));
};

/**
 * Linear radiance of the sky in a direction (same units the Sky shader writes
 * before tone mapping).
 * @param {{x:number,y:number,z:number}} dir unit direction
 * @param {{x:number,y:number,z:number}} sun unit sun direction
 * @param {{ turbidity:number, rayleigh:number, mieCoefficient:number, mieDirectionalG:number }} p
 */
export function skyRadiance(dir, sun, p) {
  const sunE = sunIntensity(sun.y);
  const sunfade = 1 - Math.min(1, Math.max(0, 1 - Math.exp(sun.y / 450000)));
  const rayleighCoefficient = p.rayleigh - (1 - sunfade);
  const betaR = totalRayleigh.map((v) => v * rayleighCoefficient);
  const c = 0.2 * p.turbidity * 10e-18;
  const betaM = MieConst.map((v) => 0.434 * c * v * p.mieCoefficient);

  const zenithAngle = Math.acos(Math.max(0, dir.y));
  const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = rayleighZenithLength * inverse;
  const sM = mieZenithLength * inverse;
  const Fex = [0, 1, 2].map((i) => Math.exp(-(betaR[i] * sR + betaM[i] * sM)));

  const cosTheta = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  const rc = cosTheta * 0.5 + 0.5;
  const rPhase = 0.05968310365946075 * (1 + rc * rc);
  const g = p.mieDirectionalG;
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosTheta + g2, 1.5));

  const out = [0, 0, 0];
  const horizonMix = Math.min(1, Math.max(0, Math.pow(1 - sun.y, 5)));
  for (let i = 0; i < 3; i++) {
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex[i]), 1.5);
    Lin *= 1 + (Math.pow(sunE * ratio * Fex[i], 0.5) - 1) * horizonMix;
    const L0 = 0.1 * Fex[i];
    out[i] = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
  }
  return out;
}
