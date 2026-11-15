import type { KaavaSystem, Layers } from '../engine/resolve.js';
import { SPACE_UNIT } from '../engine/scales.js';
import { cssValue, type Flat } from '../tokens.js';
import { cssVar, HEADER, tailwindVar } from './names.js';

type Namer = (path: string) => string | null;

/** Tokens are visually grouped by their parent group, at most two levels deep (`palette.neutral`, `color`). */
const groupOf = (path: string): string => path.split('.').slice(0, -1).slice(0, 2).join('.');
type Ref = (path: string) => string;

/** `--name: value;` lines for a layer, with a blank line between top-level groups. */
export function declarations(layer: Flat, name: Namer, ref: Ref, indent: string): string[] {
  const lines: string[] = [];
  let group = '';
  for (const [path, token] of layer) {
    const variable = name(path);
    if (!variable) continue;
    const top = groupOf(path);
    if (group && top !== group && lines.at(-1) !== '') lines.push('');
    group = top;
    lines.push(`${indent}${variable}: ${cssValue(token, ref)};`);
  }
  return lines;
}

function darkBlocks(layers: Layers, name: Namer, ref: Ref, indent: string): string[] {
  if (!layers.dark) return [];
  const inner = (pad: string) => [`${pad}color-scheme: dark;`, ...declarations(layers.dark!, name, ref, pad)];
  return [
    `${indent}/* Dark theme: follows the OS unless data-theme="light" is set, or forced with data-theme="dark" / .dark */`,
    `${indent}@media (prefers-color-scheme: dark) {`,
    `${indent}  :root:not([data-theme="light"]) {`,
    ...inner(`${indent}    `),
    `${indent}  }`,
    `${indent}}`,
    `${indent}:root[data-theme="dark"],`,
    `${indent}.dark {`,
    ...inner(`${indent}  `),
    `${indent}}`,
  ];
}

/** Zero the duration tokens when the OS asks for reduced motion, so token-driven transitions become instant. */
function reducedMotion(layers: Layers, name: Namer, indent: string): string[] {
  const durations = [...layers.base.keys()].filter((p) => p.startsWith('duration.')).map(name).filter((v): v is string => !!v);
  if (durations.length === 0) return [];
  return [
    `${indent}/* Reduced motion: transitions that use the duration tokens become instant. */`,
    `${indent}@media (prefers-reduced-motion: reduce) {`,
    `${indent}  :root {`,
    ...durations.map((v) => `${indent}    ${v}: 0ms;`),
    `${indent}  }`,
    `${indent}}`,
  ];
}

export function emitCss(system: KaavaSystem, layers: Layers): string {
  const ref: Ref = (path) => `var(${cssVar(path)})`;
  return [
    `/* ${HEADER(system.name)} */`,
    ':root {',
    `  color-scheme: light;`,
    ...declarations(layers.base, cssVar, ref, '  '),
    '',
    ...declarations(layers.light, cssVar, ref, '  '),
    '}',
    '',
    ...darkBlocks(layers, cssVar, ref, ''),
    ...(layers.dark ? [''] : []),
    ...reducedMotion(layers, cssVar, ''),
    '',
  ].join('\n');
}

/** Tailwind v4 theme. Import it after `@import "tailwindcss";`. */
export function emitTailwind(system: KaavaSystem, layers: Layers): string {
  const ref: Ref = (path) => {
    const variable = tailwindVar(path);
    if (variable) return `var(${variable})`;
    const step = Number(path.split('.')[1]);
    return step === 0 ? '0' : `calc(var(--spacing) * ${step})`;
  };
  return [
    `/* ${HEADER(system.name)}`,
    ' *',
    ' * Usage:  @import "tailwindcss";',
    ' *         @import "./tailwind.css";',
    ' *',
    ' * Semantic colors become utilities: bg-surface, text-fg, text-fg-muted, bg-primary, text-on-primary,',
    ' * border-border, ring-ring. Prefer them over palette steps (bg-primary-500) so dark mode keeps working.',
    ' * Also: rounded-control, rounded-surface, p-inset, gap-gap, px-control, py-section, font-display.',
    ' * Control heights and durations are plain variables: h-(--size-control-md), duration-(--duration-fast).',
    ' */',
    '@theme {',
    `  --spacing: ${SPACE_UNIT / 16}rem;`,
    '',
    ...declarations(layers.base, tailwindVar, ref, '  '),
    '',
    ...declarations(layers.light, tailwindVar, ref, '  '),
    '}',
    '',
    '@layer base {',
    ...darkBlocks(layers, tailwindVar, ref, '  '),
    ...(layers.dark ? [''] : []),
    ...reducedMotion(layers, tailwindVar, '  '),
    '}',
    '',
  ].join('\n');
}

/** SCSS variables for compile-time use, followed by the custom properties so the file works standalone. */
export function emitScss(system: KaavaSystem, layers: Layers): string {
  const scssVar = (path: string): string => `$${cssVar(path).slice(2)}`;
  const lines: string[] = [`// ${HEADER(system.name)}`, ''];
  let group = '';
  for (const [path, token] of layers.base) {
    const top = groupOf(path);
    if (group && top !== group) lines.push('');
    group = top;
    lines.push(`${scssVar(path)}: ${cssValue(token, scssVar)};`);
  }
  lines.push('', '// Semantic colors switch with the theme at runtime, so they point at custom properties.');
  for (const path of layers.light.keys()) lines.push(`${scssVar(path)}: var(${cssVar(path)});`);
  lines.push('', emitCss(system, layers).split('\n').slice(1).join('\n'));
  return lines.join('\n');
}
