// Refreshes workbench/google-fonts.json, the catalogue of Google Fonts families the workbench lists and
// autocompletes. Run with `npm run fonts`. It reads Google Fonts' public metadata; no API key is needed.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://fonts.google.com/metadata/fonts';
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workbench', 'google-fonts.json');

/**
 * Google's metadata -> catalogue entries [family, category, weights], most popular first.
 * weights is "min..max" when the family has a variable weight axis, else its upright weights.
 * Families with no upright face are left out: a style needs a regular weight.
 */
export function toCatalogue(metadata) {
  return [...metadata.familyMetadataList]
    .sort((a, b) => a.popularity - b.popularity)
    .flatMap((f) => {
      const axis = f.axes?.find((a) => a.tag === 'wght');
      const upright = Object.keys(f.fonts).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
      if (upright.length === 0) return [];
      return [[f.family, f.category, axis ? `${axis.min}..${axis.max}` : upright]];
    });
}

/** One entry per line, so a refresh shows up in a diff as the families that changed. */
export function formatCatalogue(fonts, updated) {
  return `{\n"source": ${JSON.stringify(SOURCE)},\n"updated": ${JSON.stringify(updated)},\n"fonts": [\n${fonts.map((f) => JSON.stringify(f)).join(',\n')}\n]\n}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = await fetch(SOURCE);
  if (!response.ok) throw new Error(`${SOURCE} answered ${response.status}.`);
  // The endpoint has at times prefixed its JSON with an anti-hijacking line.
  const text = (await response.text()).replace(/^\)\]\}'?\n/, '');
  const fonts = toCatalogue(JSON.parse(text));
  if (fonts.length < 1000) throw new Error(`Only ${fonts.length} families came back; keeping the existing catalogue.`);
  writeFileSync(target, formatCatalogue(fonts, new Date().toISOString().slice(0, 10)));
  console.log(`workbench/google-fonts.json: ${fonts.length} families`);
}
