/** W3C Design Tokens (DTCG) subset used by Kaava, plus helpers for flat <-> tree and CSS values. */

export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'number'
  | 'duration'
  | 'cubicBezier'
  | 'shadow';

export interface ColorValue {
  colorSpace: 'oklch';
  components: [number, number, number];
  alpha?: number;
  hex: string;
}
export interface Dimension {
  value: number;
  unit: 'px' | 'rem';
}
export interface Duration {
  value: number;
  unit: 'ms';
}
export interface ShadowLayer {
  color: ColorValue;
  offsetX: Dimension;
  offsetY: Dimension;
  blur: Dimension;
  spread: Dimension;
}

/** An alias is a string of the form `{path.to.token}`. */
export type TokenValue = string | ColorValue | Dimension | Duration | string[] | number | number[] | ShadowLayer[];

export interface Token {
  $type: TokenType;
  $value: TokenValue;
  $description?: string;
}
export interface TokenGroup {
  [key: string]: Token | TokenGroup;
}

/** Tokens keyed by dotted path, in insertion order. */
export type Flat = Map<string, Token>;

export const isAlias = (v: unknown): v is string => typeof v === 'string' && /^\{[^{}]+\}$/.test(v);
export const aliasPath = (v: string): string => v.slice(1, -1);
export const alias = (path: string): string => `{${path}}`;

const isToken = (v: unknown): v is Token => typeof v === 'object' && v !== null && '$value' in v;

export function toTree(flat: Flat): TokenGroup {
  const root: TokenGroup = {};
  for (const [path, token] of flat) {
    const parts = path.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= {}) as TokenGroup;
    }
    node[parts.at(-1)!] = token;
  }
  return root;
}

export function flatten(tree: TokenGroup, prefix = '', out: Flat = new Map()): Flat {
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith('$')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isToken(value)) out.set(path, value);
    else if (typeof value === 'object' && value !== null) flatten(value, path, out);
  }
  return out;
}

/** Look a token up through layers; later layers win (e.g. [base, light]). */
export function lookup(path: string, layers: Flat[]): Token | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const t = layers[i]!.get(path);
    if (t) return t;
  }
  return undefined;
}

/** Follow aliases until a concrete token is reached. */
export function resolveToken(path: string, layers: Flat[]): Token {
  const seen = new Set<string>();
  let current = path;
  for (;;) {
    if (seen.has(current)) throw new Error(`Circular token alias at "${current}"`);
    seen.add(current);
    const token = lookup(current, layers);
    if (!token) throw new Error(`Unknown token "${current}"${current === path ? '' : ` (aliased from "${path}")`}`);
    if (!isAlias(token.$value)) return token;
    current = aliasPath(token.$value);
  }
}

const num = (n: number): string => String(Number(n.toFixed(4)));

export function colorCss(c: ColorValue): string {
  if (c.alpha === undefined || c.alpha >= 1) return c.hex;
  const a = Math.round(Math.max(0, c.alpha) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${c.hex}${a}`;
}

const dimCss = (d: Dimension): string => (d.value === 0 ? '0' : `${num(d.value)}${d.unit}`);

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
]);

const familyCss = (name: string): string =>
  GENERIC_FAMILIES.has(name) || /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;

/**
 * CSS text for a token value. Aliases are rendered through `ref` so each emitter
 * decides whether that is `var(--x)`, `$x`, or a fully resolved value.
 */
export function cssValue(token: Token, ref: (path: string) => string): string {
  const v = token.$value;
  if (isAlias(v)) return ref(aliasPath(v));
  switch (token.$type) {
    case 'color':
      return colorCss(v as ColorValue);
    case 'dimension':
      return dimCss(v as Dimension);
    case 'duration':
      return `${num((v as Duration).value)}ms`;
    case 'fontFamily':
      return (v as string[]).map(familyCss).join(', ');
    case 'fontWeight':
    case 'number':
      return num(v as number);
    case 'cubicBezier':
      return `cubic-bezier(${(v as number[]).map(num).join(', ')})`;
    case 'shadow': {
      const layers = v as ShadowLayer[];
      if (layers.every((l) => (l.color.alpha ?? 1) === 0)) return 'none';
      return layers
        .map((l) => [dimCss(l.offsetX), dimCss(l.offsetY), dimCss(l.blur), dimCss(l.spread), colorCss(l.color)].join(' '))
        .join(', ');
    }
  }
}
