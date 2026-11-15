import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { auditAccessibility, checkContrast, nearestPassing } from '../src/a11y.js';
import { auditContrast } from '../src/audit.js';
import { apca, parseColor, ramp, RAMP_STEPS, wcag } from '../src/engine/color.js';
import { buildSystem, layersOf, resolveLayers } from '../src/engine/resolve.js';
import { getStyle, parseStyle, styles, STYLE_IDS } from '../src/style.js';
import { cssValue, resolveToken, type ColorValue } from '../src/tokens.js';
import { VERSION } from '../src/version.js';

const BRANDS = [
  '#4f46e5',
  '#000000',
  '#ffffff',
  '#ffe600',
  '#ff0000',
  '#00ff88',
  '#808080',
  '#f5f5dc',
  '#1e3a8a',
  '#ff69b4',
  'rebeccapurple',
  'rgb(12 160 120)',
];
for (let h = 0; h < 360; h += 20) {
  for (const l of [0.15, 0.4, 0.6, 0.8, 0.96]) BRANDS.push(`oklch(${l} 0.2 ${h})`);
}

describe('color engine', () => {
  it('parses any CSS color and rejects junk', () => {
    expect(parseColor('#4F46E5').hex).toBe('#4f46e5');
    expect(parseColor('rebeccapurple').hex).toBe('#663399');
    expect(() => parseColor('not-a-color')).toThrow(/Cannot parse color/);
  });

  it('builds ramps that get strictly darker and stay in sRGB', () => {
    for (const hue of [0, 75, 150, 245, 300]) {
      const r = ramp(hue, 0.3, getStyle().color);
      const lightness = RAMP_STEPS.map((s) => r[s].components[0]);
      for (let i = 1; i < lightness.length; i++) expect(lightness[i]!).toBeLessThan(lightness[i - 1]!);
      for (const s of RAMP_STEPS) expect(r[s].hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('computes WCAG and APCA contrast', () => {
    expect(wcag('#000000', '#ffffff')).toBeCloseTo(21, 1);
    // Reference values from the APCA-W3 0.1.9 test vectors.
    expect(apca('#000000', '#ffffff')).toBeCloseTo(106.04, 1);
    expect(apca('#ffffff', '#000000')).toBeCloseTo(-107.88, 1);
    expect(apca('#888888', '#ffffff')).toBeCloseTo(63.06, 1);
  });
});

describe('system resolution', () => {
  it('is deterministic', () => {
    const brief = { brandColor: '#4f46e5', style: 'friendly' as const, name: 'Demo' };
    expect(JSON.stringify(buildSystem(brief))).toBe(JSON.stringify(buildSystem(brief)));
  });

  it('round-trips through kaava.json unchanged', () => {
    const system = buildSystem({ brandColor: '#0ea5e9' });
    const reread = JSON.parse(JSON.stringify(system));
    expect(layersOf(reread)).toEqual(resolveLayers({ brandColor: '#0ea5e9' }));
  });

  it(`passes WCAG AA for every promised pair across ${BRANDS.length} brand colors and all ${styles().length} styles`, () => {
    const failures: string[] = [];
    for (const brandColor of BRANDS) {
      for (const style of [undefined, ...STYLE_IDS]) {
        for (const r of auditContrast(resolveLayers({ brandColor, style }))) {
          if (!r.pass) failures.push(`${brandColor} ${style ?? 'default'} [${r.mode}] ${r.fg} on ${r.bg}: ${r.ratio}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('uses the exact brand color as the light-mode primary', () => {
    const layers = resolveLayers({ brandColor: '#e11d48' });
    const primary = resolveToken('color.primary', [layers.base, layers.light]).$value as ColorValue;
    expect(primary.hex).toBe('#e11d48');
  });

  it('lets explicit brief fields win over the style', () => {
    const layers = resolveLayers({ brandColor: '#333', style: 'playful', radius: 'none' });
    expect(cssValue(resolveToken('radius.control', [layers.base]), (p) => p)).toBe('0');
  });

  it('omits dark mode when asked', () => {
    expect(resolveLayers({ brandColor: '#333', darkMode: false }).dark).toBeUndefined();
  });

  it('resolves every alias', () => {
    const layers = resolveLayers({ brandColor: '#4f46e5' });
    for (const [layer, scope] of [
      [layers.base, [layers.base]],
      [layers.light, [layers.base, layers.light]],
      [layers.dark!, [layers.base, layers.dark!]],
    ] as const) {
      for (const path of layer.keys()) expect(() => resolveToken(path, [...scope])).not.toThrow();
    }
  });
});

describe('overrides', () => {
  const brief = { brandColor: '#4f46e5' };

  it('applies literals and aliases, per mode when prefixed', () => {
    const layers = resolveLayers(brief, {
      'radius.control': '{radius.full}',
      'font.size.base': '1.0625rem',
      'dark:color.primary': '#8b9cff',
    });
    const css = (path: string, scope = [layers.base]) => {
      const value = (p: string): string => cssValue(resolveToken(p, scope), value);
      return value(path);
    };
    expect(css('radius.control')).toBe('9999px');
    expect(css('font.size.base')).toBe('1.0625rem');
    expect(css('color.primary', [layers.base, layers.dark!])).toBe('#8b9cff');
    expect(css('color.primary', [layers.base, layers.light])).toBe('#4f46e5');
  });

  it('rejects unknown paths, wrong types and bad values', () => {
    expect(() => resolveLayers(brief, { 'color.nope': '#fff' })).toThrow(/no such token/);
    expect(() => resolveLayers(brief, { 'radius.control': '{palette.white}' })).toThrow(/color token, not dimension/);
    expect(() => resolveLayers(brief, { 'font.size.base': 'big' })).toThrow(/px, rem or em/);
    expect(() => resolveLayers(brief, { 'light:radius.md': '4px' })).toThrow(/not mode-specific/);
  });

  it('surfaces contrast failures caused by an override', () => {
    const layers = resolveLayers(brief, { 'color.fg': '#cccccc' });
    const failing = auditContrast(layers).filter((r) => !r.pass);
    expect(failing.some((r) => r.mode === 'light' && r.fg === 'fg')).toBe(true);
  });
});

describe('accessibility checks', () => {
  it('suggests a passing color that keeps the hue', () => {
    const literal = (hex: string) => ({ hex, alpha: 1 });
    const result = checkContrast(literal('#8b9cff'), literal('#ffffff'));
    expect(result.pass).toBe(false);
    expect(wcag(result.suggestion!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(parseColor(result.suggestion!).components[2] - parseColor('#8b9cff').components[2])).toBeLessThan(6);
    // Nothing reaches 7:1 on mid grey, in either direction.
    expect(nearestPassing('#000000', '#777777', 7)).toBeUndefined();
  });

  it('never rounds a ratio up to a threshold', () => {
    const result = checkContrast({ hex: '#777777', alpha: 1 }, { hex: '#ffffff', alpha: 1 });
    expect(result.ratio).toBeLessThan(4.5);
    expect(result.meets).toMatchObject({ aaText: false, aaLargeText: true, ui: true, aaaText: false });
  });

  it('flattens translucent foregrounds onto the background', () => {
    expect(checkContrast({ hex: '#000000', alpha: 0.5 }, { hex: '#ffffff', alpha: 1 }).fgHex).toBe('#808080');
  });

  it('flags look-alike status colors, faint fills and undersized targets', () => {
    const findings = auditAccessibility(resolveLayers({ brandColor: '#ffd400' }, { 'size.control.sm': '1rem', 'color.danger': '{color.success}' }));
    const of = (check: string, level: string) => findings.filter((f) => f.check === check && f.level === level);
    expect(of('target-size', 'fail')[0]!.message).toContain('size.control.sm is 16px');
    expect(of('color-vision', 'warn').some((f) => f.message.includes('success and danger with full color vision'))).toBe(true);
    expect(of('fill-boundary', 'warn').some((f) => f.mode === 'light' && f.message.includes('primary (#ffd400'))).toBe(true);
    expect(of('fill-boundary', 'warn').some((f) => f.mode === 'dark' && f.message.includes('primary'))).toBe(false);
  });
});

it('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(VERSION).toBe(pkg.version);
});
