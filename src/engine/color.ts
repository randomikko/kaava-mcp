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

/** How a style shapes every ramp: OKLCH lightness per step, and the share of peak chroma used at each step. */
export interface RampCurves {
  lightness: number[];
  chroma: number[];
}

/** Lightness is the same for every hue, so ramps are interchangeable step-for-step. */
export function ramp(hue: number, peakChroma: number, curves: RampCurves): Ramp {
  const out = {} as Ramp;
  RAMP_STEPS.forEach((step, i) => {
    out[step] = oklch(curves.lightness[i]!, peakChroma * curves.chroma[i]!, hue);
  });
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
