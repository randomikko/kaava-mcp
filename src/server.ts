import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { auditContrast, contrastSummary } from './audit.js';
import { renderTargets } from './emit/index.js';
import { cssVar } from './emit/names.js';
import { buildSystem, layersOf, resolveBrief, type KaavaSystem } from './engine/resolve.js';
import { DEFAULT_PRESET, PRESETS } from './presets.js';
import {
  isForeignFile,
  isInside,
  loadSystem,
  readSystem,
  resolveForWrite,
  serializeSystem,
  SYSTEM_FILE,
  writeProjectFile,
} from './project.js';
import { briefSchema, briefShape, EMIT_TARGETS, type Brief, type EmitTarget } from './schema.js';
import { aliasPath, cssValue, isAlias, resolveToken, type ColorValue, type Flat } from './tokens.js';
import { VERSION } from './version.js';

const INSTRUCTIONS = `Kaava generates and maintains a project's design system.

You supply the taste (brand color, mood, density, fonts); Kaava computes the full token set deterministically: OKLCH color ramps, semantic light/dark roles that are contrast-checked, type scale, spacing, radii, shadows, motion.

Typical flow:
1. kaava_create_system with a brief -> writes kaava.json (the source of truth) in the project root.
2. kaava_emit -> writes tokens for the project's stack (css, tailwind, scss, ts, dtcg) and DESIGN.md with usage rules.
3. Read DESIGN.md (or kaava_get_tokens) before writing UI, and use tokens instead of hard-coded values.
4. kaava_update_system to adjust the brief or override single tokens; previously emitted files are regenerated.

Never edit kaava.json or emitted files by hand; they are regenerated.`;

const projectRootArg = z
  .string()
  .optional()
  .describe('Absolute path of the project. Defaults to the first workspace root the client exposes, else the server working directory.');
const dryRunArg = z.boolean().optional().describe('Return the content that would be written instead of writing files.');

export interface ServerOptions {
  /** Fallback project root when the client exposes no roots. Defaults to process.cwd(). */
  cwd?: string;
}

