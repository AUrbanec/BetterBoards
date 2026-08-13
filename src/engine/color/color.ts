/**
 * Color science: sRGB ↔ CIELAB (D65) and CIEDE2000 (ΔE2000).
 * Pure math — verified against the Sharma et al. 34-pair reference dataset
 * in tests/color.test.ts. Floats are fine here (display/advisory only).
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

export interface Rgb {
  r: number; // 0..255
  g: number;
  b: number;
}

/* ---------------- sRGB ↔ XYZ ↔ Lab ---------------- */

const D65 = { X: 0.95047, Y: 1.0, Z: 1.08883 };

function srgbChannelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

const EPS = Math.pow(6 / 29, 3);
const KAPPA_DIV = 3 * Math.pow(6 / 29, 2);

function fwd(t: number): number {
  return t > EPS ? Math.cbrt(t) : t / KAPPA_DIV + 4 / 29;
}

function inv(t: number): number {
  const t3 = t * t * t;
  return t3 > EPS ? t3 : KAPPA_DIV * (t - 4 / 29);
}

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
  const fx = fwd(X / D65.X);
  const fy = fwd(Y / D65.Y);
  const fz = fwd(Z / D65.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb({ L, a, b }: Lab): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const X = D65.X * inv(fx);
  const Y = D65.Y * inv(fy);
  const Z = D65.Z * inv(fz);
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return { r: linearToSrgbChannel(R), g: linearToSrgbChannel(G), b: linearToSrgbChannel(B) };
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const p = (v: number) => v.toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`;
}

export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex));
export const labToHex = (lab: Lab): string => rgbToHex(labToRgb(lab));

/* ---------------- CIEDE2000 ---------------- */

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/**
 * Full CIEDE2000 color difference (Sharma, Wu & Dalal 2005 formulation).
 */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(b2, a2p)) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;

  let hbp: number;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else {
    const sum = h1p + h2p;
    const diff = Math.abs(h1p - h2p);
    if (diff <= 180) hbp = sum / 2;
    else if (sum < 360) hbp = (sum + 360) / 2;
    else hbp = (sum - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbp - 30)) +
    0.24 * Math.cos(rad(2 * hbp)) +
    0.32 * Math.cos(rad(3 * hbp + 6)) -
    0.2 * Math.cos(rad(4 * hbp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Cbp7 = Math.pow(Cbp, 7);
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;

  const dL = dLp / SL;
  const dC = dCp / SC;
  const dH = dHp / SH;
  return Math.sqrt(dL * dL + dC * dC + dH * dH + RT * dC * dH);
}

/* ---------------- Match quality badges ---------------- */

export type MatchBadge = 'excellent' | 'good' | 'fair' | 'poor';

export function matchBadge(dE: number): MatchBadge {
  if (dE < 5) return 'excellent';
  if (dE < 10) return 'good';
  if (dE < 20) return 'fair';
  return 'poor';
}
