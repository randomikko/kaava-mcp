import { lint } from '@google/design.md/linter';
import { describe, expect, it } from 'vitest';
import { contrastPairs } from '../src/audit.js';
import { renderTargets } from '../src/emit/index.js';
import { wcag } from '../src/engine/color.js';
import { buildSystem, layersOf } from '../src/engine/resolve.js';
import { EMIT_TARGETS } from '../src/schema.js';
import { styles, type StyleId } from '../src/style.js';
import { resolveToken, type ColorValue } from '../src/tokens.js';

const system = buildSystem({ name: 'Demo', brandColor: '#4f46e5', style: 'friendly', fonts: { sans: 'Inter' } });
const files = Object.fromEntries(renderTargets(system, EMIT_TARGETS).map((f) => [f.file, f.content]));

/** Every var(--x) used in a stylesheet must also be declared in it. */
function undeclaredVars(css: string): string[] {
  const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  return [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]!))].filter((v) => !declared.has(v));
}

const SHADCN_PAIRS: [fg: string, bg: string, min: number][] = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['sidebar-foreground', 'sidebar', 4.5],
  ['sidebar-primary-foreground', 'sidebar-primary', 4.5],
  ['sidebar-accent-foreground', 'sidebar-accent', 4.5],
  ['ring', 'background', 3],
  ['input', 'background', 3],
];

/** Pairs in shadcn.css that fall short of their WCAG ratio, as `mode: fg on bg (ratio)`. Empty when all pass. */
function shadcnContrastFailures(css: string): string[] {
  const read = (block: string): Record<string, string> =>
    Object.fromEntries([...block.matchAll(/--([a-z0-9-]+): (oklch\([^)]+\));/g)].map((m) => [m[1]!, m[2]!]));
  const modes: Record<string, Record<string, string>> = { light: read(css.split(':root {')[1]!.split('}')[0]!) };
  if (css.includes('.dark {')) modes.dark = read(css.split('.dark {')[1]!.split('}')[0]!);
  const failures: string[] = [];
  for (const [mode, vars] of Object.entries(modes)) {
    for (const [fg, bg, min] of SHADCN_PAIRS) {
      const ratio = wcag(vars[fg]!, vars[bg]!);
      if (ratio < min - 0.05) failures.push(`${mode}: ${fg} on ${bg} (${ratio.toFixed(2)} < ${min})`);
    }
  }
  return failures;
}

