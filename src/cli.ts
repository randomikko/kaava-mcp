import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { briefShape, EMIT_TARGETS } from './schema.js';
import { createServer } from './server.js';
import { DEFAULT_STYLE_ID, styles } from './style.js';
import { VERSION } from './version.js';

/**
 * The command line: the MCP tools without an MCP client. Each command calls the matching tool of an
 * in-process server, so both front ends share one implementation, including the file-safety rules.
 */

export interface CliIO {
  /** Directory commands run in; `--project` is resolved against it. */
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
}

const DEFAULT_TARGETS = ['css', 'design-md', 'preview'];

const HELP = `kaava-mcp ${VERSION}
Generates and maintains a project's design system.

Without arguments it runs as an MCP server over stdio, to be launched by an MCP client:

  Claude Code:   claude mcp add kaava -- npx -y kaava-mcp
  Other clients: { "command": "npx", "args": ["-y", "kaava-mcp"] }

With a command it works on the project in the current directory:

  kaava-mcp init --brand <color> [brief options] [--targets css,design-md,preview] [--out kaava]
      Create kaava.json and write the outputs. --overwrite replaces an existing system.
  kaava-mcp update [brief options] [--set <token>=<value>]... [--unset <token>]...
      Change the brief or override single tokens. Regenerates the outputs.
  kaava-mcp emit <target>... [--out <dir>] [--overwrite]
      Write outputs: ${EMIT_TARGETS.join(', ')}.
  kaava-mcp tokens [<path>] [--mode light|dark]
      List token groups, or the tokens under a path such as "color" or "font.size".
  kaava-mcp audit [--failures-only]
      Accessibility audit against WCAG 2.2 AA. Exits 1 when something fails.
  kaava-mcp contrast <foreground> <background> [--use text|large-text|ui] [--level AA|AAA] [--mode light|dark]
      Check two colors or tokens. Exits 1 when the pair fails.
  kaava-mcp styles
      List the available styles.

Brief options:
  --brand <color>        Brand color in any CSS syntax (required by init)
  --style <id>           ${styles().filter((s) => s.id !== DEFAULT_STYLE_ID).map((s) => s.id).join(', ')}
  --name <text>          Name of the system
  --description <text>   What the product is and who it is for
  --accent <color>       Accent color; derived from the brand hue when omitted
  --density <d>          compact, comfortable, spacious
  --radius <r>           none, sm, md, lg, full
  --type-scale <n>       Modular scale ratio, 1.067 to 1.5
  --neutral-tint <n>     How much brand hue the greys carry, 0 to 1
  --shadows <s>          none, soft, crisp
  --font-sans <family>, --font-mono <family>, --font-display <family>
  --no-dark, --dark      Leave out, or bring back, the dark theme

Everywhere:
  --project <dir>        Project directory. Default: the current directory
  --dry-run              Show what init, update or emit would write, without writing
  -h, --help, -v, --version`;

type Options = NonNullable<ParseArgsConfig['options']>;

const BRIEF_OPTIONS = {
  brand: { type: 'string' },
  style: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string' },
  accent: { type: 'string' },
  density: { type: 'string' },
  radius: { type: 'string' },
  'type-scale': { type: 'string' },
  'neutral-tint': { type: 'string' },
  shadows: { type: 'string' },
  'font-sans': { type: 'string' },
  'font-mono': { type: 'string' },
  'font-display': { type: 'string' },
  dark: { type: 'boolean' },
  'no-dark': { type: 'boolean' },
} satisfies Options;

const COMMON_OPTIONS = {
  project: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} satisfies Options;

