import type { KaavaSystem, Layers } from '../engine/resolve.js';
import { cssValue, resolveToken, type Flat } from '../tokens.js';
import { cssVar, HEADER } from './names.js';

type Tree = { [key: string]: string | Tree };

/** Nested object of fully resolved CSS strings (no var() references), for JS-side styling and native targets. */
function resolvedTree(layer: Flat, scope: Flat[]): Tree {
  const root: Tree = {};
  const value = (path: string): string => cssValue(resolveToken(path, scope), value);
  for (const path of layer.keys()) {
    const parts = path.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Tree;
    node[parts.at(-1)!] = value(path);
  }
  return root;
}

export function emitTs(system: KaavaSystem, layers: Layers): string {
  const json = (v: unknown): string => JSON.stringify(v, null, 2);
  const vars: Record<string, string> = {};
  for (const path of [...layers.base.keys(), ...layers.light.keys()]) vars[path] = `var(${cssVar(path)})`;
  return [
    `// ${HEADER(system.name)}`,
    '',
    '/** Mode-independent tokens, resolved to CSS values. */',
    `export const tokens = ${json(resolvedTree(layers.base, [layers.base]))} as const;`,
    '',
    '/** Semantic colors per theme, resolved to hex. */',
    `export const light = ${json(resolvedTree(layers.light, [layers.base, layers.light]))} as const;`,
    '',
    ...(layers.dark
      ? [`export const dark = ${json(resolvedTree(layers.dark, [layers.base, layers.dark]))} as const;`, '']
      : []),
    '/** Token path -> CSS custom property reference, for use with the emitted tokens.css. */',
    `export const vars = ${json(vars)} as const;`,
    '',
    'export type TokenPath = keyof typeof vars;',
    '',
  ].join('\n');
}
