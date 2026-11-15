import { SOLID_ROLES, SURFACES } from '../audit.js';
import { resolveBrief, traits, type KaavaSystem, type Layers } from '../engine/resolve.js';
import { TYPE_STEPS } from '../style.js';
import { colorCss, cssValue, resolveToken, type ColorValue, type Dimension, type Flat } from '../tokens.js';
import { cssVar, HEADER } from './names.js';

type Yaml = string | number | { [key: string]: Yaml };

/** Type steps from this one up are heading levels; smaller ones are body text. */
const FIRST_HEADING_STEP = 'xl';

/**
 * YAML for nested maps of strings and numbers. Strings are written as JSON strings, which YAML reads as
 * double-quoted scalars, so no value (a hostile system name included) can break out of its line.
 */
function yaml(map: { [key: string]: Yaml }, indent = ''): string[] {
  return Object.entries(map).flatMap(([key, value]) => {
    const k = /^[A-Za-z][\w-]*$/.test(key) ? key : JSON.stringify(key);
    if (typeof value === 'object') return [`${indent}${k}:`, ...yaml(value, `${indent}  `)];
    return [`${indent}${k}: ${typeof value === 'number' ? value : JSON.stringify(value)}`];
  });
}

const ref = (group: string, name: string): string => `{${group}.${name}}`;

/**
 * The machine-readable half of DESIGN.md, in the schema of the DESIGN.md format
 * (https://github.com/google-labs-code/design.md). The format has one value per token, so colors are the
 * light theme; shadows, motion and the dark theme have no place in it and are documented in the body.
 */
function frontMatter(system: KaavaSystem, layers: Layers, description: string | undefined): { [key: string]: Yaml } {
  const base = [layers.base];
  const text = (path: string): string => cssValue(resolveToken(path, base), text);
  const number = (path: string): number => resolveToken(path, base).$value as number;
  // The format requires a unit on every dimension, zero included.
  const dimension = (path: string): string => {
    const d = resolveToken(path, base).$value as Dimension;
    return `${Number(d.value.toFixed(4))}${d.unit}`;
  };
  const under = (prefix: string): [name: string, path: string][] =>
    [...layers.base.keys()].filter((p) => p.startsWith(prefix)).map((p) => [p.slice(prefix.length), p]);

  const colors: { [key: string]: Yaml } = {};
  for (const path of layers.light.keys()) {
    colors[path.slice('color.'.length)] = colorCss(resolveToken(path, [layers.base, layers.light]).$value as ColorValue);
  }

  const level = (step: string, family: string, weight: string): Yaml => ({
    fontFamily: text(`font.family.${family}`),
    fontSize: dimension(`font.size.${step}`),
    fontWeight: number(`font.weight.${weight}`),
    lineHeight: number(`font.lineHeight.${step}`),
    letterSpacing: dimension(`font.tracking.${step}`),
  });
  const typography: { [key: string]: Yaml } = {};
  const firstHeading = TYPE_STEPS.indexOf(FIRST_HEADING_STEP);
  TYPE_STEPS.forEach((step, i) => {
    if (!layers.base.has(`font.size.${step}`)) return;
    if (i < firstHeading) typography[`body-${step}`] = level(step, 'sans', 'regular');
    else typography[`heading-${step}`] = level(step, 'display', 'heading');
  });
  typography.code = level('sm', 'mono', 'regular');

  const spacing: { [key: string]: Yaml } = {};
  for (const [name, path] of under('space.')) spacing[name] = dimension(path);
  for (const [name, path] of under('size.control.')) spacing[`control-${name}`] = dimension(path);

  const rounded: { [key: string]: Yaml } = {};
  for (const [name, path] of under('radius.')) rounded[name] = dimension(path);

  // One component per pairing the audit promises, so any DESIGN.md linter re-checks the same contrast.
  const has = (role: string): boolean => layers.light.has(`color.${role}`);
  const pair = (bg: string, fg: string): { [key: string]: Yaml } => ({ backgroundColor: ref('colors', bg), textColor: ref('colors', fg) });
  const components: { [key: string]: Yaml } = {};
  const surfaceNames: Record<(typeof SURFACES)[number], string> = { bg: 'page', surface: 'card', 'surface-muted': 'card-muted' };
  for (const surface of SURFACES) {
    if (!has(surface)) continue;
    components[surfaceNames[surface]] = {
      ...pair(surface, 'fg'),
      ...(surface === 'bg' ? {} : { rounded: ref('rounded', 'surface'), padding: ref('spacing', 'inset') }),
    };
    components[`${surfaceNames[surface]}-caption`] = pair(surface, 'fg-muted');
  }
  for (const role of SOLID_ROLES) {
    if (!has(role)) continue;
    components[`button-${role}`] = {
      ...pair(role, `on-${role}`),
      typography: ref('typography', 'body-sm'),
      rounded: ref('rounded', 'control'),
      height: ref('spacing', 'control-md'),
      padding: ref('spacing', 'control'),
    };
    components[`button-${role}-hover`] = pair(`${role}-hover`, `on-${role}`);
    components[`badge-${role}`] = { ...pair(`${role}-subtle`, `on-${role}-subtle`), typography: ref('typography', 'body-xs') };
    components[`link-${role}`] = pair('bg', `${role}-text`);
  }
  components.input = {
    ...pair('surface', 'fg'),
    typography: ref('typography', 'body-base'),
    rounded: ref('rounded', 'control'),
    height: ref('spacing', 'control-md'),
    padding: ref('spacing', 'control'),
  };
  // The format has no border property, so the three line colors are carried as fills.
  components.divider = { backgroundColor: ref('colors', 'border'), height: dimension('border.width') };
  components['control-outline'] = { backgroundColor: ref('colors', 'border-strong'), height: dimension('border.width') };
  components['focus-ring'] = { backgroundColor: ref('colors', 'ring'), height: '2px' };

  return {
    version: 'alpha',
    name: system.name,
    ...(description ? { description } : {}),
    colors,
    typography,
    rounded,
    spacing,
    components,
  };
}

