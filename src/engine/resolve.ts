import { SYSTEM_VERSION, type Brief, type EmitTarget } from '../schema.js';
import { DEFAULT_STYLE_ID, getStyle, type Style, type SurfaceStep } from '../style.js';
import {
  alias,
  aliasPath,
  flatten,
  resolveToken,
  toTree,
  type ColorValue,
  type Flat,
  type Token,
  type TokenGroup,
  type TokenValue,
} from '../tokens.js';
import { fromHex, oklch, parseColor, ramp, wcag, type Ramp, type RampStep } from './color.js';
import { motionTokens, shadowTokens, shapeTokens, spaceTokens, typeSizes, typeTokens } from './scales.js';

export interface Layers {
  /** Mode-independent tokens: palettes, type, space, radius, shadow, motion. */
  base: Flat;
  /** Semantic color roles. */
  light: Flat;
  dark?: Flat;
}

export interface KaavaSystem {
  kaava: string;
  name: string;
  brief: Brief;
  overrides?: Record<string, string>;
  emit?: { outDir: string; targets: EmitTarget[] };
  tokens: TokenGroup;
  modes: { light: TokenGroup; dark?: TokenGroup };
}

export interface ResolvedBrief {
  name: string;
  description?: string;
  brandColor: string;
  accent?: string;
  /** Id of the style the brief names; `default` when it names none. */
  styleId: string;
  /** The style with the brief's own overrides (radius, type scale, fonts, shadows, neutral tint) applied. */
  style: Style;
  density: Style['space']['density'];
  darkMode: boolean;
}

/** Generic corner scales for a brief that overrides the style's own with `radius`. */
const RADIUS_OVERRIDE = { none: 0, sm: 4, md: 8, lg: 12, full: 12 } as const;
/** Generic shadow recipes for a brief that overrides the style's own with `shadows`. */
const SHADOW_OVERRIDE: Record<'none' | 'soft' | 'crisp', Style['elevation']> = {
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
  crisp: { sm: [[1, 0, 0, 0.08]], md: [[2, 4, 0, 0.14]], lg: [[6, 12, -2, 0.2]] },
};

export function resolveBrief(brief: Brief): ResolvedBrief {
  const authored = getStyle(brief.style ?? DEFAULT_STYLE_ID);
  const style: Style = structuredClone(authored);
  if (brief.neutralTint !== undefined) style.color.neutralTint = brief.neutralTint;
  if (brief.radius) {
    const base = RADIUS_OVERRIDE[brief.radius];
    style.shape = { ...style.shape, radius: { sm: base / 2, md: base, lg: base * 1.5, xl: base * 2 }, control: brief.radius === 'full' ? 'full' : 'md', surface: 'lg' };
  }
  if (brief.typeScale !== undefined) style.type.scale = { ratio: brief.typeScale };
  if (brief.shadows) style.elevation = SHADOW_OVERRIDE[brief.shadows];
  if (brief.fonts && Object.values(brief.fonts).some(Boolean)) {
    style.type.families = { ...style.type.families, ...brief.fonts };
    // The style's webfonts no longer describe the families in use.
    style.type.webfonts = [];
  }
  return {
    name: brief.name ?? 'Design system',
    description: brief.description,
    brandColor: brief.brandColor,
    accent: brief.accent,
    styleId: authored.id,
    style,
    density: brief.density ?? style.space.density,
    darkMode: brief.darkMode ?? true,
  };
}

/** Short labels describing a resolved system, for summaries, DESIGN.md and the preview. */
export function traits(b: ResolvedBrief): string[] {
  const { style } = b;
  const controlRadius = style.shape.control === 'full' ? 'pill controls' : `radius ${style.shape.control === 'none' ? 0 : style.shape.radius[style.shape.control]}px`;
  const flat = Object.values(style.elevation).every((layers) => layers.every((layer) => layer[3] === 0));
  return [
    b.styleId === DEFAULT_STYLE_ID ? 'default style' : `${style.name} style`,
    b.density,
    controlRadius,
    'ratio' in style.type.scale ? `type scale ${style.type.scale.ratio}` : `hand-set type (${typeSizes(style.type.scale)[2]}rem base)`,
    flat ? 'flat' : 'shadows',
  ];
}

