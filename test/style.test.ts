import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { styleIds, stylesIndex } from '../scripts/styles-index.mjs';
import { toCatalogue } from '../scripts/google-fonts.mjs';
import { createWorkbench, formatStyle } from '../scripts/workbench.mjs';
import { filterFonts, googleFontUrl, indexFonts, primaryFamily, sampleUrl, syncWebfonts, urlFamilies } from '../workbench/fonts.js';
import { auditContrast } from '../src/audit.js';
import { buildSystem, resolveLayers } from '../src/engine/resolve.js';
import { renderTargets } from '../src/emit/index.js';
import { cssValue, resolveToken } from '../src/tokens.js';
import { getStyle, parseStyle, registerStyle, styles, type Style } from '../src/style.js';

const css = (layers: ReturnType<typeof resolveLayers>, token: string): string => {
  const value = (p: string): string => cssValue(resolveToken(p, [layers.base]), value);
  return value(token);
};

describe('styles', () => {
  it('every file in styles/ is valid, credited and registered', () => {
    expect(styles().map((s) => s.id).sort()).toEqual(styleIds().sort());
    for (const style of styles()) {
      expect(style.author.length, style.id).toBeGreaterThan(0);
      const file = readFileSync(new URL(`../styles/${style.id}.json`, import.meta.url), 'utf8');
      expect(parseStyle(JSON.parse(file)), style.id).toEqual(style);
    }
  });

  it('styles/index.ts lists exactly the files in the folder', () => {
    const index = readFileSync(new URL('../styles/index.ts', import.meta.url), 'utf8');
    expect(index, 'styles/index.ts is out of date. Run `npm run styles`.').toBe(stylesIndex(styleIds()));
  });

  it('names the field when a style is malformed', () => {
    const broken = structuredClone(getStyle()) as Style;
    broken.color.lightness[3] = 0.99;
    expect(() => parseStyle(broken)).toThrow(/Invalid style "default": color\.lightness: must get darker/);
    expect(() => parseStyle({ ...getStyle(), id: 'Not An Id' })).toThrow(/id: lowercase letters/);
    expect(() => resolveLayers({ brandColor: '#333', style: 'nope' as never })).toThrow(/Unknown style "nope". Available: /);
  });

  it('applies a hand-authored style: type, shape, surfaces, web fonts', () => {
    const custom = structuredClone(getStyle()) as Style;
    Object.assign(custom, { id: 'test-signature', name: 'Signature', author: 'A Person' });
    custom.type.scale = { sizes: [0.75, 0.875, 1.0625, 1.25, 1.5, 2, 2.75, 3.5, 5] };
    custom.type.tracking = [0.02, 0.01, 0, 0, -0.01, -0.015, -0.02, -0.03, -0.04];
    custom.type.headingWeight = 'medium';
    custom.type.families = { display: 'Fraunces' };
    custom.type.webfonts = ['https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500&display=swap'];
    custom.shape = { radius: { sm: 2, md: 3, lg: 5, xl: 10 }, control: 'sm', surface: 'xl', borderWidth: 2 };
    custom.color.surfaces.dark = { bg: 'black', surface: 950, muted: 900 };
    registerStyle(custom);

    const brief = { brandColor: '#4f46e5', style: 'test-signature' as never };
    const layers = resolveLayers(brief);
    expect(css(layers, 'font.size.base')).toBe('1.0625rem');
    expect(css(layers, 'font.tracking.5xl')).toBe('-0.04em');
    expect(css(layers, 'font.weight.heading')).toBe('500');
    expect(css(layers, 'radius.control')).toBe('0.125rem');
    expect(css(layers, 'radius.surface')).toBe('0.625rem');
    expect(css(layers, 'border.width')).toBe('2px');
    expect(layers.dark!.get('color.bg')!.$value).toBe('{palette.black}');
    expect(auditContrast(layers).filter((r) => !r.pass)).toEqual([]);

    const files = Object.fromEntries(renderTargets(buildSystem(brief), ['tailwind', 'preview', 'design-md']).map((f) => [f.file, f.content]));
    expect(files['tailwind.css']).toContain('--text-5xl--letter-spacing: -0.04em;');
    expect(files['preview.html']).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500&amp;display=swap">');
    expect(files['DESIGN.md']).toContain('**Style:** Signature, by A Person.');
    expect(files['DESIGN.md']).toContain('Fonts: this style');
    // A brief that brings its own fonts no longer needs the style's web fonts.
    expect(renderTargets(buildSystem({ ...brief, fonts: { display: 'Georgia' } }), ['preview'])[0]!.content).not.toContain('<link');
  });
});

