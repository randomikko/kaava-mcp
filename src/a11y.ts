import { converter, differenceEuclidean, filterDeficiencyDeuter, filterDeficiencyProt, filterDeficiencyTrit, formatHex } from 'culori';
import { cssVar } from './emit/names.js';
import { apca, oklch, parseColor, wcag } from './engine/color.js';
import type { Layers } from './engine/resolve.js';
import { resolveToken, type ColorValue, type Dimension, type Flat } from './tokens.js';

/** Accessibility checks beyond the promised contrast pairs (see audit.ts), and ad-hoc contrast checking. */

export type Mode = 'light' | 'dark';

export interface Finding {
  check: 'fill-boundary' | 'color-vision' | 'target-size' | 'text-size';
  /** `fail` breaks WCAG 2.2 AA, `warn` needs care when the tokens are used, `info` is context. */
  level: 'fail' | 'warn' | 'info';
  /** The WCAG 2.2 success criterion the check relates to. */
  criterion: string;
  mode?: Mode;
  message: string;
}

const toRgb = converter('rgb');
const distance = differenceEuclidean('oklab');

const SOLID_ROLES = ['primary', 'accent', 'success', 'warning', 'danger', 'info'];
const STATUS_ROLES = ['success', 'warning', 'danger', 'info'];
const TEXT_ROLES = ['fg', 'fg-muted', ...SOLID_ROLES.map((r) => `${r}-text`)];

const VISION: [name: string, simulate: (hex: string) => string][] = [
  ['full color vision', (hex) => hex],
  ['protanopia', (hex) => formatHex(filterDeficiencyProt(1)(toRgb(hex)!))],
  ['deuteranopia', (hex) => formatHex(filterDeficiencyDeuter(1)(toRgb(hex)!))],
  ['tritanopia', (hex) => formatHex(filterDeficiencyTrit(1)(toRgb(hex)!))],
];
/** OKLab distance under which two status fills are hard to tell apart at a glance. */
const ALIKE = 0.06;

const modesOf = (layers: Layers): [Mode, Flat][] => [['light', layers.light], ...(layers.dark ? ([['dark', layers.dark]] as [Mode, Flat][]) : [])];

const roleHex = (layers: Layers, layer: Flat, role: string): string | undefined =>
  layer.has(`color.${role}`) ? (resolveToken(`color.${role}`, [layers.base, layer]).$value as ColorValue).hex : undefined;

const px = (layers: Layers, path: string): number => {
  const d = resolveToken(path, [layers.base]).$value as Dimension;
  return Number((d.unit === 'rem' ? d.value * 16 : d.value).toFixed(1));
};

const list = (items: string[]): string => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : (items[0] ?? ''));