/** Light fills use a darker solid step than dark-mode fills; warning stays light so it reads as amber, not brown. */
const STATUS_SOLID = {
  success: { light: 600, dark: 400 },
  warning: { light: 400, dark: 400 },
  danger: { light: 600, dark: 400 },
  info: { light: 600, dark: 400 },
} as const satisfies Record<string, Record<Mode, RampStep>>;

type Mode = 'light' | 'dark';
type PaletteName = 'neutral' | 'primary' | 'accent' | keyof typeof STATUS_SOLID;

const color = ($value: TokenValue, $description?: string): Token => ({
  $type: 'color',
  $value,
  ...($description ? { $description } : {}),
});

function semanticColors(
  mode: Mode,
  palettes: Record<PaletteName, Ramp>,
  brand: Record<'primary' | 'accent', ColorValue>,
  surfaceSteps: Style['color']['surfaces'][Mode],
): Flat {
  const out: Flat = new Map();
  const light = mode === 'light';
  const ref = (name: PaletteName, step: RampStep) => ({ value: alias(`palette.${name}.${step}`), hex: palettes[name][step].hex });
  const WHITE = { value: alias('palette.white'), hex: '#ffffff' };
  const BLACK = { value: alias('palette.black'), hex: '#000000' };

  /** First ramp step, in preference order, that reaches `min` contrast on every background. */
  const pick = (name: PaletteName, order: RampStep[], backgrounds: string[], min: number) => {
    for (const step of order) {
      const candidate = ref(name, step);
      if (backgrounds.every((bg) => wcag(candidate.hex, bg) >= min)) return candidate;
    }
    return ref(name, order.at(-1)!);
  };

  /** Text color for a solid fill: soft white/near-black if they pass AA, otherwise pure white/black. */
  const onColor = (bg: string) => {
    const soft = [WHITE, ref('neutral', 950)].sort((a, b) => wcag(b.hex, bg) - wcag(a.hex, bg))[0]!;
    if (wcag(soft.hex, bg) >= 4.5) return soft;
    return wcag(WHITE.hex, bg) >= wcag(BLACK.hex, bg) ? WHITE : BLACK;
  };

  const at = (step: SurfaceStep) => (step === 'white' ? WHITE : step === 'black' ? BLACK : ref('neutral', step));
  const bg = at(surfaceSteps.bg);
  const surface = at(surfaceSteps.surface);
  const surfaceMuted = at(surfaceSteps.muted);
  const surfaces = [bg.hex, surface.hex, surfaceMuted.hex];
  const textSteps: RampStep[] = light ? [600, 700, 800, 900, 950] : [400, 300, 200, 100, 50];
  const subtleTextSteps: RampStep[] = light ? [700, 800, 900, 950] : [200, 100, 50];

  out.set('color.bg', color(bg.value, 'Page background.'));
  out.set('color.surface', color(surface.value, 'Cards, dialogs, popovers, inputs.'));
  out.set('color.surface-muted', color(surfaceMuted.value, 'Subdued fills: table headers, hover rows, code blocks.'));
  out.set('color.fg', color((light ? ref('neutral', 900) : ref('neutral', 50)).value, 'Default text and icons.'));
  out.set(
    'color.fg-muted',
    color(pick('neutral', light ? [500, 600, 700, 800] : [400, 300, 200, 100], surfaces, 4.5).value, 'Secondary text, placeholders, captions.'),
  );
  out.set('color.border', color((light ? ref('neutral', 200) : ref('neutral', 700)).value, 'Decorative dividers and card outlines.'));
  out.set(
    'color.border-strong',
    color(
      pick('neutral', light ? [400, 500, 600, 700] : [600, 500, 400, 300], [bg.hex, surface.hex], 3).value,
      'Input and control outlines (3:1 against surfaces).',
    ),
  );
  out.set(
    'color.ring',
    color(pick('primary', light ? [500, 600, 700, 800] : [400, 300, 200], [bg.hex, surface.hex], 3).value, 'Focus ring.'),
  );

  const solidRole = (role: string, name: PaletteName, solid: { value: TokenValue; hex: string }, l: number, c: number, h: number, label: string) => {
    const on = onColor(solid.hex);
    // Hover moves away from the text color, so contrast only ever improves.
    const onIsLight = wcag(on.hex, '#000000') > wcag(on.hex, '#ffffff');
    const hover = oklch(Math.min(0.98, Math.max(0.1, l + (onIsLight ? -0.06 : 0.06))), c, h);
    const subtle = light ? ref(name, 100) : ref(name, 900);
    out.set(`color.${role}`, color(solid.value, `${label} fill: buttons, active states.`));
    out.set(`color.${role}-hover`, color(hover, `Hover/pressed state of ${role}.`));
    out.set(`color.on-${role}`, color(on.value, `Text and icons on ${role}.`));
    out.set(`color.${role}-subtle`, color(subtle.value, `Tinted background: badges, alerts, selected rows.`));
    out.set(`color.on-${role}-subtle`, color(pick(name, subtleTextSteps, [subtle.hex], 4.5).value, `Text on ${role}-subtle.`));
    out.set(`color.${role}-text`, color(pick(name, textSteps, surfaces, 4.5).value, `${label}-colored text and links on any surface.`));
  };

  for (const role of ['primary', 'accent'] as const) {
    const exact = brand[role];
    const [l, c, h] = exact.components;
    // In dark mode the exact brand color is kept only when it is light enough to stand out as a fill.
    const useExact = light || l >= 0.55;
    if (useExact) {
      solidRole(role, role, { value: alias(`palette.brand.${role}`), hex: exact.hex }, l, c, h, role === 'primary' ? 'Brand' : 'Accent');
    } else {
      const step = palettes[role][400];
      solidRole(role, role, ref(role, 400), step.components[0], step.components[1], step.components[2], role === 'primary' ? 'Brand' : 'Accent');
    }
  }
  for (const name of Object.keys(STATUS_SOLID) as (keyof typeof STATUS_SOLID)[]) {
    const step = STATUS_SOLID[name][mode];
    const [l, c, h] = palettes[name][step].components;
    solidRole(name, name, ref(name, step), l, c, h, name[0]!.toUpperCase() + name.slice(1));
  }
  return out;
}

