import { converter, formatHex, parse, toGamut, wcagContrast } from 'culori';
import type { ColorValue } from '../tokens.js';

const toOklch = converter('oklch');
const toRgb = converter('rgb');
const intoSrgb = toGamut('rgb', 'oklch');

const round = (n: number, digits: number): number => Number(n.toFixed(digits));

export function fromHex(hex: string, alpha?: number): ColorValue {
  const o = toOklch(hex);
  if (!o) throw new Error(`Invalid hex color "${hex}"`);
  return {
    colorSpace: 'oklch',
    components: [round(o.l, 4), round(o.c, 4), round(o.h ?? 0, 1)],
    ...(alpha !== undefined && alpha < 1 ? { alpha: round(alpha, 3) } : {}),
    hex,
  };
}

/** Build a color from OKLCH, reducing chroma until it fits sRGB (hue and lightness are preserved). */
export function oklch(l: number, c: number, h: number, alpha?: number): ColorValue {
  return fromHex(formatHex(intoSrgb({ mode: 'oklch', l, c, h })), alpha);
}

export function parseColor(input: string): ColorValue {
  const parsed = parse(input.trim());
  if (!parsed) {
    throw new Error(`Cannot parse color "${input}". Use a CSS color such as "#4f46e5", "rgb(79 70 229)" or "oklch(0.55 0.2 270)".`);
  }
  return fromHex(formatHex(intoSrgb(parsed)), parsed.alpha);
}

export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type RampStep = (typeof RAMP_STEPS)[number];
export type Ramp = Record<RampStep, ColorValue>;

/** Fixed perceptual lightness per step, so every hue's ramp is interchangeable step-for-step. */
const LIGHTNESS: Record<RampStep, number> = {
  50: 0.975,
  100: 0.94,
  200: 0.88,
  300: 0.8,
  400: 0.7,
  500: 0.6,
  600: 0.52,
  700: 0.44,
  800: 0.36,
  900: 0.28,
  950: 0.2,
};

/** Share of peak chroma per step: colorful in the middle, restrained at both ends. */
const CHROMA: Record<RampStep, number> = {
  50: 0.12,
  100: 0.25,
  200: 0.45,
  300: 0.7,
  400: 0.9,
  500: 1,
  600: 1,
  700: 0.9,
  800: 0.75,
  900: 0.6,
  950: 0.45,
};

export function ramp(hue: number, peakChroma: number): Ramp {
  const out = {} as Ramp;
  for (const step of RAMP_STEPS) out[step] = oklch(LIGHTNESS[step], peakChroma * CHROMA[step], hue);
  return out;
}

/** WCAG 2.x contrast ratio, 1–21. */
export const wcag = (a: string, b: string): number => wcagContrast(a, b);

/**
 * APCA-W3 0.1.9 lightness contrast (Lc). Positive for dark text on light, negative for light on dark.
 * Reported for information; pass/fail in Kaava is decided by WCAG 2.2.
 */
export function apca(textHex: string, bgHex: string): number {
  const y = (hex: string): number => {
    const c = toRgb(hex)!;
    const lum = 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4;
    return lum >= 0.022 ? lum : lum + (0.022 - lum) ** 1.414;
  };
  const yText = y(textHex);
  const yBg = y(bgHex);
  if (Math.abs(yBg - yText) < 0.0005) return 0;
  if (yBg > yText) {
    const sapc = (yBg ** 0.56 - yText ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (yBg ** 0.65 - yText ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}
