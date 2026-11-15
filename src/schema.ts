import { z } from 'zod';
import { DENSITIES, STYLE_IDS } from './style.js';

export { DENSITIES };
export const RADII = ['none', 'sm', 'md', 'lg', 'full'] as const;
export const SHADOWS = ['none', 'soft', 'crisp'] as const;

/** The brief: the small set of taste decisions an agent makes. Everything else is derived. */
export const briefShape = {
  name: z.string().min(1).max(80).optional().describe('Name of the design system or product.'),
  description: z.string().max(600).optional().describe('One or two sentences on what the product is and who it is for.'),
  brandColor: z
    .string()
    .describe('Primary brand color in any CSS syntax: "#4f46e5", "rgb(79 70 229)", "oklch(0.55 0.2 270)", "rebeccapurple".'),
  accent: z
    .string()
    .optional()
    .describe('Secondary accent color (CSS color). Omit to derive one from the brand hue according to the style.'),
  style: z
    .enum(STYLE_IDS)
    .optional()
    .describe('A hand-authored style that decides the character of the system: ramp shape, typography, spacing rhythm, corners, elevation, motion. The fields below override single aspects of it; leave them out to keep the style as designed.'),
  neutralTint: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('How much of the brand hue tints the greys. 0 = pure grey, 1 = clearly tinted.'),
  density: z.enum(DENSITIES).optional().describe('Control sizes and spacing rhythm. Default: the density the style was designed for.'),
  radius: z.enum(RADII).optional().describe('Replace the style\'s corner rounding with a generic scale. "full" gives pill-shaped controls.'),
  typeScale: z
    .number()
    .min(1.067)
    .max(1.5)
    .optional()
    .describe('Replace the style\'s type sizes with a modular scale of this ratio. 1.125 = tight/dense UI, 1.2 = balanced, 1.333 = expressive/editorial.'),
  fonts: z
    .object({
      sans: z.string().optional(),
      mono: z.string().optional(),
      display: z.string().optional(),
    })
    .optional()
    .describe('Font families. A single name ("Inter") gets a system fallback stack appended; a comma-separated value is used as the full stack. `display` is for headings and defaults to `sans`.'),
  shadows: z.enum(SHADOWS).optional().describe('Replace the style\'s shadows with a generic recipe, or "none" for a flat system.'),
  darkMode: z.boolean().optional().describe('Generate a dark theme. Default true.'),
};

export const briefSchema = z.object(briefShape);
export type Brief = z.infer<typeof briefSchema>;

export const EMIT_TARGETS = ['css', 'tailwind', 'scss', 'ts', 'dtcg', 'design-md', 'preview'] as const;
export type EmitTarget = (typeof EMIT_TARGETS)[number];

export const SYSTEM_VERSION = '0.1';

/** Shape of kaava.json. Token trees are validated structurally when flattened. */
export const systemFileSchema = z.object({
  kaava: z.string(),
  name: z.string(),
  brief: briefSchema,
  overrides: z.record(z.string(), z.string()).optional(),
  emit: z
    .object({
      outDir: z.string(),
      targets: z.array(z.enum(EMIT_TARGETS)),
    })
    .optional(),
  tokens: z.record(z.string(), z.unknown()),
  modes: z.object({
    light: z.record(z.string(), z.unknown()),
    dark: z.record(z.string(), z.unknown()).optional(),
  }),
});