describe('emitters', () => {
  it('writes one file set per target', () => {
    expect(Object.keys(files).sort()).toEqual(
      ['DESIGN.md', '_tokens.scss', 'preview.html', 'shadcn.css', 'tailwind.css', 'tokens.css', 'tokens.dark.json', 'tokens.json', 'tokens.ts'].sort(),
    );
  });

  it('never leaks an unresolved alias or undefined', () => {
    for (const [file, content] of Object.entries(files)) {
      if (file.endsWith('.json')) continue; // DTCG keeps aliases by design
      // DESIGN.md components reference tokens by design; the linter test checks that each one resolves.
      const text = file === 'DESIGN.md' ? content.replace(/"\{(colors|typography|rounded|spacing)\.[^}]+\}"/g, '""') : content;
      expect(text, file).not.toMatch(/\{[a-z]+\.[a-zA-Z0-9.-]+\}/);
      expect(text, file).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it('css: declares everything it references, with light and dark themes', () => {
    const css = files['tokens.css']!;
    expect(undeclaredVars(css)).toEqual([]);
    expect(css).toContain('--color-primary: var(--color-brand-primary);');
    expect(css).toContain('--color-brand-primary: #4f46e5;');
    expect(css).toContain('--font-family-sans: Inter, ui-sans-serif, system-ui, "Segoe UI"');
    expect(css).toContain('--space-4: 1rem;');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"],');
    expect(css.split('{').length).toBe(css.split('}').length);
  });

  it('tailwind: uses v4 namespaces and a single spacing unit', () => {
    const tw = files['tailwind.css']!;
    expect(undeclaredVars(tw)).toEqual([]);
    expect(tw).toContain('@theme {');
    expect(tw).toContain('--spacing: 0.25rem;');
    expect(tw).toContain('--text-lg: 1.25rem;');
    expect(tw).toContain('--text-lg--line-height: 1.5;');
    expect(tw).toContain('--font-sans: Inter,');
    expect(tw).toContain('--spacing-gap: calc(var(--spacing) * 3);');
    expect(tw).not.toMatch(/--space-\d/);
    expect(tw.split('{').length).toBe(tw.split('}').length);
  });

  it('shadcn: fills every variable the components read, for light and dark', () => {
    const css = files['shadcn.css']!;
    const [light, dark] = [css.split(':root {')[1]!.split('}')[0]!, css.split('.dark {')[1]!.split('}')[0]!];
    for (const block of [light, dark]) {
      for (const name of ['background', 'foreground', 'primary', 'primary-foreground', 'muted-foreground', 'destructive', 'border', 'input', 'ring', 'chart-1', 'sidebar-accent']) {
        expect(block).toMatch(new RegExp(`--${name}: oklch\\(`));
      }
    }
    expect(light).toContain('--radius: 0.');
    expect(css).toContain('@theme inline {');
    expect(css).toContain('--color-primary-foreground: var(--primary-foreground);');
    expect(css).toContain('--radius-md: calc(var(--radius) - 2px);');
    expect(css).toContain('--font-sans: Inter,');
    expect(css).toContain(':root[data-theme="dark"],');
    expect(css).not.toMatch(/undefined|NaN|\[object/);
    expect(css.split('{').length).toBe(css.split('}').length);
    // Every var() used is declared somewhere in the file.
    expect(undeclaredVars(css)).toEqual([]);
  });

  it('shadcn: every foreground meets WCAG AA on the background it is paired with', () => {
    expect(shadcnContrastFailures(files['shadcn.css']!)).toEqual([]);
  });

  it('shadcn: a pill-shaped control does not turn every corner into a pill', () => {
    const pill = buildSystem({ brandColor: '#4f46e5', radius: 'full' });
    const css = renderTargets(pill, ['shadcn'])[0]!.content;
    expect(css).not.toContain('9999px');
  });

  it('shadcn: light-only systems emit no dark block', () => {
    const light = buildSystem({ brandColor: '#4f46e5', darkMode: false });
    const css = renderTargets(light, ['shadcn'])[0]!.content;
    expect(css).not.toContain('.dark {');
    expect(css).not.toContain('data-theme="dark"');
  });

  it('scss: variables reference each other and semantic colors stay dynamic', () => {
    const scss = files['_tokens.scss']!;
    expect(scss).toContain('$color-primary-500: #');
    expect(scss).toContain('$radius-control: $radius-md;');
    expect(scss).toContain('$color-bg: var(--color-bg);');
    expect(scss).toContain(':root {');
  });

  it('ts: exports resolved values', () => {
    const ts = files['tokens.ts']!;
    expect(ts).toContain('export const tokens = {');
    expect(ts).toContain('export const dark = {');
    expect(ts).toContain('"primary": "#4f46e5"');
    expect(ts).toContain('"color.bg": "var(--color-bg)"');
  });

  it('dtcg: valid JSON with typed tokens', () => {
    const tokens = JSON.parse(files['tokens.json']!);
    expect(tokens.color.bg).toMatchObject({ $type: 'color', $value: '{palette.neutral.50}' });
    expect(tokens.palette.brand.primary.$value.hex).toBe('#4f46e5');
    expect(JSON.parse(files['tokens.dark.json']!).color.bg.$value).toBe('{palette.neutral.950}');
  });

  it('design-md: documents roles and rules', () => {
    const md = files['DESIGN.md']!;
    expect(md).toContain('# Demo — design system');
    expect(md).toContain('| `--color-on-primary` |');
    expect(md).toContain('Never hard-code');
    expect(md.startsWith('---\n# Generated by Kaava for "Demo".')).toBe(true);
  });

  describe('design-md: conforms to the DESIGN.md format', () => {
    const designMd = (brief: Parameters<typeof buildSystem>[0]) => {
      const sys = buildSystem(brief);
      return { sys, report: lint(renderTargets(sys, ['design-md'])[0]!.content) };
    };
    const problems = (report: ReturnType<typeof lint>) => report.findings.filter((f) => f.severity !== 'info');

    it.each(styles().flatMap((s) => [true, false].map((darkMode) => [s.id, darkMode] as const)))(
      'style %s (dark mode %s) lints without errors or warnings',
      (style, darkMode) => {
        const { report } = designMd({ name: 'Demo', description: 'A demo.', brandColor: '#4f46e5', style: style as StyleId, darkMode });
        expect(problems(report)).toEqual([]);
        expect(report.sections).toEqual([
          'Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts", 'Motion', 'Theming',
        ]);
      },
    );

    it('stays clean with a pale brand color, custom fonts and overrides', () => {
      const sys = buildSystem(
        { brandColor: '#ffd400', accent: '#00a6ff', style: 'playful', fonts: { sans: 'Inter', display: 'Fraunces, serif' }, radius: 'none', shadows: 'none' },
        { 'radius.control': '{radius.full}', 'font.size.base': '1.0625rem', 'dark:color.primary': '#8b9cff' },
      );
      expect(problems(lint(renderTargets(sys, ['design-md'])[0]!.content))).toEqual([]);
    });

    it('front matter colors are the light theme, under the same names as the CSS variables', () => {
      const { sys, report } = designMd({ brandColor: '#4f46e5' });
      const layers = layersOf(sys);
      const expected = Object.fromEntries(
        [...layers.light.keys()].map((p) => [p.slice('color.'.length), (resolveToken(p, [layers.base, layers.light]).$value as ColorValue).hex]),
      );
      const actual = Object.fromEntries([...report.designSystem.colors].map(([name, c]) => [name, c.hex]));
      expect(actual).toEqual(expected);
    });

    it('components are pairings the contrast audit covers', () => {
      const { report } = designMd({ brandColor: '#4f46e5' });
      const audited = new Set(contrastPairs().map(([fg, bg]) => `${fg} on ${bg}`));
      const md = renderTargets(buildSystem({ brandColor: '#4f46e5' }), ['design-md'])[0]!.content;
      const blocks = md.split('\ncomponents:\n')[1]!.split('\n---')[0]!.split(/\n  (?=\S)/);
      const pairs = blocks.flatMap((block) => {
        const bg = /backgroundColor: "\{colors\.([^}]+)\}"/.exec(block)?.[1];
        const fg = /textColor: "\{colors\.([^}]+)\}"/.exec(block)?.[1];
        return bg && fg ? [`${fg} on ${bg}`] : [];
      });
      expect(pairs.length).toBeGreaterThan(20);
      expect(pairs.filter((p) => !audited.has(p))).toEqual([]);
      expect(report.designSystem.components.size).toBe(blocks.length);
    });

    it('a hostile name or description cannot break the front matter', () => {
      const name = 'x"\n---\ncolors: {primary: red}\n# y: \'';
      const { report } = designMd({ name, description: 'a: "b"\n- c', brandColor: '#4f46e5' });
      expect(report.designSystem.name).toBe(name);
      expect(report.designSystem.description).toBe('a: "b"\n- c');
      expect(report.summary.errors).toBe(0);
    });
  });

  it('preview: self-contained, uses only declared variables, escapes user text', () => {
    const html = files['preview.html']!;
    expect(undeclaredVars(html)).toEqual([]);
    expect(html).not.toMatch(/<link|src=|url\(/);
    const hostile = buildSystem({ name: '<script>alert(1)</script>', description: 'a "quoted" <b>', brandColor: '#4f46e5' });
    const out = renderTargets(hostile, ['preview'])[0]!.content;
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps a hostile name from closing the header comment', () => {
    const hostile = buildSystem({ name: 'x */ body{display:none} /* --> <b>\n$y: 1;', brandColor: '#4f46e5' });
    for (const { file, content } of renderTargets(hostile, ['css', 'tailwind', 'shadcn', 'scss', 'ts', 'preview', 'design-md'])) {
      const header = content.split('\n')[file === 'preview.html' || file === 'DESIGN.md' ? 1 : 0]!;
      expect(header, file).toContain('Generated by Kaava for "x  bodydisplaynone  -- by 1"');
    }
  });

  it('zeroes the duration tokens under reduced motion', () => {
    for (const file of ['tokens.css', 'tailwind.css', '_tokens.scss']) {
      const block = files[file]!.split('@media (prefers-reduced-motion: reduce)')[1];
      expect(block, file).toContain('--duration-fast: 0ms;');
      expect(block, file).toContain('--duration-slow: 0ms;');
    }
  });

  it('marks every file as generated', () => {
    for (const [file, content] of Object.entries(files)) expect(content, file).toContain('Generated by Kaava');
  });

  it('light-only systems emit no dark blocks', () => {
    const light = buildSystem({ brandColor: '#4f46e5', darkMode: false });
    const out = renderTargets(light, EMIT_TARGETS);
    expect(out.map((f) => f.file)).not.toContain('tokens.dark.json');
    expect(out.find((f) => f.file === 'tokens.css')!.content).not.toContain('prefers-color-scheme');
    expect(out.find((f) => f.file === 'tailwind.css')!.content).not.toContain('prefers-color-scheme');
  });

  describe.each(styles().flatMap((s) => [true, false].map((darkMode) => [s.id, darkMode] as const)))(
    'style %s (dark mode %s): every target',
    (style, darkMode) => {
      const sys = buildSystem({ name: 'Demo', brandColor: '#4f46e5', style: style as StyleId, darkMode });
      const out = Object.fromEntries(renderTargets(sys, EMIT_TARGETS).map((f) => [f.file, f.content]));

      it('emits every file without unresolved aliases or undefined values', () => {
        const expected = ['DESIGN.md', '_tokens.scss', 'preview.html', 'shadcn.css', 'tailwind.css', 'tokens.css', 'tokens.json', 'tokens.ts'];
        expect(Object.keys(out).sort()).toEqual((darkMode ? [...expected, 'tokens.dark.json'] : expected).sort());
        for (const [file, content] of Object.entries(out)) {
          if (file.endsWith('.json')) continue;
          const text = file === 'DESIGN.md' ? content.replace(/"\{(colors|typography|rounded|spacing)\.[^}]+\}"/g, '""') : content;
          expect(text, file).not.toMatch(/\{[a-z]+\.[a-zA-Z0-9.-]+\}/);
          expect(text, file).not.toMatch(/undefined|NaN|\[object/);
        }
      });

      it('keeps the stylesheets well formed', () => {
        for (const file of ['tokens.css', 'tailwind.css', 'shadcn.css']) {
          expect(undeclaredVars(out[file]!), file).toEqual([]);
          expect(out[file]!.split('{').length, file).toBe(out[file]!.split('}').length);
        }
      });

      it('shadcn.css keeps every foreground readable on its background', () => {
        expect(shadcnContrastFailures(out['shadcn.css']!)).toEqual([]);
      });
    },
  );
});
