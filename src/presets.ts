/** Mood presets: defaults for every brief field the agent leaves out. */

export interface Preset {
  description: string;
  radius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  density: 'compact' | 'comfortable' | 'spacious';
  typeScale: number;
  neutralTint: number;
  shadows: 'none' | 'soft' | 'crisp';
  /** Degrees added to the brand hue when no accent color is given. 0 = monochrome. */
  accentShift: number;
  fonts?: { sans?: string; mono?: string; display?: string };
}

export const DEFAULT_PRESET: Preset = {
  description: 'Balanced defaults that suit most product UIs.',
  radius: 'md',
  density: 'comfortable',
  typeScale: 1.2,
  neutralTint: 0.25,
  shadows: 'soft',
  accentShift: 60,
};

export const PRESETS = {
  minimal: {
    description: 'Quiet and restrained: pure greys, small radii, no shadows, one color doing all the work.',
    radius: 'sm',
    density: 'comfortable',
    typeScale: 1.2,
    neutralTint: 0,
    shadows: 'none',
    accentShift: 0,
  },
  friendly: {
    description: 'Warm and approachable consumer feel: soft corners, tinted greys, gentle shadows.',
    radius: 'lg',
    density: 'comfortable',
    typeScale: 1.25,
    neutralTint: 0.5,
    shadows: 'soft',
    accentShift: 40,
  },
  corporate: {
    description: 'Trustworthy and conventional B2B: moderate radii, crisp elevation, analogous accent.',
    radius: 'md',
    density: 'comfortable',
    typeScale: 1.2,
    neutralTint: 0.3,
    shadows: 'crisp',
    accentShift: -30,
  },
  playful: {
    description: 'Energetic and bold: pill controls, roomy spacing, big type steps, contrasting accent.',
    radius: 'full',
    density: 'spacious',
    typeScale: 1.333,
    neutralTint: 0.6,
    shadows: 'soft',
    accentShift: 150,
  },
  editorial: {
    description: 'Content-first and typographic: square corners, serif headings, generous whitespace, flat surfaces.',
    radius: 'none',
    density: 'spacious',
    typeScale: 1.333,
    neutralTint: 0.15,
    shadows: 'none',
    accentShift: 0,
    fonts: { display: 'Georgia, "Times New Roman", ui-serif, serif' },
  },
  technical: {
    description: 'Dense tools and dashboards: compact controls, tight type scale, crisp edges.',
    radius: 'sm',
    density: 'compact',
    typeScale: 1.125,
    neutralTint: 0.4,
    shadows: 'crisp',
    accentShift: 60,
  },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as [PresetName, ...PresetName[]];