function parseOverride(token: Token, raw: string, path: string, layers: Flat[]): TokenValue {
  const value = raw.trim();
  const target = /^\{[^{}]+\}$/.test(value) ? resolveToken(aliasPath(value), layers) : undefined;
  if (target) {
    if (target.$type !== token.$type) {
      throw new Error(`Override for "${path}" points at ${value}, which is a ${target.$type} token, not ${token.$type}.`);
    }
    return value;
  }
  switch (token.$type) {
    case 'color':
      return parseColor(value);
    case 'dimension': {
      if (value === '0') return { value: 0, unit: 'px' };
      const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value);
      if (!m) throw new Error(`Override for "${path}" must be a length in px, rem or em (got "${raw}").`);
      return { value: Number(m[1]), unit: m[2] as 'px' | 'rem' | 'em' };
    }
    case 'duration': {
      const m = /^(\d*\.?\d+)ms$/.exec(value);
      if (!m) throw new Error(`Override for "${path}" must be a duration in ms (got "${raw}").`);
      return { value: Number(m[1]), unit: 'ms' };
    }
    case 'number':
    case 'fontWeight': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`Override for "${path}" must be a number (got "${raw}").`);
      return n;
    }
    case 'fontFamily':
      return value
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    default:
      throw new Error(`"${path}" is a ${token.$type} token; overriding it with a literal is not supported. Point it at another token with "{path}" instead.`);
  }
}