export function createServer(options: ServerOptions = {}): McpServer {
  const cwd = options.cwd ?? process.cwd();
  const server = new McpServer({ name: 'kaava', title: 'Kaava', version: VERSION }, { instructions: INSTRUCTIONS });

  async function clientRoots(): Promise<string[]> {
    if (!server.server.getClientCapabilities()?.roots) return [];
    try {
      const { roots } = await server.server.listRoots();
      return roots.filter((r) => r.uri.startsWith('file://')).map((r) => fileURLToPath(r.uri));
    } catch {
      return [];
    }
  }

  async function projectRoot(requested?: string): Promise<string> {
    const roots = await clientRoots();
    if (!requested) return roots[0] ?? cwd;
    if (!path.isAbsolute(requested)) throw new Error(`projectRoot must be an absolute path (got "${requested}").`);
    const root = path.resolve(requested);
    if (roots.length > 0 && !roots.some((r) => isInside(r, root))) {
      throw new Error(`projectRoot ${root} is outside the workspace roots (${roots.join(', ')}).`);
    }
    return root;
  }

  // Clients send tool calls in parallel. Every tool reads or rewrites kaava.json, so calls run one at a
  // time; otherwise an emit could read the file while a create is still writing it.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  };

  /** Register a tool whose handler returns text; thrown errors become tool errors the model can act on. */
  function tool<S extends z.ZodRawShape>(
    name: string,
    config: { title: string; description: string; inputSchema: S; annotations: ToolAnnotations },
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<string>,
  ): void {
    const callback = (args: z.infer<z.ZodObject<S>>) =>
      exclusive(async () => {
        try {
          return { content: [{ type: 'text' as const, text: await handler(args) }] };
        } catch (err) {
          return { isError: true, content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }] };
        }
      });
    // The SDK's callback type is a conditional over its own zod-compat types and does not unify with a
    // generic shape parameter; the runtime contract (parsed args in, CallToolResult out) is what we return.
    server.registerTool(name, config, callback as never);
  }

  interface PlannedFile {
    relative: string;
    content: string;
  }

  /**
   * Render outputs and check every destination before anything is written: all paths must stay inside the
   * project, and a file Kaava did not generate is never replaced unless `overwrite` is set.
   */
  async function planOutputs(
    root: string,
    system: KaavaSystem,
    emit: NonNullable<KaavaSystem['emit']> | undefined,
    overwrite = false,
  ): Promise<PlannedFile[]> {
    if (!emit) return [];
    const files = renderTargets(system, emit.targets).map((f) => ({ relative: path.join(emit.outDir, f.file), content: f.content }));
    const foreign: string[] = [];
    for (const f of files) {
      const target = await resolveForWrite(root, f.relative);
      if (!overwrite && (await isForeignFile(target))) foreign.push(f.relative);
    }
    if (foreign.length) {
      throw new Error(
        `Not overwriting ${foreign.join(', ')}: ${foreign.length > 1 ? 'these files exist and were' : 'this file exists and was'} not generated by Kaava. Use a different outDir, move the file, or call kaava_emit with overwrite: true.`,
      );
    }
    return files;
  }

  async function writeAll(root: string, files: PlannedFile[]): Promise<string[]> {
    const written: string[] = [];
    for (const f of files) written.push(await writeProjectFile(root, f.relative, f.content));
    return written;
  }

  tool(
    'kaava_create_system',
    {
      title: 'Create design system',
      description:
        'Generate a complete design system from a short brief and save it as kaava.json in the project root. Only brandColor is required; mood picks sensible defaults for the rest. Returns a summary and a contrast report. Follow with kaava_emit to write tokens for the project stack.',
      inputSchema: {
        ...briefShape,
        overwrite: z.boolean().optional().describe('Replace an existing kaava.json. Without this, an existing system is left untouched.'),
        projectRoot: projectRootArg,
        dryRun: dryRunArg,
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ overwrite, projectRoot: requested, dryRun, ...briefInput }) => {
      const root = await projectRoot(requested);
      const brief = briefSchema.parse(briefInput);
      const existing = await readSystem(root).catch(() => 'invalid' as const);
      if (existing && !overwrite && !dryRun) {
        const what = existing === 'invalid' ? 'a kaava.json that could not be read' : `the design system "${existing.name}"`;
        throw new Error(
          `${root} already has ${what}. Use kaava_update_system to change it, or pass overwrite: true to replace it entirely.`,
        );
      }
      // Replacing a system keeps its emit configuration so outputs stay in sync.
      const emit = existing && existing !== 'invalid' ? existing.emit : undefined;
      const system = buildSystem(brief, {}, emit);
      if (dryRun) return `${summarize(system)}\n\nDry run, nothing written. kaava.json would be:\n\n${serializeSystem(system)}`;
      const outputs = await planOutputs(root, system, system.emit);
      const file = await writeProjectFile(root, SYSTEM_FILE, serializeSystem(system));
      const regenerated = await writeAll(root, outputs);
      return [
        `Created ${file}`,
        '',
        summarize(system),
        '',
        regenerated.length
          ? `Regenerated ${regenerated.length} emitted file(s) in ${system.emit!.outDir}/.`
          : 'Next: call kaava_emit with the targets for this project (e.g. ["css", "design-md"] or ["tailwind", "design-md"]).',
      ].join('\n');
    },
  );

  tool(
    'kaava_update_system',
    {
      title: 'Update design system',
      description:
        'Change the existing design system: patch brief fields (everything is re-derived) and/or override individual tokens. Files written earlier by kaava_emit are regenerated. Overrides are keyed by token path, e.g. {"radius.control": "{radius.full}", "dark:color.primary": "#8b9cff", "font.size.base": "1.0625rem"}; prefix semantic colors with "light:" or "dark:" to target one theme.',
      inputSchema: {
        brief: z.object(briefShape).partial().optional().describe('Brief fields to change. Omitted fields keep their current value.'),
        overrides: z.record(z.string(), z.string()).optional().describe('Token overrides to add or replace: path -> CSS value or "{other.token}".'),
        removeOverrides: z.array(z.string()).optional().describe('Override keys to remove, restoring the derived value.'),
        projectRoot: projectRootArg,
        dryRun: dryRunArg,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ brief: patch, overrides, removeOverrides, projectRoot: requested, dryRun }) => {
      const root = await projectRoot(requested);
      const current = await loadSystem(root);
      const brief: Brief = briefSchema.parse({
        ...current.brief,
        ...patch,
        ...(current.brief.fonts || patch?.fonts ? { fonts: { ...current.brief.fonts, ...patch?.fonts } } : {}),
      });
      const merged = { ...current.overrides, ...overrides };
      for (const key of removeOverrides ?? []) {
        if (!(key in merged)) throw new Error(`No override "${key}" to remove. Current overrides: ${Object.keys(merged).join(', ') || '(none)'}.`);
        delete merged[key];
      }
      const system = buildSystem(brief, merged, current.emit);
      if (dryRun) return `${summarize(system)}\n\nDry run, nothing written.`;
      const outputs = await planOutputs(root, system, system.emit);
      const file = await writeProjectFile(root, SYSTEM_FILE, serializeSystem(system));
      const regenerated = await writeAll(root, outputs);
      return [
        `Updated ${file}`,
        regenerated.length ? `Regenerated: ${regenerated.map((f) => path.relative(root, f)).join(', ')}` : 'No emitted files to regenerate yet (run kaava_emit).',
        '',
        summarize(system),
      ].join('\n');
    },
  );

  tool(
    'kaava_get_tokens',
    {
      title: 'Get tokens',
      description:
        'Look up tokens from the current design system. Without a path, returns the list of token groups. With a path prefix ("color", "color.primary", "palette.neutral", "font.size", "space", "radius", "shadow"), returns each token with its CSS variable and value. Semantic colors live under "color"; raw ramps under "palette".',
      inputSchema: {
        path: z.string().optional().describe('Token path or prefix, e.g. "color" or "font.size.lg".'),
        mode: z.enum(['light', 'dark']).optional().describe('Show only this theme for semantic colors. Default: both.'),
        projectRoot: projectRootArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: prefix, mode, projectRoot: requested }) => {
      const system = await loadSystem(await projectRoot(requested));
      const layers = layersOf(system);
      const all = [...layers.base.keys(), ...layers.light.keys()];
      if (!prefix) {
        const groups = new Map<string, number>();
        for (const p of all) {
          const g = p.split('.').slice(0, p.startsWith('palette.') || p.startsWith('font.') ? 2 : 1).join('.');
          groups.set(g, (groups.get(g) ?? 0) + 1);
        }
        return [
          `"${system.name}" has ${all.length} tokens. Groups (pass one as path):`,
          ...[...groups].map(([g, n]) => `- ${g} (${n})`),
          '',
          'Use semantic "color" tokens in UI; "palette" ramps are raw material.',
        ].join('\n');
      }
      const wanted = prefix.replace(/^--/, '').replace(/\.$/, '');
      const matches = all.filter((p) => p === wanted || p.startsWith(`${wanted}.`));
      if (matches.length === 0) {
        throw new Error(`No tokens under "${prefix}". Call kaava_get_tokens without a path to see the groups.`);
      }
      const show = (p: string, scope: Flat[]): string => {
        const token = scope.at(-1)!.get(p) ?? layers.base.get(p)!;
        const value = (q: string): string => cssValue(resolveToken(q, scope), value);
        const resolved = value(p);
        return isAlias(token.$value) ? `${resolved} (= ${aliasPath(token.$value)})` : resolved;
      };
      const lines = matches.map((p) => {
        if (layers.base.has(p)) return `${p}  ${cssVar(p)}  ${show(p, [layers.base])}`;
        const parts: string[] = [];
        if (mode !== 'dark') parts.push(`light ${show(p, [layers.base, layers.light])}`);
        if (mode !== 'light' && layers.dark) parts.push(`dark ${show(p, [layers.base, layers.dark])}`);
        const description = layers.light.get(p)?.$description;
        return `${p}  ${cssVar(p)}  ${parts.join(' | ')}${description ? `  — ${description}` : ''}`;
      });
      return lines.join('\n');
    },
  );

  tool(
    'kaava_emit',
    {
      title: 'Emit tokens',
      description:
        'Write the design system out for the project stack. Targets: "css" (custom properties, works with any framework), "tailwind" (Tailwind v4 @theme), "scss", "ts" (typed token object for React/Vue/Svelte/React Native), "dtcg" (W3C design tokens JSON for Figma/Style Dictionary), "design-md" (DESIGN.md usage rules for agents and people), "preview" (self-contained preview.html showing the system in use, for the user to open in a browser). The choice is remembered, so later kaava_update_system calls regenerate the same files.',
      inputSchema: {
        targets: z.array(z.enum(EMIT_TARGETS)).min(1).describe('Which outputs to write.'),
        outDir: z.string().optional().describe('Directory relative to the project root. Default: the directory used last time, else "kaava".'),
        overwrite: z.boolean().optional().describe('Replace existing files in outDir that Kaava did not generate. Without this, such files are left untouched and the call fails.'),
        projectRoot: projectRootArg,
        dryRun: dryRunArg,
      },
      annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ targets, outDir: requestedDir, overwrite, projectRoot: requested, dryRun }) => {
      const root = await projectRoot(requested);
      const system = await loadSystem(root);
      const outDir = requestedDir ?? system.emit?.outDir ?? 'kaava';
      const files = await planOutputs(root, system, { outDir, targets }, overwrite || dryRun);
      if (dryRun) {
        return files.map((f) => `===== ${f.relative} =====\n${f.content}`).join('\n');
      }
      const written = await writeAll(root, files);
      // Remember what was emitted where, so updates can regenerate it.
      const sameDir = system.emit?.outDir === outDir;
      const remembered = [...new Set<EmitTarget>([...(sameDir ? system.emit!.targets : []), ...targets])];
      await writeProjectFile(root, SYSTEM_FILE, serializeSystem({ ...system, emit: { outDir, targets: remembered } }));
      const hints: string[] = [];
      if (targets.includes('css')) hints.push(`Import ${path.join(outDir, 'tokens.css')} once at the app entry, then use var(--color-…), var(--space-…) etc.`);
      if (targets.includes('tailwind')) hints.push(`In the main stylesheet: @import "tailwindcss"; then @import "./${path.join(outDir, 'tailwind.css')}"; (adjust the relative path).`);
      if (targets.includes('preview')) hints.push(`Tell the user to open ${path.join(outDir, 'preview.html')} in a browser to see the system (append #dark or #light to force a theme).`);
      if (targets.includes('design-md')) hints.push(`Read ${path.join(outDir, 'DESIGN.md')} before writing UI, and reference it from CLAUDE.md / AGENTS.md so future sessions follow it.`);
      return [`Wrote ${written.length} file(s):`, ...written.map((f) => `- ${path.relative(root, f)}`), ...(hints.length ? ['', ...hints] : [])].join('\n');
    },
  );

  tool(
    'kaava_audit',
    {
      title: 'Audit contrast',
      description:
        'Check every promised foreground/background pairing of the current design system against WCAG 2.2 AA (4.5:1 text, 3:1 UI), in light and dark, and report APCA Lc for reference. Run after overriding colors.',
      inputSchema: {
        failuresOnly: z.boolean().optional().describe('List only failing pairs. Default false.'),
        projectRoot: projectRootArg,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ failuresOnly, projectRoot: requested }) => {
      const system = await loadSystem(await projectRoot(requested));
      const results = auditContrast(layersOf(system));
      const rows = results
        .filter((r) => !failuresOnly || !r.pass)
        .map((r) => `${r.pass ? 'pass' : 'FAIL'}  [${r.mode}] ${r.fg} on ${r.bg}  ${r.ratio}:1 (min ${r.min}:1, APCA Lc ${r.apca})  ${r.fgHex} / ${r.bgHex}`);
      return [contrastSummary(results), ...(rows.length ? ['', ...rows] : [])].join('\n');
    },
  );

  server.registerResource(
    'system',
    'kaava://system',
    { title: 'Current design system', description: 'kaava.json of the current project: brief, overrides and all tokens.', mimeType: 'application/json' },
    async (uri) => {
      const system = await loadSystem(await projectRoot());
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: serializeSystem(system) }] };
    },
  );

  server.registerResource(
    'presets',
    'kaava://presets',
    { title: 'Mood presets', description: 'The moods accepted by kaava_create_system and the defaults each one sets.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ default: DEFAULT_PRESET, moods: PRESETS }, null, 2) }],
    }),
  );

  server.registerPrompt(
    'new-design-system',
    {
      title: 'New design system',
      description: 'Interview the user briefly, then generate a design system for this project with Kaava.',
      argsSchema: { product: z.string().optional().describe('What the product is, if already known.') },
    },
    ({ product }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Set up a design system for this project with Kaava.${product ? `\n\nThe product: ${product}` : ''}

1. Look at the project first: framework, styling approach (Tailwind version, CSS modules, SCSS, CSS-in-JS), any existing brand colors, fonts or logo assets. Reuse what is already decided.
2. Ask me only what you cannot infer, in one round: what the product is and who uses it, the brand color (or let me pick from 3 options you propose with hex values), and the feel. Moods available: ${Object.entries(PRESETS)
              .map(([name, p]) => `${name} (${p.description.split(':')[0]!.toLowerCase()})`)
              .join(', ')}.
3. Call kaava_create_system. Read the contrast report; if anything fails, adjust and say what you changed.
4. Call kaava_emit with the targets that match the stack, always including "design-md".
5. Wire it in: import the emitted file at the app entry, and add a line to CLAUDE.md / AGENTS.md pointing at DESIGN.md.
6. Show me the key colors and type scale, and offer one or two concrete adjustments (kaava_update_system) rather than an open question.`,
          },
        },
      ],
    }),
  );

  return server;
}

function summarize(system: KaavaSystem): string {
  const b = resolveBrief(system.brief);
  const layers = layersOf(system);
  const hex = (layer: Flat | undefined, role: string): string =>
    layer?.has(`color.${role}`) ? (resolveToken(`color.${role}`, [layers.base, layer]).$value as ColorValue).hex : '';
  const roles = ['bg', 'surface', 'fg', 'fg-muted', 'border', 'primary', 'on-primary', 'primary-text', 'accent', 'danger'];
  const sizes = [...layers.base.entries()]
    .filter(([p]) => p.startsWith('font.size.'))
    .map(([p, t]) => `${p.split('.')[2]} ${cssValue(t, (q) => q)}`);
  const overrides = Object.keys(system.overrides ?? {});
  return [
    `"${system.name}"${b.mood ? ` · mood ${b.mood}` : ''} · density ${b.density} · radius ${b.radius} · shadows ${b.shadows} · neutral tint ${b.neutralTint} · ${layers.dark ? 'light + dark' : 'light only'}`,
    '',
    `Colors (light${layers.dark ? ' | dark' : ''}):`,
    ...roles.map((r) => `  ${r.padEnd(13)}${hex(layers.light, r)}${layers.dark ? ` | ${hex(layers.dark, r)}` : ''}`),
    `Type (ratio ${b.typeScale}): ${sizes.join(', ')}`,
    ...(overrides.length ? [`Overrides: ${overrides.join(', ')}`] : []),
    contrastSummary(auditContrast(layers)),
    `${layers.base.size + layers.light.size} tokens total; browse with kaava_get_tokens.`,
  ].join('\n');
}