/**
 * DESIGN.md: the rules an agent (or person) needs to build UI that stays inside the system. The file
 * follows the DESIGN.md format: YAML tokens in the front matter, then prose in the format's section order.
 */
export function emitDesignMd(system: KaavaSystem, layers: Layers): string {
  const b = resolveBrief(system.brief);
  const baseValue = (path: string): string => cssValue(resolveToken(path, [layers.base]), baseValue);
  const hex = (layer: Flat | undefined, path: string): string =>
    layer?.has(path) ? (resolveToken(path, [layers.base, layer]).$value as ColorValue).hex : '—';

  const colorRows = [...layers.light.entries()].map(
    ([path, token]) =>
      `| \`${cssVar(path)}\` | ${hex(layers.light, path)} | ${hex(layers.dark, path)} | ${token.$description ?? ''} |`,
  );
  const typeRows = [...layers.base.keys()]
    .filter((p) => p.startsWith('font.size.'))
    .map((p) => {
      const step = p.split('.')[2]!;
      return `| \`${cssVar(p)}\` | ${baseValue(p)} | ${baseValue(`font.lineHeight.${step}`)} | ${baseValue(`font.tracking.${step}`)} |`;
    });
  const list = (prefix: string): string =>
    [...layers.base.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => `\`${cssVar(p)}\` ${baseValue(p)}`)
      .join(' · ');
  const flat = traits(b).includes('flat');

  return `---
# ${HEADER(system.name)}
${yaml(frontMatter(system, layers, b.description)).join('\n')}
---

# ${system.name} — design system

## Overview

${b.description ? `${b.description}\n\n` : ''}**Style:** ${b.style.name}, by ${b.style.author}. ${b.style.description} (${traits(b).slice(1).join(', ')}.)

Generated by Kaava from \`kaava.json\`. This file is derived output: to change the system, update the brief or overrides with the Kaava MCP tools (\`kaava_update_system\`) and re-emit. Do not edit tokens by hand.

The file follows the [DESIGN.md format](https://github.com/google-labs-code/design.md). The front matter holds the tokens${layers.dark ? ' of the light theme' : ''}; in code, use the CSS variables named in the sections below. Read **Do's and Don'ts** before writing UI.

## Colors

A front matter color \`colors.<name>\` is the CSS variable \`--color-<name>\`.${layers.dark ? ' The variable switches between the Light and Dark values below with the theme; the front matter lists only the light ones.' : ''}

| Token | Light | Dark | Use |
|---|---|---|---|
${colorRows.join('\n')}

Palettes (\`--color-{neutral,primary,accent,success,warning,danger,info}-{50…950}\`) exist for charts, illustrations and gradients only.

## Typography

Front matter levels \`body-*\` are text in \`--font-family-sans\`, \`heading-*\` are headings in \`--font-family-display\` at \`--font-weight-heading\`, and \`code\` is \`--font-family-mono\`. Each level is one row of this table:

| Size token | Size | Line height (\`--font-line-height-*\`) | Letter-spacing (\`--font-tracking-*\`) |
|---|---|---|---|
${typeRows.join('\n')}

Set a size together with its line height and letter-spacing.

Weights: ${list('font.weight.')}
${b.style.type.webfonts.length ? `\nFonts: this style's typefaces are web fonts. Load ${b.style.type.webfonts.map((u) => `<${u}>`).join(' and ')} once in the document head; the token files do not load them.\n` : ''}
## Layout

- Spacing scale (1 unit = 4px): ${list('space.')}
- Control heights: ${list('size.control.')}

Front matter \`spacing.<step>\` is \`--space-<step>\`, and \`spacing.control-<size>\` is \`--size-control-<size>\`.

## Elevation & Depth

${flat ? 'This system is flat: `--shadow-sm`, `--shadow-md` and `--shadow-lg` are all `none`. Separate layers with `--color-border` instead.' : 'Shadows: `--shadow-sm` for resting cards, `--shadow-md` for popovers and dropdowns, `--shadow-lg` for dialogs.'}

## Shapes

- Radius: ${list('radius.')}
- Border width: \`--border-width\` ${baseValue('border.width')}

Front matter \`rounded.<name>\` is \`--radius-<name>\`.

## Components

The front matter \`components\` are the foreground and background pairings this system promises, one entry per pairing: \`page\`, \`card\` and \`card-muted\` (with \`-caption\` variants for secondary text), \`input\`, and per color role \`button-<role>\`, \`button-<role>-hover\`, \`badge-<role>\` and \`link-<role>\`. Build components from the CSS variables behind those tokens.

\`divider\`, \`control-outline\` and \`focus-ring\` are lines, not fills: the format has no border property, so their \`backgroundColor\` is the line color (\`--color-border\`, \`--color-border-strong\`, \`--color-ring\`) and their \`height\` is the line width.

## Do's and Don'ts

1. **Never hard-code** colors, font sizes, spacing, radii or shadows. Every value comes from a token above.
2. **Use semantic colors, not palette steps.** \`var(--color-surface)\`, not \`var(--color-neutral-100)\`. Palette steps do not adapt to dark mode; semantic colors do.
3. **Pair foregrounds with their background.** Each pairing below is contrast-checked (WCAG 2.2 AA); other combinations are not.
   - On \`bg\`, \`surface\`, \`surface-muted\`: text is \`fg\` or \`fg-muted\`; colored text and links use \`primary-text\`, \`danger-text\`, etc.
   - On a solid fill such as \`primary\` or \`danger\`: text is the matching \`on-primary\`, \`on-danger\`.
   - On a tinted fill such as \`primary-subtle\`: text is \`on-primary-subtle\`.
4. **One primary action per view.** \`primary\` is for the main action and active state; \`accent\` is for highlights, not a second button color.
5. **Status colors carry meaning only**: success, warning, danger, info. Never decorative, and never the only signal: pair them with an icon or a text label, because red and green look alike to many people.
6. **Spacing comes from the scale**; use \`--space-gap\` between related items, \`--space-inset\` inside containers, \`--space-section\` between sections.
7. **Controls** (buttons, inputs, selects) use \`--size-control-*\` for height, \`--space-control\` for horizontal padding, \`--radius-control\` for corners, and \`--color-border-strong\` for outlines. Containers use \`--radius-surface\`. Every border is \`--border-width\` wide.
8. **Focus is always visible**: a 2px \`--color-ring\` outline with 2px offset on every interactive element.
9. **Targets are at least 24px** in both directions; on touch screens use a control height of 44px or more.
10. **New color pairings are checked first**: before putting a foreground on a background that rule 3 does not list, run \`kaava_check_contrast\`.
11. **Headings** use \`--font-family-display\` at \`--font-weight-heading\`; everything else \`--font-family-sans\`; code \`--font-family-mono\`.

## Motion

${list('duration.')}; easing \`--ease-standard\` for most transitions, \`--ease-out\` for entering, \`--ease-in\` for leaving. The emitted stylesheets set these durations to 0ms under \`prefers-reduced-motion: reduce\`; animations that do not use the tokens must handle it themselves.

## Theming

${layers.dark ? 'Dark mode follows the OS by default. Force a theme with `data-theme="dark"` or `data-theme="light"` on `<html>` (the `.dark` class also works).' : 'This system is light-only.'}
`;
}
