import type { KaavaSystem, Layers } from '../engine/resolve.js';
import { cssValue, lookup, resolveToken, type ColorValue, type Dimension, type Flat } from '../tokens.js';
import { HEADER } from './names.js';

/** shadcn/ui variable -> Kaava semantic color role. Pairs follow shadcn's `x` / `x-foreground` convention. */
const COLORS: readonly (readonly [variable: string, role: string])[] = [
  ['background', 'color.bg'],
  ['foreground', 'color.fg'],
  ['card', 'color.surface'],
  ['card-foreground', 'color.fg'],
  ['popover', 'color.surface'],
  ['popover-foreground', 'color.fg'],
  ['primary', 'color.primary'],
  ['primary-foreground', 'color.on-primary'],
  ['secondary', 'color.surface-muted'],
  ['secondary-foreground', 'color.fg'],
  ['muted', 'color.surface-muted'],
  ['muted-foreground', 'color.fg-muted'],
  ['accent', 'color.accent'],
  ['accent-foreground', 'color.on-accent'],
  ['destructive', 'color.danger'],
  ['destructive-foreground', 'color.on-danger'],
  ['border', 'color.border'],
  ['input', 'color.border-strong'],
  ['ring', 'color.ring'],
  ['chart-1', 'color.primary'],
  ['chart-2', 'color.info'],
  ['chart-3', 'color.success'],
  ['chart-4', 'color.warning'],
  ['chart-5', 'color.accent'],
  ['sidebar', 'color.surface'],
  ['sidebar-foreground', 'color.fg'],
  ['sidebar-primary', 'color.primary'],
  ['sidebar-primary-foreground', 'color.on-primary'],
  ['sidebar-accent', 'color.surface-muted'],
  ['sidebar-accent-foreground', 'color.fg'],
  ['sidebar-border', 'color.border'],
  ['sidebar-ring', 'color.ring'],
];

/** Variables that become Tailwind color utilities (`bg-primary`, `text-muted-foreground`, ...). */
const THEME_COLORS = COLORS.map(([variable]) => variable);

/** Trim trailing zeros: `0.55` rather than `0.5500`. */
const num = (n: number): string => String(Number(n.toFixed(4)));

/** shadcn's own defaults are OKLCH, and Kaava computes in OKLCH, so the values go through without a hex round trip. */
function oklchCss(c: ColorValue): string {
  const [l, chroma, h] = c.components;
  const alpha = c.alpha !== undefined && c.alpha < 1 ? ` / ${num(Math.max(0, c.alpha))}` : '';
  return `oklch(${num(l)} ${num(chroma)} ${num(h)}${alpha})`;
}

function colorBlock(scope: Flat[], indent: string): string[] {
  const resolve = (role: string): string => {
    const token = resolveToken(role, scope);
    if (token.$type !== 'color') throw new Error(`Token "${role}" is not a color`);
    return oklchCss(token.$value as ColorValue);
  };
  return COLORS.map(([variable, role]) => `${indent}--${variable}: ${resolve(role)};`);
}

/** shadcn derives sm/md/lg/xl from one `--radius`. A pill-shaped control would turn every card into a pill too, so it falls back to the largest corner. */
function baseRadius(layers: Layers): string {
  const scope = [layers.base];
  const control = resolveToken('radius.control', scope);
  const pill = (control.$value as Dimension).unit === 'px' && (control.$value as Dimension).value >= 100;
  return cssValue(resolveToken(pill ? 'radius.xl' : 'radius.control', scope), () => '');
}

function fontLines(layers: Layers, indent: string): string[] {
  const out: string[] = [];
  for (const name of ['sans', 'mono'] as const) {
    const token = lookup(`font.family.${name}`, [layers.base]);
    if (token) out.push(`${indent}--font-${name}: ${cssValue(resolveToken(`font.family.${name}`, [layers.base]), () => '')};`);
  }
  return out;
}

/**
 * The theme variables shadcn/ui components read, with Kaava's contrast-checked roles filled in for light and dark.
 * Colors are fully resolved (no `var()` chains) so the file works pasted over a `globals.css` from `shadcn init`.
 */
export function emitShadcn(system: KaavaSystem, layers: Layers): string {
  const lightScope = [layers.base, layers.light];
  const darkScope = layers.dark ? [layers.base, layers.dark] : undefined;
  return [
    `/* ${HEADER(system.name)}`,
    ' *',
    ' * For shadcn/ui on Tailwind v4. Run `npx shadcn@latest init` first, then replace the :root, .dark and',
    ' * @theme inline blocks in your globals.css with these (or import this file after `@import "tailwindcss";`).',
    ...(darkScope ? [' * Dark mode applies under .dark or [data-theme="dark"].'] : []),
    ' * The foreground and background pairs keep the contrast Kaava audits.',
    ' */',
    ':root {',
    '  color-scheme: light;',
    `  --radius: ${baseRadius(layers)};`,
    ...colorBlock(lightScope, '  '),
    '}',
    '',
    ...(darkScope
      ? [':root[data-theme="dark"],', '.dark {', '  color-scheme: dark;', ...colorBlock(darkScope, '  '), '}', '']
      : []),
    '@theme inline {',
    '  --radius-sm: calc(var(--radius) - 4px);',
    '  --radius-md: calc(var(--radius) - 2px);',
    '  --radius-lg: var(--radius);',
    '  --radius-xl: calc(var(--radius) + 4px);',
    ...fontLines(layers, '  '),
    ...THEME_COLORS.map((variable) => `  --color-${variable}: var(--${variable});`),
    '}',
    '',
  ].join('\n');
}
