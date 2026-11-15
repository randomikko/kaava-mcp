import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderTargets } from '../src/emit/index.js';
import { buildSystem, type KaavaSystem } from '../src/engine/resolve.js';
import { serializeSystem } from '../src/project.js';
import { EMIT_TARGETS } from '../src/schema.js';

const root = fileURLToPath(new URL('../examples', import.meta.url));
const folders = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const STALE = 'is out of date. Run `npm run examples` and commit the result.';

describe('committed examples', () => {
  it('exist', () => {
    expect(folders).toEqual(['ahtaaja', 'hinaaja']);
  });

  it.each(folders)('%s matches what the engine generates today', (folder) => {
    const dir = path.join(root, folder);
    const saved = JSON.parse(readFileSync(path.join(dir, 'kaava.json'), 'utf8')) as KaavaSystem;
    const system = buildSystem(saved.brief, saved.overrides ?? {}, saved.emit);
    expect(readFileSync(path.join(dir, 'kaava.json'), 'utf8'), `examples/${folder}/kaava.json ${STALE}`).toBe(serializeSystem(system));

    expect(saved.emit!.targets).toEqual([...EMIT_TARGETS]);
    const outDir = path.join(dir, saved.emit!.outDir);
    const rendered = renderTargets(system, saved.emit!.targets);
    for (const { file, content } of rendered) {
      const target = path.join(outDir, file);
      const label = `examples/${folder}/${saved.emit!.outDir}/${file} ${STALE}`;
      expect(existsSync(target), label).toBe(true);
      expect(readFileSync(target, 'utf8'), label).toBe(content);
    }
    // Nothing left behind from an output Kaava no longer writes.
    expect(readdirSync(outDir).sort()).toEqual(rendered.map((f) => f.file).sort());
  });
});
