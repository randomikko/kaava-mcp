import { DEFAULT_PRESET, PRESETS, type Preset } from '../presets.js';
import { SYSTEM_VERSION, type Brief, type EmitTarget } from '../schema.js';
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
import { motionTokens, radiusTokens, shadowTokens, spaceTokens, typeTokens } from './scales.js';

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

export type ResolvedBrief = Required<Omit<Brief, 'accent' | 'mood' | 'description' | 'fonts'>> &
  Pick<Brief, 'accent' | 'mood' | 'description'> & {
    fonts: { sans?: string; mono?: string; display?: string };
    accentShift: number;
  };

export function resolveBrief(brief: Brief): ResolvedBrief {
  const preset: Preset = brief.mood ? PRESETS[brief.mood] : DEFAULT_PRESET;
  return {
    name: brief.name ?? 'Design system',
    description: brief.description,
    brandColor: brief.brandColor,
    accent: brief.accent,
    mood: brief.mood,
    neutralTint: brief.neutralTint ?? preset.neutralTint,
    density: brief.density ?? preset.density,
    radius: brief.radius ?? preset.radius,
    typeScale: brief.typeScale ?? preset.typeScale,
    fonts: { ...preset.fonts, ...brief.fonts },
    shadows: brief.shadows ?? preset.shadows,
    darkMode: brief.darkMode ?? true,
    accentShift: preset.accentShift,
  };
}

const STATUS = {
  success: { hue: 150, chroma: 0.16, solid: { light: 600, dark: 400 } },
  warning: { hue: 75, chroma: 0.16, solid: { light: 400, dark: 400 } },
  danger: { hue: 25, chroma: 0.19, solid: { light: 600, dark: 400 } },
  info: { hue: 245, chroma: 0.15, solid: { light: 600, dark: 400 } },
} as const satisfies Record<string, { hue: number; chroma: number; solid: Record<Mode, RampStep> }>;

type Mode = 'light' | 'dark';
type PaletteName = 'neutral' | 'primary' | 'accent' | keyof typeof STATUS;

const color = ($value: TokenValue, $description?: string): Token => ({
  $type: 'color',
  $value,
  ...($description ? { $description } : {}),
});

function semanticColors(mode: Mode, palettes: Record<PaletteName, Ramp>, brand: Record<'primary' | 'accent', ColorValue>): Flat {
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

  const bg = light ? ref('neutral', 50) : ref('neutral', 950);
  const surface = light ? WHITE : ref('neutral', 900);
  const surfaceMuted = light ? ref('neutral', 100) : ref('neutral', 800);
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
  for (const [name, spec] of Object.entries(STATUS) as [keyof typeof STATUS, (typeof STATUS)[keyof typeof STATUS]][]) {
    const step = spec.solid[mode];
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
      const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(value);
      if (!m) throw new Error(`Override for "${path}" must be a length in px or rem (got "${raw}").`);
      return { value: Number(m[1]), unit: m[2] as 'px' | 'rem' };
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
  // Brand colors are always opaque; any alpha in the input is dropped.
  const primary = fromHex(parseColor(b.brandColor).hex);
  const [pl, pc, ph] = primary.components;
  const accent = b.accent
    ? fromHex(parseColor(b.accent).hex)
    : oklch(Math.min(0.7, Math.max(0.5, pl)), pc, (ph + b.accentShift + 360) % 360);

  const palettes: Record<PaletteName, Ramp> = {
    neutral: ramp(ph, Math.min(pc, 0.03 * b.neutralTint)),
    primary: ramp(ph, pc),
    accent: ramp(accent.components[2], accent.components[1]),
    success: ramp(STATUS.success.hue, STATUS.success.chroma),
    warning: ramp(STATUS.warning.hue, STATUS.warning.chroma),
    danger: ramp(STATUS.danger.hue, STATUS.danger.chroma),
    info: ramp(STATUS.info.hue, STATUS.info.chroma),
  };

  const base: Flat = new Map();
  base.set('palette.white', color(parseColor('#ffffff')));
  base.set('palette.black', color(parseColor('#000000')));
  base.set('palette.brand.primary', color(primary, 'The exact brand color from the brief.'));
  base.set('palette.brand.accent', color(accent, 'The exact accent color.'));
  for (const [name, r] of Object.entries(palettes)) {
    for (const [step, value] of Object.entries(r)) base.set(`palette.${name}.${step}`, color(value));
  }
  typeTokens(base, { ratio: b.typeScale, fonts: b.fonts });
  spaceTokens(base, b.density);
  radiusTokens(base, b.radius);
  shadowTokens(base, b.shadows, palettes.neutral[950]);
  motionTokens(base);

  const brand = { primary, accent };
  const layers: Layers = {
    base,
    light: semanticColors('light', palettes, brand),
    ...(b.darkMode ? { dark: semanticColors('dark', palettes, brand) } : {}),
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
