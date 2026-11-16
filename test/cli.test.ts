import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kaava-cli-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function kaava(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, { cwd: dir, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const read = (file: string) => readFile(path.join(dir, file), 'utf8');
const exists = (file: string) => read(file).then(() => true, () => false);

describe('kaava-mcp command line', () => {
  it('init creates the system and writes the default outputs', async () => {
    const result = await kaava('init', '--brand', '#4f46e5', '--style', 'friendly', '--name', 'Acme');
    expect(result).toMatchObject({ code: 0, err: '' });
    expect(JSON.parse(await read('kaava.json'))).toMatchObject({ name: 'Acme', brief: { brandColor: '#4f46e5', style: 'friendly' } });
    expect(await read('kaava/tokens.css')).toContain('--color-brand-primary: #4f46e5;');
    expect(await read('kaava/DESIGN.md')).toContain('# Acme');
    expect(await exists('kaava/preview.html')).toBe(true);
    expect(result.out).toContain('Wrote 3 file(s)');
  });

  it('speaks in commands, never in MCP tool names', async () => {
    const created = await kaava('init', '--brand', '#4f46e5');
    expect(created.out).toContain('kaava-mcp audit');
    expect(created.out).not.toMatch(/kaava_|^Next:/m);

    const again = await kaava('init', '--brand', 'red');
    expect(again.code).toBe(1);
    expect(again.err).toContain('Use kaava-mcp update to change it, or pass --overwrite');

    const missing = await kaava('tokens', 'nope');
    expect(missing.err).toContain('Run kaava-mcp tokens without a path');
  });

  it('init honors --targets, --out and the brief options', async () => {
    const result = await kaava(
      'init', '--brand', '#0a7', '--targets', 'tailwind,ts', '--out', 'src/styles',
      '--density', 'compact', '--type-scale', '1.2', '--font-sans', 'Inter', '--no-dark',
    );
    expect(result.code).toBe(0);
    expect(await exists('src/styles/tailwind.css')).toBe(true);
    expect(await exists('src/styles/tokens.ts')).toBe(true);
    expect(await exists('kaava/tokens.css')).toBe(false);
    expect(JSON.parse(await read('kaava.json')).brief).toMatchObject({
      density: 'compact',
      typeScale: 1.2,
      fonts: { sans: 'Inter' },
      darkMode: false,
    });
  });

  it('init --dry-run writes nothing', async () => {
    const result = await kaava('init', '--brand', '#4f46e5', '--dry-run');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Dry run, nothing written');
    expect(await exists('kaava.json')).toBe(false);
    expect(await exists('kaava')).toBe(false);
  });

  it('update patches the brief, sets and unsets overrides, and regenerates outputs', async () => {
    await kaava('init', '--brand', '#4f46e5', '--targets', 'css');
    const set = await kaava('update', '--radius', 'full', '--set', 'font.size.base=1.0625rem');
    expect(set.code).toBe(0);
    expect(set.out).toContain('Regenerated: kaava/tokens.css');
    expect(JSON.parse(await read('kaava.json'))).toMatchObject({ brief: { radius: 'full' }, overrides: { 'font.size.base': '1.0625rem' } });
    expect(await read('kaava/tokens.css')).toContain('1.0625rem');

    const unset = await kaava('update', '--unset', 'font.size.base');
    expect(unset.code).toBe(0);
    expect(JSON.parse(await read('kaava.json')).overrides ?? {}).toEqual({});
  });

  it('emit writes the named targets and refuses to replace a file it did not generate', async () => {
    await kaava('init', '--brand', '#4f46e5', '--targets', 'css');
    expect((await kaava('emit', 'scss', 'dtcg')).code).toBe(0);
    expect(await exists('kaava/_tokens.scss')).toBe(true);
    expect(await exists('kaava/tokens.json')).toBe(true);

    await writeFile(path.join(dir, 'kaava/tokens.ts'), 'export const mine = 1;\n');
    const refused = await kaava('emit', 'ts');
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('kaava-mcp emit with --overwrite');
    expect(await read('kaava/tokens.ts')).toBe('export const mine = 1;\n');
    expect((await kaava('emit', 'ts', '--overwrite')).code).toBe(0);
  });

  it('works on another directory with --project', async () => {
    const result = await kaava('init', '--brand', '#4f46e5', '--project', 'app', '--targets', 'css');
    expect(result.code).toBe(1);
    expect(result.err).toContain('does not exist');

    const here = await kaava('init', '--brand', '#4f46e5', '--project', '.', '--targets', 'css');
    expect(here.code).toBe(0);
    expect((await kaava('tokens', 'radius', '--project', dir)).out).toContain('--radius-sm');
  });

  it('tokens lists groups, or the tokens under a path', async () => {
    await kaava('init', '--brand', '#4f46e5', '--targets', 'css');
    expect((await kaava('tokens')).out).toContain('- color (');
    const colors = await kaava('tokens', 'color.primary', '--mode', 'dark');
    expect(colors.out).toContain('--color-primary');
    expect(colors.out).not.toContain('light #');
  });

  it('audit exits 1 only when something fails', async () => {
    await kaava('init', '--brand', '#4f46e5', '--targets', 'css');
    const clean = await kaava('audit');
    expect(clean.code).toBe(0);
    expect(clean.out).toContain('pass WCAG 2.2 AA');

    await kaava('update', '--set', 'light:color.fg=#cccccc');
    const broken = await kaava('audit', '--failures-only');
    expect(broken.code).toBe(1);
    expect(broken.out).toMatch(/^FAIL {2}/m);
  });

  it('contrast needs no project and exits 1 when the pair fails', async () => {
    const failing = await kaava('contrast', '#999', '#fff');
    expect(failing.code).toBe(1);
    expect(failing.out).toContain('Nearest passing color of the same hue: #757575');
    expect((await kaava('contrast', '#999', '#fff', '--use', 'large-text')).code).toBe(1);
    expect((await kaava('contrast', '#000', '#fff', '--level', 'AAA')).code).toBe(0);
    // Passes for the requested use even though other thresholds on the summary line fail.
    expect((await kaava('contrast', '#888', '#fff', '--use', 'ui')).code).toBe(0);
  });

  it('styles lists the styles a brief can name', async () => {
    const { code, out } = await kaava('styles');
    expect(code).toBe(0);
    expect(out.split('\n').map((l) => l.split(' ')[0])).toEqual(['corporate', 'editorial', 'friendly', 'minimal', 'playful', 'technical']);
  });

  it('prints help and the version', async () => {
    expect((await kaava('--help')).out).toContain('kaava-mcp init --brand <color>');
    expect((await kaava('emit', '--help')).out).toContain('kaava-mcp init --brand <color>');
    expect((await kaava('--version')).out).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reports mistakes in the command with exit code 2, before touching the project', async () => {
    const cases: [string[], string][] = [
      [['frob'], 'Unknown command "frob"'],
      [['init'], 'init needs a brand color'],
      [['init', '--brand', 'red', '--style', 'bogus'], '--style: Invalid option'],
      [['init', '--brand', 'red', '--type-scale', 'big'], '--type-scale must be a number'],
      [['init', '--brand', 'red', '--type-scale', '9'], '--type-scale:'],
      [['init', '--brand', 'red', '--targets', 'css,nope'], 'Unknown target "nope"'],
      [['init', '--brand', 'red', '--dark', '--no-dark'], 'either --dark or --no-dark'],
      [['init', '--brand', 'red', 'extra'], 'takes options only'],
      [['update'], 'update needs something to change'],
      [['update', '--set', 'radius.control'], '--set takes <token>=<value>'],
      [['emit'], 'emit needs at least one target'],
      [['emit', 'css', '--frob'], "Unknown option '--frob'"],
      [['tokens', '--mode', 'dim'], '--mode must be one of light, dark'],
      [['contrast', '#000'], 'contrast needs two colors'],
    ];
    for (const [args, message] of cases) {
      const result = await kaava(...args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err, args.join(' ')).toContain(message);
      expect(result.err).toContain('kaava-mcp --help');
    }
    expect(await exists('kaava.json')).toBe(false);
  });
});
