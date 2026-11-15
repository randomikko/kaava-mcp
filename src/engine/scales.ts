import { SHADOW_LEVELS, SPACE_STEPS, TYPE_STEPS, type DensitySpec, type Style } from '../style.js';
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

/** Type sizes in rem for xs…5xl: hand-set, or a modular scale around 1rem that never drops below 11px. */
export function typeSizes(scale: Style['type']['scale']): number[] {
  if ('sizes' in scale) return scale.sizes;
  return TYPE_STEPS.map((_, i) => Number(Math.max(0.6875, scale.ratio ** (i - 2)).toFixed(3)));
}

export function typeTokens(out: Flat, type: Style['type']): void {
  out.set('font.family.sans', { $type: 'fontFamily', $value: fontStack(type.families.sans, SANS_FALLBACK) });
  out.set('font.family.mono', { $type: 'fontFamily', $value: fontStack(type.families.mono, MONO_FALLBACK) });
  out.set('font.family.display', {
    $type: 'fontFamily',
    $value: type.families.display ? fontStack(type.families.display, SANS_FALLBACK) : alias('font.family.sans'),
    $description: 'Headings.',
  });
  const sizes = typeSizes(type.scale);
  TYPE_STEPS.forEach((name, i) => out.set(`font.size.${name}`, { $type: 'dimension', $value: { value: sizes[i]!, unit: 'rem' } }));
  TYPE_STEPS.forEach((name, i) => out.set(`font.lineHeight.${name}`, { $type: 'number', $value: type.lineHeights[i]! }));
  TYPE_STEPS.forEach((name, i) =>
    out.set(`font.tracking.${name}`, { $type: 'dimension', $value: { value: type.tracking[i]!, unit: 'em' }, ...(i === 0 ? { $description: 'Letter-spacing for each font size.' } : {}) }),
  );
  for (const name of ['regular', 'medium', 'semibold', 'bold'] as const) {
    out.set(`font.weight.${name}`, { $type: 'fontWeight', $value: type.weights[name] });
  }
  out.set('font.weight.heading', { $type: 'fontWeight', $value: alias(`font.weight.${type.headingWeight}`), $description: 'Headings.' });
}

/** One spacing unit, in px. `space.N` is N units. */
export const SPACE_UNIT = 4;

export function spaceTokens(out: Flat, d: DensitySpec): void {
  for (const step of SPACE_STEPS) {
    out.set(`space.${step}`, { $type: 'dimension', $value: rem(step * SPACE_UNIT) });
  }
  const semantic: [string, number, string][] = [
    ['control', d.padX, 'Horizontal padding inside buttons and inputs.'],
    ['gap', d.gap, 'Default gap between related elements.'],
    ['inset', d.inset, 'Padding inside cards, dialogs and panels.'],
    ['section', d.section, 'Vertical distance between page sections.'],
  ];
  for (const [name, step, description] of semantic) {
    // A style may ask for a step the scale does not have; use the nearest one that exists.
    const nearest = SPACE_STEPS.reduce((a, b) => (Math.abs(b - step) < Math.abs(a - step) ? b : a));
    out.set(`space.${name}`, { $type: 'dimension', $value: alias(`space.${nearest}`), $description: description });
  }
  (['sm', 'md', 'lg'] as const).forEach((name, i) => {
    out.set(`size.control.${name}`, {
      $type: 'dimension',
      $value: rem(d.control[i]!),
      $description: `Height of ${name} buttons, inputs and selects.`,
    });
  });
}

export function shapeTokens(out: Flat, shape: Style['shape']): void {
  out.set('radius.none', { $type: 'dimension', $value: px(0) });
  for (const name of ['sm', 'md', 'lg', 'xl'] as const) out.set(`radius.${name}`, { $type: 'dimension', $value: rem(shape.radius[name]) });
  out.set('radius.full', { $type: 'dimension', $value: px(9999) });
  out.set('radius.control', { $type: 'dimension', $value: alias(`radius.${shape.control}`), $description: 'Buttons, inputs, badges.' });
  out.set('radius.surface', { $type: 'dimension', $value: alias(`radius.${shape.surface}`), $description: 'Cards, dialogs, popovers.' });
  out.set('border.width', { $type: 'dimension', $value: px(shape.borderWidth), $description: 'Borders and outlines.' });
}

export function shadowTokens(out: Flat, elevation: Style['elevation'], shadowColor: ColorValue): void {
  for (const level of SHADOW_LEVELS) {
    const layers: ShadowLayer[] = elevation[level].map(([y, blur, spread, a]) => ({
      color: { ...shadowColor, alpha: a },
      offsetX: px(0),
      offsetY: px(y),
      blur: px(blur),
      spread: px(spread),
    }));
    out.set(`shadow.${level}`, { $type: 'shadow', $value: layers });
  }
}

export function motionTokens(out: Flat, motion: Style['motion']): void {
  for (const name of ['fast', 'base', 'slow'] as const) {
    out.set(`duration.${name}`, { $type: 'duration', $value: { value: motion.durations[name], unit: 'ms' } });
  }
  for (const name of ['standard', 'in', 'out'] as const) {
    out.set(`ease.${name}`, { $type: 'cubicBezier', $value: motion.easings[name] });
  }
}