/** Override keys are token paths, optionally prefixed with `light:` or `dark:` for semantic colors. */
function applyOverrides(layers: Layers, overrides: Record<string, string>): void {
  for (const [key, raw] of Object.entries(overrides)) {
    const m = /^(?:(light|dark):)?(.+)$/.exec(key)!;
    const mode = m[1] as Mode | undefined;
    const path = m[2]!;
    const targets: [Flat, Flat[]][] = [];
    if (layers.base.has(path)) {
      if (mode) throw new Error(`"${path}" is not mode-specific; drop the "${mode}:" prefix.`);
      targets.push([layers.base, [layers.base]]);
    } else {
      if (mode !== 'dark' && layers.light.has(path)) targets.push([layers.light, [layers.base, layers.light]]);
      if (mode !== 'light' && layers.dark?.has(path)) targets.push([layers.dark, [layers.base, layers.dark]]);
    }
    if (targets.length === 0) {
      throw new Error(`Cannot override "${key}": no such token. Use kaava_get_tokens to list valid paths.`);
    }
    for (const [layer, scope] of targets) {
      const token = layer.get(path)!;
      layer.set(path, { ...token, $value: parseOverride(token, raw, path, scope) });
    }
  }
}

export function resolveLayers(brief: Brief, overrides: Record<string, string> = {}): Layers {
  const b = resolveBrief(brief);
  const { style } = b;
  const curves = { lightness: style.color.lightness, chroma: style.color.chroma };
  // Brand colors are always opaque; any alpha in the input is dropped.
  const primary = fromHex(parseColor(b.brandColor).hex);
  const [pl, pc, ph] = primary.components;
  const accent = b.accent
    ? fromHex(parseColor(b.accent).hex)
    : oklch(Math.min(0.7, Math.max(0.5, pl)), pc, (ph + style.color.accentShift + 360) % 360);

  const status = style.color.status;
  const palettes: Record<PaletteName, Ramp> = {
    neutral: ramp(ph, Math.min(pc, 0.03 * style.color.neutralTint), curves),
    primary: ramp(ph, pc, curves),
    accent: ramp(accent.components[2], accent.components[1], curves),
    success: ramp(status.success.hue, status.success.chroma, curves),
    warning: ramp(status.warning.hue, status.warning.chroma, curves),
    danger: ramp(status.danger.hue, status.danger.chroma, curves),
    info: ramp(status.info.hue, status.info.chroma, curves),
  };

  const base: Flat = new Map();
  base.set('palette.white', color(parseColor('#ffffff')));
  base.set('palette.black', color(parseColor('#000000')));
  base.set('palette.brand.primary', color(primary, 'The exact brand color from the brief.'));
  base.set('palette.brand.accent', color(accent, 'The exact accent color.'));
  for (const [name, r] of Object.entries(palettes)) {
    for (const [step, value] of Object.entries(r)) base.set(`palette.${name}.${step}`, color(value));
  }
  typeTokens(base, style.type);
  spaceTokens(base, style.space.densities[b.density]);
  shapeTokens(base, style.shape);
  shadowTokens(base, style.elevation, palettes.neutral[950]);
  motionTokens(base, style.motion);

  const brand = { primary, accent };
  const layers: Layers = {
    base,
    light: semanticColors('light', palettes, brand, style.color.surfaces.light),
    ...(b.darkMode ? { dark: semanticColors('dark', palettes, brand, style.color.surfaces.dark) } : {}),
  };
  applyOverrides(layers, overrides);
  return layers;
}

export function buildSystem(brief: Brief, overrides: Record<string, string> = {}, emit?: KaavaSystem['emit']): KaavaSystem {
  const layers = resolveLayers(brief, overrides);
  // JSON round-trip drops undefined fields so the in-memory system equals what is read back from disk.
  return JSON.parse(
    JSON.stringify({
      kaava: SYSTEM_VERSION,
      name: resolveBrief(brief).name,
      brief,
      ...(Object.keys(overrides).length ? { overrides } : {}),
      ...(emit ? { emit } : {}),
      tokens: toTree(layers.base),
      modes: { light: toTree(layers.light), ...(layers.dark ? { dark: toTree(layers.dark) } : {}) },
    }),
  ) as KaavaSystem;
}

export function layersOf(system: KaavaSystem): Layers {
  return {
    base: flatten(system.tokens),
    light: flatten(system.modes.light),
    ...(system.modes.dark ? { dark: flatten(system.modes.dark) } : {}),
  };
}
