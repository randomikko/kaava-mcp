import { alias, type ColorValue, type Dimension, type Flat, type ShadowLayer } from '../tokens.js';

const rem = (px: number): Dimension => ({ value: Number((px / 16).toFixed(4)), unit: 'rem' });
const px = (value: number): Dimension => ({ value, unit: 'px' });

const SANS_FALLBACK = ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'];
const MONO_FALLBACK = ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'];

export function fontStack(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  const names = value
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return value.includes(',') ? names : [...names, ...fallback.filter((f) => f !== names[0])];
}

const TYPE_STEPS: [name: string, exponent: number, lineHeight: number][] = [
  ['xs', -2, 1.5],
  ['sm', -1, 1.5],
  ['base', 0, 1.5],
  ['lg', 1, 1.5],
  ['xl', 2, 1.4],
  ['2xl', 3, 1.3],
  ['3xl', 4, 1.25],
  ['4xl', 5, 1.15],
  ['5xl', 6, 1.1],
];

export function typeTokens(
  out: Flat,
  opts: { ratio: number; fonts: { sans?: string; mono?: string; display?: string } },
): void {
  out.set('font.family.sans', { $type: 'fontFamily', $value: fontStack(opts.fonts.sans, SANS_FALLBACK) });
  out.set('font.family.mono', { $type: 'fontFamily', $value: fontStack(opts.fonts.mono, MONO_FALLBACK) });
  out.set('font.family.display', {
    $type: 'fontFamily',
    $value: opts.fonts.display ? fontStack(opts.fonts.display, SANS_FALLBACK) : alias('font.family.sans'),
    $description: 'Headings.',
  });
  for (const [name, exp] of TYPE_STEPS) {
    // Never go below 11px, however tight the ratio.
    const size = Math.max(0.6875, opts.ratio ** exp);
    out.set(`font.size.${name}`, { $type: 'dimension', $value: { value: Number(size.toFixed(3)), unit: 'rem' } });
  }
  for (const [name, , lineHeight] of TYPE_STEPS) {
    out.set(`font.lineHeight.${name}`, { $type: 'number', $value: lineHeight });
  }
  for (const [name, weight] of [
    ['regular', 400],
    ['medium', 500],
    ['semibold', 600],
    ['bold', 700],
  ] as const) {
    out.set(`font.weight.${name}`, { $type: 'fontWeight', $value: weight });
  }
}

export const SPACE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const;
/** One spacing unit, in px. `space.N` is N units. */
export const SPACE_UNIT = 4;

const DENSITY = {
  compact: { control: [28, 32, 40], padX: 3, gap: 2, inset: 4, section: 8 },
  comfortable: { control: [32, 40, 48], padX: 4, gap: 3, inset: 6, section: 12 },
  spacious: { control: [36, 44, 56], padX: 5, gap: 4, inset: 8, section: 16 },
} as const;

export function spaceTokens(out: Flat, density: keyof typeof DENSITY): void {
  for (const step of SPACE_STEPS) {
    out.set(`space.${step}`, { $type: 'dimension', $value: rem(step * SPACE_UNIT) });
  }
  const d = DENSITY[density];
  const semantic: [string, number, string][] = [
    ['control', d.padX, 'Horizontal padding inside buttons and inputs.'],
    ['gap', d.gap, 'Default gap between related elements.'],
    ['inset', d.inset, 'Padding inside cards, dialogs and panels.'],
    ['section', d.section, 'Vertical distance between page sections.'],
  ];
  for (const [name, step, description] of semantic) {
    out.set(`space.${name}`, { $type: 'dimension', $value: alias(`space.${step}`), $description: description });
  }
  (['sm', 'md', 'lg'] as const).forEach((name, i) => {
    out.set(`size.control.${name}`, {
      $type: 'dimension',
      $value: rem(d.control[i]!),
      $description: `Height of ${name} buttons, inputs and selects.`,
    });
  });
}

const RADIUS_BASE = { none: 0, sm: 4, md: 8, lg: 12, full: 12 } as const;

export function radiusTokens(out: Flat, radius: keyof typeof RADIUS_BASE): void {
  const b = RADIUS_BASE[radius];
  out.set('radius.none', { $type: 'dimension', $value: px(0) });
  out.set('radius.sm', { $type: 'dimension', $value: rem(b / 2) });
  out.set('radius.md', { $type: 'dimension', $value: rem(b) });
  out.set('radius.lg', { $type: 'dimension', $value: rem(b * 1.5) });
  out.set('radius.xl', { $type: 'dimension', $value: rem(b * 2) });
  out.set('radius.full', { $type: 'dimension', $value: px(9999) });
  out.set('radius.control', {
    $type: 'dimension',
    $value: alias(radius === 'full' ? 'radius.full' : 'radius.md'),
    $description: 'Buttons, inputs, badges.',
  });
  out.set('radius.surface', {
    $type: 'dimension',
    $value: alias('radius.lg'),
    $description: 'Cards, dialogs, popovers.',
  });
}

type LayerSpec = [y: number, blur: number, spread: number, alpha: number];

const SHADOW_STYLES: Record<'none' | 'soft' | 'crisp', Record<'sm' | 'md' | 'lg', LayerSpec[]>> = {
  none: { sm: [[0, 0, 0, 0]], md: [[0, 0, 0, 0]], lg: [[0, 0, 0, 0]] },
  soft: {
    sm: [[1, 2, 0, 0.06]],
    md: [
      [4, 12, -2, 0.1],
      [2, 4, -2, 0.06],
    ],
    lg: [
      [12, 32, -4, 0.14],
      [4, 8, -4, 0.08],
    ],
  },
  crisp: {
    sm: [[1, 0, 0, 0.08]],
    md: [[2, 4, 0, 0.14]],
    lg: [[6, 12, -2, 0.2]],
  },
};

export function shadowTokens(out: Flat, style: keyof typeof SHADOW_STYLES, shadowColor: ColorValue): void {
  for (const level of ['sm', 'md', 'lg'] as const) {
    const layers: ShadowLayer[] = SHADOW_STYLES[style][level].map(([y, blur, spread, a]) => ({
      color: { ...shadowColor, alpha: a },
      offsetX: px(0),
      offsetY: px(y),
      blur: px(blur),
      spread: px(spread),
    }));
    out.set(`shadow.${level}`, { $type: 'shadow', $value: layers });
  }
}

export function motionTokens(out: Flat): void {
  for (const [name, ms] of [
    ['fast', 120],
    ['base', 200],
    ['slow', 320],
  ] as const) {
    out.set(`duration.${name}`, { $type: 'duration', $value: { value: ms, unit: 'ms' } });
  }
  out.set('ease.standard', { $type: 'cubicBezier', $value: [0.2, 0, 0, 1] });
  out.set('ease.in', { $type: 'cubicBezier', $value: [0.4, 0, 1, 1] });
  out.set('ease.out', { $type: 'cubicBezier', $value: [0, 0, 0.2, 1] });
}
