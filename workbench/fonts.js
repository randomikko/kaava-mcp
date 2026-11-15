// What the workbench knows about Google Fonts. Pure functions, shared by the page and the tests.
// A catalogue entry is [family, category, weights]: weights is "min..max" for a variable font,
// otherwise the list of upright weights the family ships.

/** The first family of a font stack, without quotes: `"Fraunces", serif` -> `Fraunces`. */
export function primaryFamily(value) {
  return (value ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}

/** Catalogue lookup by family name, ignoring case. */
export function indexFonts(fonts) {
  return new Map(fonts.map((font) => [font[0].toLowerCase(), font]));
}

const familyParam = (family) => encodeURIComponent(family).replace(/%20/g, '+');

/**
 * Stylesheet URL for a family with every upright weight it has: the whole range of a variable font, or
 * the weights the catalogue lists, so the URL never names a weight the family lacks.
 */
export function googleFontUrl([family, , weights]) {
  const spec = typeof weights === 'string' ? `:wght@${weights}` : weights.length > 1 || (weights.length === 1 && weights[0] !== 400) ? `:wght@${weights.join(';')}` : '';
  return `https://fonts.googleapis.com/css2?family=${familyParam(family)}${spec}&display=swap`;
}

/** Stylesheet URL that loads only the glyphs needed to show a family's own name. */
export function sampleUrl(family) {
  return `https://fonts.googleapis.com/css2?family=${familyParam(family)}&text=${encodeURIComponent(family)}&display=swap`;
}

/** Families a Google Fonts stylesheet URL loads; empty for any other URL. */
export function urlFamilies(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'fonts.googleapis.com') return [];
    return parsed.searchParams.getAll('family').map((f) => f.split(':')[0]);
  } catch {
    return [];
  }
}

/**
 * Web font URLs after one of the family fields changed from `previous`. A Google family now in use gets
 * its stylesheet; the stylesheet of the family that was replaced goes, unless another field still uses it.
 * URLs for anything else are left alone.
 */
export function syncWebfonts(webfonts, families, previous, index) {
  const known = (value) => index.get(primaryFamily(value).toLowerCase());
  const used = new Set(Object.values(families).map(known).filter(Boolean).map((font) => font[0]));
  const old = known(previous)?.[0];
  const kept = old && !used.has(old) ? webfonts.filter((url) => !(urlFamilies(url).length === 1 && urlFamilies(url)[0] === old)) : [...webfonts];
  const loaded = new Set(kept.flatMap(urlFamilies));
  for (const family of used) if (!loaded.has(family)) kept.push(googleFontUrl(index.get(family.toLowerCase())));
  return kept;
}

/** Catalogue entries matching a search text and a category ('' = any), in catalogue order. */
export function filterFonts(fonts, query, category) {
  const q = query.trim().toLowerCase();
  return fonts.filter(([family, cat]) => (!category || cat === category) && (!q || family.toLowerCase().includes(q)));
}