const COMMAND_OPTIONS: Record<string, Options> = {
  init: { ...BRIEF_OPTIONS, targets: { type: 'string' }, out: { type: 'string' }, overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
  update: { ...BRIEF_OPTIONS, set: { type: 'string', multiple: true }, unset: { type: 'string', multiple: true }, 'dry-run': { type: 'boolean' } },
  emit: { out: { type: 'string' }, overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
  tokens: { mode: { type: 'string' } },
  audit: { 'failures-only': { type: 'boolean' } },
  contrast: { use: { type: 'string' }, level: { type: 'string' }, mode: { type: 'string' } },
  styles: {},
};

/** A mistake in how the command was written, as opposed to a tool that ran and reported a problem. */
class UsageError extends Error {}

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

/** Brief field -> the flag that sets it, for error messages. */
const BRIEF_FLAGS: Record<string, string> = {
  brandColor: '--brand',
  typeScale: '--type-scale',
  neutralTint: '--neutral-tint',
  'fonts.sans': '--font-sans',
  'fonts.mono': '--font-mono',
  'fonts.display': '--font-display',
};

function briefFrom(values: Values): Record<string, unknown> {
  const text = (flag: string): string | undefined => values[flag] as string | undefined;
  const number = (flag: string): number | undefined => {
    const raw = text(flag);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${flag} must be a number (got "${raw}").`);
    return n;
  };
  if (values.dark && values['no-dark']) throw new UsageError('Use either --dark or --no-dark, not both.');
  const fonts = { sans: text('font-sans'), mono: text('font-mono'), display: text('font-display') };
  const brief: Record<string, unknown> = {
    name: text('name'),
    description: text('description'),
    brandColor: text('brand'),
    accent: text('accent'),
    style: text('style'),
    neutralTint: number('neutral-tint'),
    density: text('density'),
    radius: text('radius'),
    typeScale: number('type-scale'),
    fonts: Object.values(fonts).some((f) => f !== undefined) ? fonts : undefined,
    shadows: text('shadows'),
    darkMode: values['no-dark'] ? false : values.dark ? true : undefined,
  };
  for (const key of Object.keys(brief)) if (brief[key] === undefined) delete brief[key];
  const parsed = z.object(briefShape).partial().safeParse(brief);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = issue.path.join('.');
    throw new UsageError(`${BRIEF_FLAGS[field] ?? `--${field}`}: ${issue.message}`);
  }
  return brief;
}

function oneOf<T extends string>(flag: string, value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new UsageError(`--${flag} must be one of ${allowed.join(', ')} (got "${String(value)}").`);
  return value as T;
}

function targetsFrom(raw: string[]): string[] {
  const targets = raw.flatMap((t) => t.split(',')).map((t) => t.trim()).filter(Boolean);
  const unknown = targets.filter((t) => !(EMIT_TARGETS as readonly string[]).includes(t));
  if (unknown.length) throw new UsageError(`Unknown target ${unknown.map((t) => `"${t}"`).join(', ')}. Targets: ${EMIT_TARGETS.join(', ')}.`);
  return targets;
}

const TOOL_COMMANDS: Record<string, string> = {
  kaava_create_system: 'kaava-mcp init',
  kaava_update_system: 'kaava-mcp update',
  kaava_get_tokens: 'kaava-mcp tokens',
  kaava_emit: 'kaava-mcp emit',
  kaava_audit: 'kaava-mcp audit',
  kaava_check_contrast: 'kaava-mcp contrast',
};

/** Tool results are written for an agent holding MCP tools; say the same thing in command-line terms. */
function inCliTerms(text: string): string {
  return text
    .replace(/kaava_[a-z_]+/g, (tool) => TOOL_COMMANDS[tool] ?? tool)
    .replace(/\b([Cc])all (?=kaava-mcp )/g, (_, c: string) => (c === 'C' ? 'Run ' : 'run '))
    .replaceAll('overwrite: true', '--overwrite')
    .replaceAll('mode: "dark"', '--mode dark')
    .replaceAll('a different outDir', 'a different --out directory')
    .replaceAll('Tell the user to open', 'Open');
}

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  try {
    return await run(argv, io);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.err(`${err.message}\nRun "kaava-mcp --help" for usage.`);
    return 2;
  }
}

async function run(argv: string[], io: CliIO): Promise<number> {
  const command = argv[0]!;
  if (command === '--version' || command === '-v') {
    io.out(VERSION);
    return 0;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    io.out(HELP);
    return 0;
  }
  const options = COMMAND_OPTIONS[command];
  if (!options) throw new UsageError(`Unknown command "${command}".`);

  let values: Values;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: argv.slice(1), options: { ...options, ...COMMON_OPTIONS }, allowPositionals: true }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  const expect = (max: number, what: string): void => {
    if (positionals.length > max) throw new UsageError(`"kaava-mcp ${command}" takes ${what} (got "${positionals.slice(max).join(' ')}").`);
  };

  if (command === 'styles') {
    expect(0, 'no arguments');
    io.out(
      styles()
        .filter((s) => s.id !== DEFAULT_STYLE_ID)
        .map((s) => `${s.id}  ${s.name} by ${s.author}. ${s.description}`)
        .join('\n'),
    );
    return 0;
  }

  const root = path.resolve(io.cwd, (values.project as string | undefined) ?? '.');
  const dryRun = values['dry-run'] === true ? true : undefined;

  // Everything about the command line is checked before the server is started.
  type Call = { tool: string; args: Record<string, unknown>; show?: (text: string) => string };
  const calls: Call[] = [];
  let failsOn: ((text: string) => boolean) | undefined;

  switch (command) {
    case 'init': {
      expect(0, 'options only');
      const brief = briefFrom(values);
      if (!brief.brandColor) throw new UsageError('init needs a brand color: kaava-mcp init --brand "#4f46e5"');
      const targets = targetsFrom([(values.targets as string | undefined) ?? DEFAULT_TARGETS.join(',')]);
      if (targets.length === 0) throw new UsageError(`--targets needs at least one of ${EMIT_TARGETS.join(', ')}.`);
      // The outputs follow right away, so the tool's pointer to the emit step would only mislead.
      const withoutNextStep = (text: string): string => text.replace(/\n*^Next: .*$/m, '');
      calls.push({ tool: 'kaava_create_system', args: { ...brief, overwrite: values.overwrite, dryRun }, show: dryRun ? undefined : withoutNextStep });
      // A dry run leaves no kaava.json for the emit step to read.
      if (!dryRun) calls.push({ tool: 'kaava_emit', args: { targets, outDir: values.out, overwrite: values.overwrite } });
      break;
    }
    case 'update': {
      expect(0, 'options only');
      const brief = briefFrom(values);
      const overrides: Record<string, string> = {};
      for (const pair of (values.set as string[] | undefined) ?? []) {
        const at = pair.indexOf('=');
        if (at < 1) throw new UsageError(`--set takes <token>=<value>, e.g. --set radius.control={radius.full} (got "${pair}").`);
        overrides[pair.slice(0, at)] = pair.slice(at + 1);
      }
      const removeOverrides = (values.unset as string[] | undefined) ?? [];
      if (!Object.keys(brief).length && !Object.keys(overrides).length && !removeOverrides.length) {
        throw new UsageError('update needs something to change: a brief option, --set or --unset.');
      }
      calls.push({
        tool: 'kaava_update_system',
        args: {
          brief: Object.keys(brief).length ? brief : undefined,
          overrides: Object.keys(overrides).length ? overrides : undefined,
          removeOverrides: removeOverrides.length ? removeOverrides : undefined,
          dryRun,
        },
      });
      break;
    }
    case 'emit': {
      const targets = targetsFrom(positionals);
      if (targets.length === 0) throw new UsageError(`emit needs at least one target: ${EMIT_TARGETS.join(', ')}.`);
      calls.push({ tool: 'kaava_emit', args: { targets, outDir: values.out, overwrite: values.overwrite, dryRun } });
      break;
    }
    case 'tokens': {
      expect(1, 'one token path');
      calls.push({ tool: 'kaava_get_tokens', args: { path: positionals[0], mode: oneOf('mode', values.mode, ['light', 'dark']) } });
      break;
    }
    case 'audit': {
      expect(0, 'options only');
      calls.push({ tool: 'kaava_audit', args: { failuresOnly: values['failures-only'] } });
      failsOn = (text) => /^FAIL {2}/m.test(text);
      break;
    }
    case 'contrast': {
      expect(2, 'a foreground and a background');
      if (positionals.length < 2) throw new UsageError('contrast needs two colors: kaava-mcp contrast "#767676" "#ffffff"');
      calls.push({
        tool: 'kaava_check_contrast',
        args: {
          foreground: positionals[0],
          background: positionals[1],
          use: oneOf('use', values.use, ['text', 'large-text', 'ui']),
          level: oneOf('level', values.level, ['AA', 'AAA']),
          mode: oneOf('mode', values.mode, ['light', 'dark']),
        },
      });
      // The second line is the verdict for the requested use and level; later lines list every threshold.
      failsOn = (text) => text.split('\n')[1]?.startsWith('FAIL') === true;
      break;
    }
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ cwd: root });
  await server.connect(serverTransport);
  const client = new Client({ name: 'kaava-cli', version: VERSION });
  await client.connect(clientTransport);
  try {
    let code = 0;
    for (const [i, call] of calls.entries()) {
      const args = Object.fromEntries(Object.entries(call.args).filter(([, v]) => v !== undefined));
      const result = (await client.callTool({ name: call.tool, arguments: args })) as {
        content: { type: string; text: string }[];
        isError?: boolean;
      };
      const text = inCliTerms(result.content.map((c) => c.text).join('\n'));
      if (result.isError) {
        io.err(text);
        return 1;
      }
      io.out(`${i > 0 ? '\n' : ''}${call.show ? call.show(text) : text}`);
      if (failsOn?.(text)) code = 1;
    }
    return code;
  } finally {
    await client.close();
    await server.close();
  }
}
