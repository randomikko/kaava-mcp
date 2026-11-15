import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kaava-test-'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ cwd: dir }).connect(serverTransport);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return { text: result.content.map((c) => c.text).join('\n'), isError: result.isError === true };
}

const read = (file: string) => readFile(path.join(dir, file), 'utf8');

describe('kaava MCP server', () => {
  it('lists its tools, resources and prompt', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'kaava_audit',
      'kaava_check_contrast',
      'kaava_create_system',
      'kaava_emit',
      'kaava_get_tokens',
      'kaava_update_system',
    ]);
    expect((await client.listResources()).resources.map((r) => r.uri).sort()).toEqual(['kaava://presets', 'kaava://system']);
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(['new-design-system']);
  });

  it('creates, emits, updates and audits a system end to end', async () => {
    const created = await call('kaava_create_system', { name: 'Acme', brandColor: '#4f46e5', mood: 'friendly' });
    expect(created.isError).toBe(false);
    expect(created.text).toContain('pass WCAG 2.2 AA');
    expect(JSON.parse(await read('kaava.json')).name).toBe('Acme');

    const emitted = await call('kaava_emit', { targets: ['css', 'design-md'], outDir: 'src/styles' });
    expect(emitted.isError).toBe(false);
    expect(await read('src/styles/tokens.css')).toContain('--color-brand-primary: #4f46e5;');
    expect(await read('src/styles/DESIGN.md')).toContain('# Acme');

    // Updating the brief regenerates what was emitted before, without being asked.
    const updated = await call('kaava_update_system', {
      brief: { brandColor: '#059669' },
      overrides: { 'radius.control': '{radius.full}' },
    });
    expect(updated.isError).toBe(false);
    expect(updated.text).toContain('tokens.css');
    const css = await read('src/styles/tokens.css');
    expect(css).toContain('--color-brand-primary: #059669;');
    expect(css).toContain('--radius-control: var(--radius-full);');
    const saved = JSON.parse(await read('kaava.json'));
    expect(saved.brief).toMatchObject({ name: 'Acme', mood: 'friendly', brandColor: '#059669' });
    expect(saved.emit).toEqual({ outDir: 'src/styles', targets: ['css', 'design-md'] });

    const tokens = await call('kaava_get_tokens', { path: 'color.primary' });
    expect(tokens.text).toContain('color.primary  --color-primary  light #059669 (= palette.brand.primary)');
    expect((await call('kaava_get_tokens')).text).toContain('- color (');

    const audit = await call('kaava_audit');
    expect(audit.text).toMatch(/all \d+ checked pairs pass/);

    const resource = await client.readResource({ uri: 'kaava://system' });
    expect(JSON.parse((resource.contents[0] as { text: string }).text).name).toBe('Acme');
  });

  it('refuses to replace an existing system unless told to', async () => {
    await call('kaava_create_system', { name: 'First', brandColor: '#111111' });
    const second = await call('kaava_create_system', { name: 'Second', brandColor: '#222222' });
    expect(second.isError).toBe(true);
    expect(second.text).toContain('already has the design system "First"');
    expect(JSON.parse(await read('kaava.json')).name).toBe('First');

    const forced = await call('kaava_create_system', { name: 'Second', brandColor: '#222222', overwrite: true });
    expect(forced.isError).toBe(false);
    expect(JSON.parse(await read('kaava.json')).name).toBe('Second');
  });

  it('does not clobber an unreadable kaava.json', async () => {
    await writeFile(path.join(dir, 'kaava.json'), '{ not json');
    const result = await call('kaava_create_system', { brandColor: '#111111' });
    expect(result.isError).toBe(true);
    expect(await read('kaava.json')).toBe('{ not json');
  });

  it('dry runs write nothing', async () => {
    const created = await call('kaava_create_system', { brandColor: '#4f46e5', dryRun: true });
    expect(created.text).toContain('Dry run');
    await expect(read('kaava.json')).rejects.toThrow();

    await call('kaava_create_system', { brandColor: '#4f46e5' });
    const emitted = await call('kaava_emit', { targets: ['tailwind'], dryRun: true });
    expect(emitted.text).toContain('@theme {');
    await expect(read('kaava/tailwind.css')).rejects.toThrow();
  });

  it('refuses to write outside the project', async () => {
    await call('kaava_create_system', { brandColor: '#4f46e5' });
    const result = await call('kaava_emit', { targets: ['css'], outDir: '../escape' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('outside the project root');
  });

  it('leaves files it did not generate alone unless told to overwrite', async () => {
    await call('kaava_create_system', { brandColor: '#4f46e5' });
    await mkdir(path.join(dir, 'styles'));
    await writeFile(path.join(dir, 'styles/tokens.css'), ':root { --mine: 1; }');
    const refused = await call('kaava_emit', { targets: ['css', 'design-md'], outDir: 'styles' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('not generated by Kaava');
    expect(await read('styles/tokens.css')).toBe(':root { --mine: 1; }');
    // Nothing is written when any destination is refused.
    await expect(read('styles/DESIGN.md')).rejects.toThrow();

    const forced = await call('kaava_emit', { targets: ['css'], outDir: 'styles', overwrite: true });
    expect(forced.isError).toBe(false);
    expect(await read('styles/tokens.css')).toContain('Generated by Kaava');
    // Its own output is regenerated freely afterwards.
    expect((await call('kaava_emit', { targets: ['css'], outDir: 'styles' })).isError).toBe(false);
  });

  it('does not follow a symlink out of the project', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'kaava-outside-'));
    try {
      await call('kaava_create_system', { brandColor: '#4f46e5' });
      await symlink(outside, path.join(dir, 'linked'));
      const result = await call('kaava_emit', { targets: ['css'], outDir: 'linked' });
      expect(result.isError).toBe(true);
      expect(result.text).toContain('through a symlink');
      await expect(readFile(path.join(outside, 'tokens.css'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('handles tool calls sent in parallel', async () => {
    const [created, emitted, audited] = await Promise.all([
      call('kaava_create_system', { name: 'Parallel', brandColor: '#4f46e5' }),
      call('kaava_emit', { targets: ['css', 'preview'] }),
      call('kaava_audit'),
    ]);
    expect([created.isError, emitted.isError, audited.isError]).toEqual([false, false, false]);
    expect(await read('kaava/preview.html')).toContain('<title>Parallel · design system</title>');
    expect(JSON.parse(await read('kaava.json')).emit.targets).toEqual(['css', 'preview']);
  });

  it('audits accessibility beyond contrast', async () => {
    await call('kaava_create_system', { brandColor: '#4f46e5' });
    const audit = await call('kaava_audit');
    expect(audit.text).toMatch(/all \d+ checked pairs pass/);
    expect(audit.text).toContain('success and danger with deuteranopia');
    expect(audit.text).toContain('WCAG 1.4.1 Use of Color');
    expect(audit.text).toContain('Control heights: sm 32px, md 40px, lg 48px');
    expect((await call('kaava_audit', { failuresOnly: true })).text).not.toContain('Control heights');

    await call('kaava_update_system', { overrides: { 'size.control.sm': '20px' } });
    expect((await call('kaava_audit', { failuresOnly: true })).text).toContain('FAIL  size.control.sm is 20px');
  });

  it('checks a single contrast pair, with or without a design system', async () => {
    // Literal colors need no kaava.json.
    const literal = await call('kaava_check_contrast', { foreground: '#777777', background: '#ffffff' });
    expect(literal.isError).toBe(false);
    expect(literal.text).toContain('#777777 on #ffffff: 4.47:1');
    expect(literal.text).toContain('FAIL  WCAG 2.2 AA for text (needs 4.5:1)');
    expect(literal.text).toMatch(/Nearest passing color of the same hue: #[0-9a-f]{6}/);
    expect((await call('kaava_check_contrast', { foreground: '#777777', background: '#ffffff', use: 'ui' })).text).toContain('pass  WCAG 2.2 AA for UI');
    const noSystem = await call('kaava_check_contrast', { foreground: 'color.fg', background: '#fff' });
    expect(noSystem.isError).toBe(true);
    expect(noSystem.text).toContain('token names need a kaava.json');

    await call('kaava_create_system', { brandColor: '#4f46e5' });
    const tokens = await call('kaava_check_contrast', { foreground: '--color-fg-muted', background: 'surface', level: 'AAA' });
    expect(tokens.text).toContain('color.fg-muted (#');
    expect(tokens.text).toContain('on color.surface (#ffffff)');
    const failing = await call('kaava_check_contrast', { foreground: 'palette.neutral.300', background: 'color.bg', mode: 'dark', level: 'AAA' });
    expect(failing.text).toContain('pass  WCAG 2.2 AAA');
    const weak = await call('kaava_check_contrast', { foreground: 'palette.neutral.300', background: 'color.bg' });
    expect(weak.text).toContain('System text colors that pass on this background: color.fg #');
    expect((await call('kaava_check_contrast', { foreground: 'space.4', background: '#fff' })).text).toContain('not a color');
  });

  it('returns actionable errors', async () => {
    expect((await call('kaava_emit', { targets: ['css'] })).text).toContain('Create a design system first');
    const bad = await call('kaava_create_system', { brandColor: 'blurple-ish' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Cannot parse color');
    await call('kaava_create_system', { brandColor: '#4f46e5' });
    const override = await call('kaava_update_system', { overrides: { 'color.nope': '#fff' } });
    expect(override.isError).toBe(true);
    expect(JSON.parse(await read('kaava.json')).overrides).toBeUndefined();
  });
});