describe('workbench server', () => {
  let dir: string;
  let base: string;
  let server: ReturnType<typeof createWorkbench>;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kaava-styles-'));
    await writeFile(path.join(dir, 'default.json'), formatStyle(getStyle()));
    server = createWorkbench({ stylesDir: dir, parseStyle });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const put = (id: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/styles/${encodeURIComponent(id)}`, { method: 'PUT', headers, body: JSON.stringify(body) });

  it('serves the page and lists styles', async () => {
    expect(await (await fetch(base)).text()).toContain('Kaava workbench');
    expect(((await (await fetch(`${base}/api/styles`)).json()) as Style[]).map((s) => s.id)).toEqual(['default']);
  });

  it('serves the Google Fonts catalogue', async () => {
    const data = (await (await fetch(`${base}/google-fonts.json`)).json()) as { updated: string; fonts: [string, string, string | number[]][] };
    expect(data.fonts.length).toBeGreaterThan(1500);
    expect(data.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Set(data.fonts.map((f) => f[0])).size).toBe(data.fonts.length);
    for (const [family, category, weights] of data.fonts) {
      expect(family).toMatch(/^[\p{L}\p{N} ]+$/u);
      expect(['Sans Serif', 'Serif', 'Display', 'Handwriting', 'Monospace']).toContain(category);
      if (typeof weights === 'string') expect(weights, family).toMatch(/^\d+\.\.\d+$/);
      else expect(weights.length, family).toBeGreaterThan(0);
    }
    expect(indexFonts(data.fonts).get('inter')).toEqual(['Inter', 'Sans Serif', '100..900']);
    expect((await fetch(`${base}/fonts.js`)).headers.get('content-type')).toContain('text/javascript');
  });

  it('saves a style and keeps the index in step', async () => {
    const mine = { ...structuredClone(getStyle()), id: 'my-style', name: 'Mine', author: 'A Person' };
    expect((await put('my-style', mine)).status).toBe(200);
    expect(parseStyle(JSON.parse(await readFile(path.join(dir, 'my-style.json'), 'utf8')))).toMatchObject({ id: 'my-style', author: 'A Person' });
    expect(await readFile(path.join(dir, 'my-style.json'), 'utf8')).toContain('"lightness": [0.975, 0.94,');
    expect(await readFile(path.join(dir, 'index.ts'), 'utf8')).toBe(stylesIndex(['default', 'my-style']));
  });

  it('refuses bad ids, mismatches, invalid styles and outside callers', async () => {
    const style = structuredClone(getStyle());
    expect((await put('../escape', { ...style, id: '../escape' })).status).toBe(400);
    expect((await put('other', style)).status).toBe(400);
    const invalid = await put('default', { ...style, shape: { ...style.shape, borderWidth: 99 } });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toContain('shape.borderWidth');
    expect((await put('default', style, { origin: 'https://evil.example' })).status).toBe(403);
    // fetch cannot forge a Host header, so this one goes through node:http.
    const forgedHost = await new Promise<number>((resolve) => {
      get(`${base}/api/styles`, { headers: { host: 'evil.example' } }, (res) => resolve(res.statusCode ?? 0));
    });
    expect(forgedHost).toBe(403);
  });
});

describe('workbench fonts', () => {
  const fonts: [string, string, string | number[]][] = [
    ['Inter', 'Sans Serif', '100..900'],
    ['Abril Fatface', 'Display', [400]],
    ['Merriweather Sans', 'Sans Serif', [300, 700]],
    ['Roboto Mono', 'Monospace', '100..700'],
  ];
  const index = indexFonts(fonts);

  it('builds stylesheet URLs from the weights a family really has', () => {
    expect(googleFontUrl(fonts[0]!)).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap');
    expect(googleFontUrl(fonts[1]!)).toBe('https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap');
    expect(googleFontUrl(fonts[2]!)).toBe('https://fonts.googleapis.com/css2?family=Merriweather+Sans:wght@300;700&display=swap');
    expect(sampleUrl('Abril Fatface')).toBe('https://fonts.googleapis.com/css2?family=Abril+Fatface&text=Abril%20Fatface&display=swap');
    expect(urlFamilies(googleFontUrl(fonts[2]!))).toEqual(['Merriweather Sans']);
    expect(urlFamilies('https://example.com/css2?family=Inter')).toEqual([]);
    expect(urlFamilies('not a url')).toEqual([]);
    // Every URL passes the style schema's webfont rule.
    const style = structuredClone(getStyle());
    style.type.webfonts = fonts.map(googleFontUrl);
    expect(() => parseStyle(style)).not.toThrow();
  });

  it('reads the first family of a stack', () => {
    expect(primaryFamily('"Abril Fatface", Georgia, serif')).toBe('Abril Fatface');
    expect(primaryFamily(' Inter ')).toBe('Inter');
    expect(primaryFamily(undefined)).toBe('');
  });

  it('keeps the web font list in step with the family fields', () => {
    const inter = googleFontUrl(fonts[0]!);
    const abril = googleFontUrl(fonts[1]!);
    const custom = 'https://example.com/brand.css';
    // Picking a Google family adds its stylesheet, whatever the case it was typed in.
    expect(syncWebfonts([custom], { sans: 'inter' }, undefined, index)).toEqual([custom, inter]);
    // Replacing it swaps the stylesheet and leaves other URLs alone.
    expect(syncWebfonts([custom, inter], { sans: 'Abril Fatface, serif' }, 'Inter', index)).toEqual([custom, abril]);
    // A family another field still uses stays loaded.
    expect(syncWebfonts([inter], { sans: 'Inter', display: 'Abril Fatface' }, 'Inter', index)).toEqual([inter, abril]);
    // Clearing a field drops its stylesheet; a family Google does not have changes nothing.
    expect(syncWebfonts([inter], {}, 'Inter', index)).toEqual([]);
    expect(syncWebfonts([custom], { sans: 'Söhne' }, 'Helvetica', index)).toEqual([custom]);
    // A stylesheet that already loads the family, in any form, is not duplicated.
    const handWritten = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
    expect(syncWebfonts([handWritten], { sans: 'Inter' }, undefined, index)).toEqual([handWritten]);
  });

  it('filters by text and category', () => {
    expect(filterFonts(fonts, 'MER', '').map((f: (typeof fonts)[number]) => f[0])).toEqual(['Merriweather Sans']);
    expect(filterFonts(fonts, '', 'Sans Serif').map((f: (typeof fonts)[number]) => f[0])).toEqual(['Inter', 'Merriweather Sans']);
    expect(filterFonts(fonts, '  ', '')).toHaveLength(4);
  });

  it('turns Google metadata into the catalogue, most popular first', () => {
    const metadata = {
      familyMetadataList: [
        { family: 'Static', category: 'Serif', popularity: 9, fonts: { '700': {}, '400': {}, '400i': {} }, axes: [] },
        { family: 'Variable', category: 'Sans Serif', popularity: 2, fonts: { '400': {} }, axes: [{ tag: 'opsz', min: 8, max: 144 }, { tag: 'wght', min: 200, max: 800 }] },
        { family: 'Italic Only', category: 'Display', popularity: 1, fonts: { '400i': {} }, axes: [] },
      ],
    };
    expect(toCatalogue(metadata)).toEqual([['Variable', 'Sans Serif', '200..800'], ['Static', 'Serif', [400, 700]]]);
  });
});