export function auditAccessibility(layers: Layers): Finding[] {
  const findings: Finding[] = [];

  for (const [mode, layer] of modesOf(layers)) {
    // A filled control with no outline is identified by its fill alone, which then needs 3:1 against the page.
    const backgrounds = ['bg', 'surface'].map((r) => roleHex(layers, layer, r)).filter((h): h is string => !!h);
    const faint: string[] = [];
    for (const role of SOLID_ROLES) {
      const hex = roleHex(layers, layer, role);
      if (!hex || backgrounds.length === 0) continue;
      const ratio = Math.min(...backgrounds.map((bg) => wcag(hex, bg)));
      if (ratio < 3) faint.push(`${role} (${hex}, ${ratio.toFixed(2)}:1)`);
    }
    if (faint.length) {
      findings.push({
        check: 'fill-boundary',
        level: 'warn',
        criterion: 'WCAG 1.4.11 Non-text Contrast',
        mode,
        message: `Fills below 3:1 against bg/surface: ${list(faint)}. A button or badge filled with ${faint.length > 1 ? 'one of these' : 'it'} needs a border-strong outline to have a visible boundary; the text on it is still readable.`,
      });
    }

    const alike: string[] = [];
    for (const [vision, simulate] of VISION) {
      for (let i = 0; i < STATUS_ROLES.length; i++) {
        for (let j = i + 1; j < STATUS_ROLES.length; j++) {
          const a = roleHex(layers, layer, STATUS_ROLES[i]!);
          const b = roleHex(layers, layer, STATUS_ROLES[j]!);
          if (a && b && distance(simulate(a), simulate(b)) < ALIKE) alike.push(`${STATUS_ROLES[i]} and ${STATUS_ROLES[j]} with ${vision}`);
        }
      }
    }
    if (alike.length) {
      findings.push({
        check: 'color-vision',
        level: 'warn',
        criterion: 'WCAG 1.4.1 Use of Color',
        mode,
        message: `Status fills that look alike: ${alike.join('; ')}. Never signal status by color alone: pair it with an icon or a text label.`,
      });
    }
  }

  const controls = [...layers.base.keys()].filter((p) => p.startsWith('size.control.')).map((p) => ({ path: p, name: p.split('.')[2]!, px: px(layers, p) }));
  for (const c of controls.filter((c) => c.px < 24)) {
    findings.push({
      check: 'target-size',
      level: 'fail',
      criterion: 'WCAG 2.5.8 Target Size (Minimum)',
      message: `${c.path} is ${c.px}px; interactive targets must be at least 24px.`,
    });
  }
  if (controls.length) {
    const touch = controls.filter((c) => c.px >= 44).map((c) => c.name);
    findings.push({
      check: 'target-size',
      level: 'info',
      criterion: 'WCAG 2.5.8 Target Size (Minimum)',
      message: `Control heights: ${controls.map((c) => `${c.name} ${c.px}px`).join(', ')}. ${touch.length ? `Use ${list(touch)} for touch-first UI (44px or more).` : 'None reaches 44px; add padding around controls in touch-first UI.'}`,
    });
  }

  const small = [...layers.base.keys()].filter((p) => p.startsWith('font.size.')).map((p) => ({ path: p, px: px(layers, p) })).filter((s) => s.px < 11);
  if (small.length) {
    findings.push({
      check: 'text-size',
      level: 'warn',
      criterion: 'readability; WCAG sets no minimum size',
      message: `${list(small.map((s) => `${s.path} (${s.px}px)`))} ${small.length > 1 ? 'are' : 'is'} below 11px, smaller than most people can read comfortably. Keep ${small.length > 1 ? 'them' : 'it'} to short labels, never body copy.`,
    });
  }
  if (layers.base.has('font.lineHeight.base')) {
    const lineHeight = resolveToken('font.lineHeight.base', [layers.base]).$value as number;
    if (lineHeight < 1.5) {
      findings.push({
        check: 'text-size',
        level: 'warn',
        criterion: 'WCAG 1.4.8 Visual Presentation, AAA',
        message: `font.lineHeight.base is ${lineHeight}; body text reads best at 1.5 or more.`,
      });
    }
  }
  return findings;
}

export function accessibilitySummary(findings: Finding[]): string {
  const count = (level: Finding['level']): number => findings.filter((f) => f.level === level).length;
  const fails = count('fail');
  const warns = count('warn');
  if (!fails && !warns) return 'Accessibility: no other issues found (fill boundaries, color vision, target size, text size).';
  const parts = [...(fails ? [`${fails} failure${fails > 1 ? 's' : ''}`] : []), ...(warns ? [`${warns} warning${warns > 1 ? 's' : ''}`] : [])];
  return `Accessibility: ${parts.join(', ')} beyond contrast (fill boundaries, color vision, target size, text size).`;
}

export type ContrastUse = 'text' | 'large-text' | 'ui';
export type ContrastLevel = 'AA' | 'AAA';

/** WCAG 2.2 minimum ratio. Large text is 24px, or 18.66px bold, and up. UI covers icons, borders and focus rings. */
export function requiredRatio(use: ContrastUse, level: ContrastLevel): number {
  if (use === 'ui') return 3;
  if (use === 'large-text') return level === 'AAA' ? 4.5 : 3;
  return level === 'AAA' ? 7 : 4.5;
}

export interface ResolvedColor {
  hex: string;
  alpha: number;
  /** Token path when the input named a token. */
  token?: string;
}

