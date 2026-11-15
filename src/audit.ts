import { apca, wcag } from './engine/color.js';
import type { Layers } from './engine/resolve.js';
import { resolveToken, type ColorValue, type Flat } from './tokens.js';

export interface ContrastResult {
  mode: 'light' | 'dark';
  fg: string;
  bg: string;
  fgHex: string;
  bgHex: string;
  ratio: number;
  apca: number;
  min: number;
  pass: boolean;
}

export const SURFACES = ['bg', 'surface', 'surface-muted'] as const;
export const SOLID_ROLES = ['primary', 'accent', 'success', 'warning', 'danger', 'info'] as const;

/** Every foreground/background pairing the system promises is usable, with its WCAG 2.2 minimum. */
export function contrastPairs(): [fg: string, bg: string, min: number][] {
  const out: [string, string, number][] = [];
  for (const s of SURFACES) {
    out.push(['fg', s, 4.5], ['fg-muted', s, 4.5]);
  }
  for (const s of ['bg', 'surface']) {
    out.push(['border-strong', s, 3], ['ring', s, 3]);
  }
  for (const role of SOLID_ROLES) {
    out.push([`on-${role}`, role, 4.5], [`on-${role}`, `${role}-hover`, 4.5], [`on-${role}-subtle`, `${role}-subtle`, 4.5]);
    for (const s of SURFACES) out.push([`${role}-text`, s, 4.5]);
  }
  return out;
}

export function auditContrast(layers: Layers): ContrastResult[] {
  const results: ContrastResult[] = [];
  const modes: ['light' | 'dark', Flat | undefined][] = [
    ['light', layers.light],
    ['dark', layers.dark],
  ];
  for (const [mode, layer] of modes) {
    if (!layer) continue;
    const scope = [layers.base, layer];
    const hex = (role: string): string | undefined =>
      layer.has(`color.${role}`) ? (resolveToken(`color.${role}`, scope).$value as ColorValue).hex : undefined;
    for (const [fg, bg, min] of contrastPairs()) {
      const fgHex = hex(fg);
      const bgHex = hex(bg);
      if (!fgHex || !bgHex) continue;
      const ratio = wcag(fgHex, bgHex);
      results.push({
        mode,
        fg,
        bg,
        fgHex,
        bgHex,
        ratio: Number(ratio.toFixed(2)),
        apca: Number(apca(fgHex, bgHex).toFixed(1)),
        min,
        // Compare the unrounded ratio so 4.496 is not reported as a pass.
        pass: ratio >= min,
      });
    }
  }
  return results;
}

export function contrastSummary(results: ContrastResult[]): string {
  const failures = results.filter((r) => !r.pass);
  if (failures.length === 0) return `Contrast: all ${results.length} checked pairs pass WCAG 2.2 AA.`;
  return [
    `Contrast: ${failures.length} of ${results.length} checked pairs FAIL WCAG 2.2 AA:`,
    ...failures.map((f) => `- [${f.mode}] ${f.fg} (${f.fgHex}) on ${f.bg} (${f.bgHex}): ${f.ratio}:1, needs ${f.min}:1`),
  ].join('\n');
}
