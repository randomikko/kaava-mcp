import { z } from 'zod';
import { STYLE_FILES, STYLE_IDS } from '../styles/index.js';

/**
 * A style holds every decision that gives a design system its character, independent of brand color:
 * how ramps are shaped, the typography, spacing rhythm, corners, elevation and motion. Styles are authored
 * by people (see styles/*.json and the workbench); the engine only applies them.
 */

const STEPS = 11; // palette steps 50…950
const SIZES = 9; // type steps xs…5xl

const list = (length: number, item: z.ZodNumber) => z.array(item).length(length);
const surfaceStep = z.union([z.literal('white'), z.literal('black'), z.literal(50), z.literal(100), z.literal(200), z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800), z.literal(900), z.literal(950)]);
const surfaces = z.object({ bg: surfaceStep, surface: surfaceStep, muted: surfaceStep });
const hueChroma = z.object({ hue: z.number().min(0).max(360), chroma: z.number().min(0).max(0.4) });
const densitySpec = z.object({
  /** Heights of sm, md and lg controls, in px. */
  control: list(3, z.number().min(16).max(96)),
  /** The rest are steps of the spacing scale (1 step = 4px). */
  padX: z.number().int().min(0).max(24),
  gap: z.number().int().min(0).max(24),
  inset: z.number().int().min(0).max(24),
  section: z.number().int().min(0).max(24),
});
/** One shadow layer: offset y, blur, spread (px) and opacity. */
const shadowLayer = z.tuple([z.number(), z.number().min(0), z.number(), z.number().min(0).max(1)]);
const shadow = z.array(shadowLayer).min(1).max(4);
const bezier = list(4, z.number());
const radiusName = z.enum(['none', 'sm', 'md', 'lg', 'xl', 'full']);

export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
export const SHADOW_LEVELS = ['sm', 'md', 'lg'] as const;
export const TYPE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'] as const;
export const SPACE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24] as const;

export const styleSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and hyphens only').max(40),
  name: z.string().min(1).max(60),
  author: z.string().min(1).max(80),
  description: z.string().max(400),
  color: z.object({
    /** OKLCH lightness of palette steps 50…950, lightest first. */
    lightness: list(STEPS, z.number().min(0).max(1)).refine((l) => l.every((v, i) => i === 0 || v < l[i - 1]!), 'must get darker with every step'),
    /** Share of the peak chroma used at each step. */
    chroma: list(STEPS, z.number().min(0).max(1.2)),
    /** How much of the brand hue tints the greys: 0 = pure grey, 1 = clearly tinted. */
    neutralTint: z.number().min(0).max(1),
    /** Degrees added to the brand hue when the brief gives no accent color. 0 = monochrome. */
    accentShift: z.number().min(-180).max(180),
    status: z.object({ success: hueChroma, warning: hueChroma, danger: hueChroma, info: hueChroma }),
    /** Which neutral step (or pure white/black) is the page, the raised surface and the muted fill. */
    surfaces: z.object({ light: surfaces, dark: surfaces }),
  }),
  type: z.object({
    /** A single name gets a system fallback stack appended; a comma-separated value is used as written. */
    families: z.object({ sans: z.string().optional(), display: z.string().optional(), mono: z.string().optional() }),
    /** Stylesheet URLs that provide the families above, e.g. a Google Fonts link. */
    webfonts: z.array(z.string().url().startsWith('https://')).max(4),
    /** Sizes xs…5xl: a modular ratio around 1rem, or nine hand-set sizes in rem. */
    scale: z.union([z.object({ ratio: z.number().min(1.067).max(1.5) }), z.object({ sizes: list(SIZES, z.number().min(0.5).max(8)) })]),
    lineHeights: list(SIZES, z.number().min(0.9).max(2.2)),
    /** Letter-spacing per size, in em. */
    tracking: list(SIZES, z.number().min(-0.1).max(0.3)),
    weights: z.object({ regular: z.number(), medium: z.number(), semibold: z.number(), bold: z.number() }),
    headingWeight: z.enum(['regular', 'medium', 'semibold', 'bold']),
  }),
  space: z.object({
    density: z.enum(DENSITIES),
    densities: z.object({ compact: densitySpec, comfortable: densitySpec, spacious: densitySpec }),
  }),
  shape: z.object({
    /** Radius scale in px. `none` (0) and `full` (pill) always exist as well. */
    radius: z.object({ sm: z.number().min(0).max(64), md: z.number().min(0).max(64), lg: z.number().min(0).max(64), xl: z.number().min(0).max(64) }),
    /** Which radius buttons, inputs and badges use. */
    control: radiusName,
    /** Which radius cards, dialogs and popovers use. */
    surface: radiusName,
    /** Width of borders and outlines, in px. */
    borderWidth: z.number().min(0).max(4),
  }),
  elevation: z.object({ sm: shadow, md: shadow, lg: shadow }),
  motion: z.object({
    durations: z.object({ fast: z.number().min(0).max(2000), base: z.number().min(0).max(2000), slow: z.number().min(0).max(2000) }),
    easings: z.object({ standard: bezier, in: bezier, out: bezier }),
  }),
});

export type Style = z.infer<typeof styleSchema>;
export type DensitySpec = z.infer<typeof densitySpec>;
export type SurfaceStep = z.infer<typeof surfaceStep>;
export type StyleId = (typeof STYLE_IDS)[number];
export { STYLE_IDS };

export function parseStyle(input: unknown): Style {
  const parsed = styleSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const id = typeof input === 'object' && input !== null && 'id' in input ? ` "${String((input as { id: unknown }).id)}"` : '';
  throw new Error(`Invalid style${id}: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
}

const registry = new Map<string, Style>(STYLE_FILES.map((file) => [parseStyle(file).id, parseStyle(file)]));

export const DEFAULT_STYLE_ID = 'default';

/** Built-in styles by id, `default` first. */
export const styles = (): Style[] => [...registry.values()];

export function getStyle(id: string = DEFAULT_STYLE_ID): Style {
  const style = registry.get(id);
  if (!style) throw new Error(`Unknown style "${id}". Available: ${[...registry.keys()].filter((k) => k !== DEFAULT_STYLE_ID).join(', ')}.`);
  return style;
}

/** Add or replace a style at runtime. The workbench uses this to preview a style that is still being edited. */
export function registerStyle(input: unknown): Style {
  const style = parseStyle(input);
  registry.set(style.id, style);
  return style;
}
