// Regenerates examples/ from the briefs below, through Kaava's public programmatic API.
// Run with `npm run examples`. test/examples.test.ts fails when the committed files are stale.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystem, EMIT_TARGETS, renderTargets } from '../dist/lib.mjs';

const OUT_DIR = 'kaava';

/** folder -> brief. The names are Finnish, like Kaava itself: ahtaaja is a stevedore, hinaaja a tugboat. */
const EXAMPLES = {
  ahtaaja: {
    name: 'Ahtaaja',
    description: 'Deploy dashboard for small product teams.',
    brandColor: '#4f46e5',
    style: 'friendly',
  },
  hinaaja: {
    name: 'Hinaaja',
    description: 'CI runner that pulls your builds through the pipeline.',
    brandColor: '#ffd400',
    style: 'playful',
  },
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

for (const [folder, brief] of Object.entries(EXAMPLES)) {
  const system = buildSystem(brief, {}, { outDir: OUT_DIR, targets: [...EMIT_TARGETS] });
  const dir = path.join(root, folder);
  await mkdir(path.join(dir, OUT_DIR), { recursive: true });
  await writeFile(path.join(dir, 'kaava.json'), `${JSON.stringify(system, null, 2)}\n`);
  const files = renderTargets(system, EMIT_TARGETS);
  for (const { file, content } of files) await writeFile(path.join(dir, OUT_DIR, file), content);
  console.log(`examples/${folder}: kaava.json + ${files.length} files`);
}