/** Read a tool input as a token (path, CSS variable or bare role name) of the given theme, else as a CSS color. */
export function resolveColorInput(input: string, layers: Layers | undefined, mode: Mode): ResolvedColor {
  const raw = input.trim();
  if (layers) {
    const layer = mode === 'dark' && layers.dark ? layers.dark : layers.light;
    const name = raw.replace(/^var\(\s*|\s*\)$/g, '').replace(/^\{|\}$/g, '');
    const paths = [...layers.base.keys(), ...layer.keys()];
    const path = paths.find((p) => p === name) ?? paths.find((p) => cssVar(p) === name) ?? paths.find((p) => p === `color.${name}`);
    if (path) {
      const token = resolveToken(path, [layers.base, layer]);
      if (token.$type !== 'color') throw new Error(`"${path}" is a ${token.$type} token, not a color.`);
      const value = token.$value as ColorValue;
      return { hex: value.hex, alpha: value.alpha ?? 1, token: path };
    }
  }
  try {
    const value = parseColor(raw);
    return { hex: value.hex, alpha: value.alpha ?? 1 };
  } catch {
    throw new Error(
      `Cannot read "${input}" as a color${layers ? ' or a token of this design system' : ''}. Use a CSS color ("#4f46e5", "rgb(79 70 229)")${layers ? ', a token path ("color.fg-muted") or a CSS variable ("--color-fg-muted")' : '; token names need a kaava.json in the project'}.`,
    );
  }
}

/** What a translucent color looks like on an opaque background. */
export function composite(fg: ResolvedColor, bgHex: string): string {
  if (fg.alpha >= 1) return fg.hex;
  const f = toRgb(fg.hex)!;
  const b = toRgb(bgHex)!;
  const mix = (x: number, y: number): number => x * fg.alpha + y * (1 - fg.alpha);
  return formatHex({ mode: 'rgb', r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b) });
}

/** The closest color to `fgHex` with the same hue and chroma that reaches `min` against `bgHex`. */
export function nearestPassing(fgHex: string, bgHex: string, min: number): string | undefined {
  const [l, c, h] = parseColor(fgHex).components;
  for (let delta = 0.005; delta <= 1; delta += 0.005) {
    for (const candidate of [l - delta, l + delta]) {
      if (candidate < 0 || candidate > 1) continue;
      const hex = oklch(candidate, c, h).hex;
      if (wcag(hex, bgHex) >= min) return hex;
    }
  }
  return undefined;
}

export interface ContrastCheck {
  fgHex: string;
  bgHex: string;
  ratio: number;
  apca: number;
  required: number;
  pass: boolean;
  /** Which WCAG 2.2 thresholds the pair meets. */
  meets: { aaText: boolean; aaLargeText: boolean; aaaText: boolean; aaaLargeText: boolean; ui: boolean };
  /** Present when the pair fails: the nearest foreground of the same hue that passes, if any exists. */
  suggestion?: string;
}

export function checkContrast(fg: ResolvedColor, bg: ResolvedColor, use: ContrastUse = 'text', level: ContrastLevel = 'AA'): ContrastCheck {
  const bgHex = bg.hex;
  const fgHex = composite(fg, bgHex);
  const ratio = wcag(fgHex, bgHex);
  const required = requiredRatio(use, level);
  const pass = ratio >= required;
  const suggestion = pass ? undefined : nearestPassing(fgHex, bgHex, required);
  return {
    fgHex,
    bgHex,
    // Round down so a ratio just under a threshold is never displayed as meeting it.
    ratio: Math.floor(ratio * 100) / 100,
    apca: Number(apca(fgHex, bgHex).toFixed(1)),
    required,
    pass,
    meets: { aaText: ratio >= 4.5, aaLargeText: ratio >= 3, aaaText: ratio >= 7, aaaLargeText: ratio >= 4.5, ui: ratio >= 3 },
    ...(suggestion ? { suggestion } : {}),
  };
}

/** Text color tokens of the system that reach `min` on a background, best contrast first. */
export function passingTextRoles(layers: Layers, mode: Mode, bgHex: string, min: number): { token: string; hex: string; ratio: number }[] {
  const layer = mode === 'dark' && layers.dark ? layers.dark : layers.light;
  return TEXT_ROLES.flatMap((role) => {
    const hex = roleHex(layers, layer, role);
    const ratio = hex ? wcag(hex, bgHex) : 0;
    return hex && ratio >= min ? [{ token: `color.${role}`, hex, ratio: Math.floor(ratio * 100) / 100 }] : [];
  }).sort((a, b) => b.ratio - a.ratio);
}
