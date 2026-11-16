import { layersOf, type KaavaSystem } from '../engine/resolve.js';
import type { EmitTarget } from '../schema.js';
import { emitCss, emitScss, emitTailwind } from './css.js';
import { emitDesignMd } from './designMd.js';
import { HEADER } from './names.js';
import { emitPreview } from './preview.js';
import { emitShadcn } from './shadcn.js';
import { emitTs } from './ts.js';

export interface EmittedFile {
  /** File name relative to the output directory. */
  file: string;
  content: string;
}

export function renderTargets(system: KaavaSystem, targets: readonly EmitTarget[]): EmittedFile[] {
  const layers = layersOf(system);
  const files: EmittedFile[] = [];
  for (const target of new Set(targets)) {
    switch (target) {
      case 'css':
        files.push({ file: 'tokens.css', content: emitCss(system, layers) });
        break;
      case 'tailwind':
        files.push({ file: 'tailwind.css', content: emitTailwind(system, layers) });
        break;
      case 'shadcn':
        files.push({ file: 'shadcn.css', content: emitShadcn(system, layers) });
        break;
      case 'scss':
        files.push({ file: '_tokens.scss', content: emitScss(system, layers) });
        break;
      case 'ts':
        files.push({ file: 'tokens.ts', content: emitTs(system, layers) });
        break;
      case 'dtcg': {
        const json = (tree: object): string => `${JSON.stringify({ $description: HEADER(system.name), ...tree }, null, 2)}\n`;
        files.push({ file: 'tokens.json', content: json({ ...system.tokens, ...system.modes.light }) });
        if (system.modes.dark) files.push({ file: 'tokens.dark.json', content: json(system.modes.dark) });
        break;
      }
      case 'design-md':
        files.push({ file: 'DESIGN.md', content: emitDesignMd(system, layers) });
        break;
      case 'preview':
        files.push({ file: 'preview.html', content: emitPreview(system, layers) });
        break;
    }
  }
  return files;
}
