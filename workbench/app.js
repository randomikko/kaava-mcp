// Kaava workbench: edit a style, watch the real engine render it, save it to styles/.
import * as kaava from '/engine.js';
import { filterFonts, googleFontUrl, indexFonts, primaryFamily, sampleUrl, syncWebfonts } from '/fonts.js';

const RAMP = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const SIZES = kaava.TYPE_STEPS;
const BRANDS = ['#4f46e5', '#ffd400', '#dc2626', '#059669', '#111111', '#f4c2d7'];
const SURFACE_STEPS = ['white', ...RAMP, 'black'];
const RADII = ['none', 'sm', 'md', 'lg', 'xl', 'full'];
const FONT_ROLES = [['sans', 'Sans'], ['display', 'Display'], ['mono', 'Mono']];
const FONT_PAGE = 40;

/** The Google Fonts catalogue from workbench/google-fonts.json: entries are [family, category, weights]. */
const catalogue = { fonts: [], index: new Map(), updated: '' };
/** What the font browser shows; kept here so it survives the controls being rebuilt. */
const browser = { open: false, query: '', category: '', shown: FONT_PAGE, scroll: 0 };

const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Tiny element builder: h('div', { class: 'row' }, child, 'text'). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const state = {
  list: [],
  style: null,
  saved: '', // JSON of the style as last loaded or saved, for the unsaved-changes check
  brand: BRANDS[0],
  theme: 'light',
  idFollowsName: false,
  error: '',
};

const get = (path) => path.reduce((node, key) => node[key], state.style);
function set(path, value) {
  const parent = path.slice(0, -1).reduce((node, key) => node[key], state.style);
  parent[path.at(-1)] = value;
  schedule();
}
const dirty = () => JSON.stringify(state.style) !== state.saved;

// ---------- controls ----------

/** A labelled number with a slider, bound to a path in the style. */
function number(label, path, { min, max, step = 1, slider = true }) {
  const value = get(path);
  const range = slider && h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const box = h('input', { type: 'number', min, max, step, value, 'aria-label': label });
  const update = (source, other) => () => {
    if (source.value === '' || Number.isNaN(Number(source.value))) return;
    if (other) other.value = source.value;
    set(path, Number(source.value));
  };
  if (range) range.addEventListener('input', update(range, box));
  box.addEventListener('input', update(box, range));
  return h('label', { class: 'row' }, h('span', {}, label), range || h('span'), box);
}

function text(label, path, { placeholder = '', optional = false, multiline = false, list, oninput, onchange } = {}) {
  const input = h(multiline ? 'textarea' : 'input', { ...(multiline ? { rows: 2 } : { type: 'text', list }), placeholder, spellcheck: 'false' });
  input.value = get(path) ?? '';
  input.addEventListener('input', () => {
    const value = input.value;
    if (optional && value.trim() === '') {
      const parent = path.slice(0, -1).reduce((node, key) => node[key], state.style);
      delete parent[path.at(-1)];
      schedule();
    } else set(path, value);
    oninput?.(value);
  });
  if (onchange) input.addEventListener('change', () => onchange(input.value));
  return h('label', { class: 'text' }, h('span', {}, label), input);
}

function select(label, path, options) {
  const el = h('select', {}, options.map((o) => h('option', { value: String(o) }, String(o))));
  el.value = String(get(path));
  el.addEventListener('change', () => {
    const raw = el.value;
    set(path, options.find((o) => String(o) === raw));
    if (path.join('.') === 'space.density') buildControls();
  });
  return h('label', { class: 'text' }, h('span', {}, label), el);
}

/** Eleven vertical sliders, one per ramp step, with the resulting ramp drawn above them. */
function curve(path, { min, max, step }, swatchKey) {
  return h(
    'div',
    { class: 'curve' },
    RAMP.map((stepName, i) => {
      const range = h('input', { type: 'range', min, max, step, value: get([...path, i]), 'aria-label': `Step ${stepName}` });
      const box = h('input', { type: 'number', min, max, step, value: get([...path, i]), 'aria-label': `Step ${stepName}` });
      range.addEventListener('input', () => { box.value = range.value; set([...path, i], Number(range.value)); });
      box.addEventListener('input', () => { if (box.value !== '') { range.value = box.value; set([...path, i], Number(box.value)); } });
      return h('div', { class: 'col' }, h('div', { class: 'sw', 'data-swatch': `${swatchKey}.${stepName}` }), range, box, h('span', { class: 'step' }, String(stepName)));
    }),
  );
}

/** A grid of plain number cells: rows × columns bound to paths. */
function cells(columns, rows) {
  const grid = h('div', { class: 'cells', style: `grid-template-columns: 4.5rem repeat(${columns.length}, 1fr)` }, h('span'), columns.map((c) => h('span', { class: 'head' }, c.label)));
  for (const row of rows) {
    grid.append(h('span', { class: 'label' }, row.label));
    for (const column of columns) {
      const path = column.path(row);
      if (!path) { grid.append(h('span')); continue; }
      const box = h('input', { type: 'number', step: column.step, min: column.min, max: column.max, value: get(path), 'aria-label': `${row.label} ${column.label}` });
      if (column.readonly?.()) { box.disabled = true; box.dataset.computed = row.key; }
      box.addEventListener('input', () => { if (box.value !== '') set(path, Number(box.value)); });
      grid.append(box);
    }
  }
  return grid;
}

function section(title, open, ...children) {
  return h('details', open ? { open: true } : {}, h('summary', {}, title), h('div', { class: 'group' }, children));
}
const sub = (label) => h('div', { class: 'sub' }, label);
const hint = (label) => h('p', { class: 'hint' }, label);

function identityControls() {
  const idRow = text('Id', ['id'], { oninput: () => { state.idFollowsName = false; } });
  const idInput = idRow.querySelector('input');
  const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return section(
    'Identity',
    true,
    text('Name', ['name'], { oninput: (name) => { if (state.idFollowsName && slug(name)) { idInput.value = slug(name); set(['id'], slug(name)); } } }),
    idRow,
    text('Author', ['author'], { oninput: (author) => localStorage.setItem('kaava.author', author) }),
    text('Description', ['description'], { multiline: true }),
    hint('The id is the file name in styles/ and what a brief asks for. Saving under a new id creates a new style.'),
  );
}

function colorControls() {
  const status = ['success', 'warning', 'danger', 'info'].flatMap((name) => [
    h('div', { class: 'sub' }, h('i', { class: 'swatch-dot', 'data-swatch': `${name}.500` }), name),
    number('Hue', ['color', 'status', name, 'hue'], { min: 0, max: 360, step: 1 }),
    number('Chroma', ['color', 'status', name, 'chroma'], { min: 0, max: 0.3, step: 0.005 }),
  ]);
  const surface = (mode) => [
    sub(`${mode} surfaces · neutral step`),
    select('Page', ['color', 'surfaces', mode, 'bg'], SURFACE_STEPS),
    select('Raised surface', ['color', 'surfaces', mode, 'surface'], SURFACE_STEPS),
    select('Muted fill', ['color', 'surfaces', mode, 'muted'], SURFACE_STEPS),
  ];
  return section(
    'Color',
    true,
    sub('Lightness per step · shown on the brand ramp'),
    curve(['color', 'lightness'], { min: 0, max: 1, step: 0.005 }, 'primary'),
    sub('Chroma share per step · shown on the neutral ramp'),
    curve(['color', 'chroma'], { min: 0, max: 1.2, step: 0.01 }, 'neutral'),
    number('Neutral tint', ['color', 'neutralTint'], { min: 0, max: 1, step: 0.01 }),
    number('Accent hue shift', ['color', 'accentShift'], { min: -180, max: 180, step: 1 }),
    surface('light'),
    surface('dark'),
    status,
  );
}

function typeControls() {
  const ratioMode = 'ratio' in state.style.type.scale;
  const mode = h('select', {}, h('option', { value: 'ratio' }, 'Modular ratio'), h('option', { value: 'sizes' }, 'Hand-set sizes'));
  mode.value = ratioMode ? 'ratio' : 'sizes';
  mode.addEventListener('change', () => {
    // Switching to hand-set starts from the sizes the ratio currently produces.
    state.style.type.scale = mode.value === 'ratio' ? { ratio: 1.2 } : { sizes: [...kaava.typeSizes(state.style.type.scale)] };
    buildControls();
    schedule();
  });
  const webfonts = h('textarea', { rows: 2, spellcheck: 'false', placeholder: 'One stylesheet URL per line' });
  webfonts.value = state.style.type.webfonts.join('\n');
  webfonts.addEventListener('input', () => set(['type', 'webfonts'], webfonts.value.split('\n').map((l) => l.trim()).filter(Boolean)));

  /** A family field. Choosing a Google family adds its stylesheet and drops the one it replaced. */
  const family = (key, label, placeholder) => {
    let previous = state.style.type.families[key];
    return text(label, ['type', 'families', key], {
      optional: true,
      placeholder,
      list: 'google-fonts',
      onchange: (value) => {
        const next = syncWebfonts(state.style.type.webfonts, state.style.type.families, previous, catalogue.index);
        previous = value;
        if (next.join('\n') === state.style.type.webfonts.join('\n')) return;
        // Updated in place: rebuilding the controls here would take the focus away mid-tab.
        webfonts.value = next.join('\n');
        set(['type', 'webfonts'], next);
      },
    });
  };

  const google = h('input', { type: 'text', list: 'google-fonts', placeholder: 'Google Fonts family, e.g. Fraunces', spellcheck: 'false' });
  const addGoogle = () => {
    const name = google.value.trim();
    if (!name) return;
    const known = catalogue.index.get(name.toLowerCase());
    const url = known ? googleFontUrl(known) : `https://fonts.googleapis.com/css2?family=${name.replace(/\s+/g, '+')}:wght@400;500;600;700&display=swap`;
    if (!state.style.type.webfonts.includes(url)) state.style.type.webfonts.push(url);
    google.value = '';
    buildControls();
    schedule();
  };

  return section(
    'Type',
    true,
    family('sans', 'Sans', 'system UI font'),
    family('display', 'Display', 'same as sans'),
    family('mono', 'Mono', 'system monospace'),
    hint('One name gets a system fallback added. A Google Fonts family gets its stylesheet added below; any other web font needs one there, or the browser falls back.'),
    catalogue.fonts.length > 0 && fontBrowser(),
    h('div', { class: 'inline' }, google, h('button', { type: 'button', onclick: addGoogle }, 'Add web font')),
    h('label', { class: 'text' }, h('span', {}, 'Web font CSS'), webfonts),
    h('label', { class: 'text' }, h('span', {}, 'Sizes'), mode),
    ratioMode && number('Ratio', ['type', 'scale', 'ratio'], { min: 1.067, max: 1.5, step: 0.001 }),
    cells(
      [
        { label: 'size rem', step: 0.005, min: 0.5, max: 8, path: (r) => (ratioMode ? ['__computed', r.i] : ['type', 'scale', 'sizes', r.i]), readonly: () => ratioMode },
        { label: 'line height', step: 0.01, min: 0.9, max: 2.2, path: (r) => ['type', 'lineHeights', r.i] },
        { label: 'tracking em', step: 0.005, min: -0.1, max: 0.3, path: (r) => ['type', 'tracking', r.i] },
      ],
      SIZES.map((label, i) => ({ label, key: label, i })),
    ),
    sub('Weights'),
    cells([{ label: 'weight', step: 50, min: 100, max: 900, path: (r) => ['type', 'weights', r.key] }], ['regular', 'medium', 'semibold', 'bold'].map((key) => ({ label: key, key }))),
    select('Heading weight', ['type', 'headingWeight'], ['regular', 'medium', 'semibold', 'bold']),
  );
}

/** Every Google Fonts family, searchable, each shown in its own typeface with a button per role. */
function fontBrowser() {
  const categories = [...new Set(catalogue.fonts.map((f) => f[1]))].sort();
  const use = (key, name) => {
    const previous = state.style.type.families[key];
    state.style.type.families[key] = name;
    state.style.type.webfonts = syncWebfonts(state.style.type.webfonts, state.style.type.families, previous, catalogue.index);
    buildControls();
    schedule();
  };
  const row = ([name, category, weights]) => {
    loadSample(name);
    const sample = h('span', { class: 'name' }, name);
    sample.style.fontFamily = `${JSON.stringify(name)}, ui-sans-serif, system-ui, sans-serif`;
    const detail = `${category} · ${typeof weights === 'string' ? `${weights.replace('..', '–')} variable` : weights.join(', ')}`;
    return h(
      'div',
      { class: 'font' },
      sample,
      h('span', { class: 'detail' }, detail),
      h(
        'span',
        { class: 'roles' },
        FONT_ROLES.map(([key, label]) => {
          const active = primaryFamily(state.style.type.families[key]).toLowerCase() === name.toLowerCase();
          return h('button', { type: 'button', 'aria-pressed': String(active), title: `Use ${name} as the ${key} family`, onclick: () => use(key, name) }, label);
        }),
      ),
    );
  };

  const count = h('p', { class: 'hint', role: 'status' });
  const results = h('div', { class: 'fonts' });
  results.addEventListener('scroll', () => { browser.scroll = results.scrollTop; });
  const render = () => {
    const matches = filterFonts(catalogue.fonts, browser.query, browser.category);
    const more = matches.length - browser.shown;
    results.replaceChildren(
      ...matches.slice(0, browser.shown).map(row),
      ...(more > 0 ? [h('button', { type: 'button', onclick: () => { browser.shown += FONT_PAGE; render(); } }, `Show ${Math.min(FONT_PAGE, more)} more`)] : []),
    );
    count.textContent = `${matches.length.toLocaleString('en')} of ${catalogue.fonts.length.toLocaleString('en')} families, most used first. Catalogue from ${catalogue.updated}.`;
  };
  const refine = (key) => (event) => {
    browser[key] = event.target.value;
    browser.shown = FONT_PAGE;
    browser.scroll = 0;
    render();
  };
  const search = h('input', { type: 'search', placeholder: 'Search families', spellcheck: 'false', 'aria-label': 'Search Google Fonts families', oninput: refine('query') });
  search.value = browser.query;
  const category = h('select', { 'aria-label': 'Category', onchange: refine('category') }, h('option', { value: '' }, 'All categories'), categories.map((c) => h('option', { value: c }, c)));
  category.value = browser.category;

  // The list is only built once the browser is opened: every row loads a small font sample.
  const box = h('details', { class: 'browser', ...(browser.open ? { open: true } : {}) }, h('summary', {}, `Browse Google Fonts · ${catalogue.fonts.length.toLocaleString('en')}`), h('div', { class: 'inline' }, search, category), count, results);
  box.addEventListener('toggle', () => {
    browser.open = box.open;
    if (box.open && !results.hasChildNodes()) render();
  });
  if (browser.open) {
    render();
    requestAnimationFrame(() => { results.scrollTop = browser.scroll; });
  }
  return box;
}

const sampled = new Set();
/** Load the few glyphs needed to draw a family's name in its own typeface. */
function loadSample(name) {
  if (sampled.has(name)) return;
  sampled.add(name);
  document.head.append(h('link', { rel: 'stylesheet', href: sampleUrl(name) }));
}

function spaceControls() {
  const density = state.style.space.density;
  return section(
    'Space',
    false,
    select('Density', ['space', 'density'], ['compact', 'comfortable', 'spacious']),
    hint(`Editing "${density}", the density this style is designed for. A brief can ask for another one; switch here to tune each.`),
    sub('Control heights · px'),
    cells([{ label: 'height', step: 1, min: 16, max: 96, path: (r) => ['space', 'densities', density, 'control', r.i] }], ['sm', 'md', 'lg'].map((label, i) => ({ label, i }))),
    sub('Rhythm · steps of 4px'),
    number('Control padding', ['space', 'densities', density, 'padX'], { min: 0, max: 12, step: 1 }),
    number('Gap', ['space', 'densities', density, 'gap'], { min: 0, max: 12, step: 1 }),
    number('Inset', ['space', 'densities', density, 'inset'], { min: 0, max: 24, step: 1 }),
    number('Section', ['space', 'densities', density, 'section'], { min: 0, max: 24, step: 1 }),
  );
}

function shapeControls() {
  return section(
    'Shape',
    false,
    ['sm', 'md', 'lg', 'xl'].map((name) => number(`Radius ${name}`, ['shape', 'radius', name], { min: 0, max: 40, step: 0.5 })),
    select('Controls use', ['shape', 'control'], RADII),
    select('Surfaces use', ['shape', 'surface'], RADII),
    number('Border width', ['shape', 'borderWidth'], { min: 0, max: 4, step: 0.5 }),
  );
}

function elevationControls() {
  const level = (name) => {
    const layers = state.style.elevation[name];
    return [
      sub(`Shadow ${name} · y, blur, spread, opacity`),
      layers.map((_, i) =>
        h(
          'div',
          { class: 'layer' },
          [
            { step: 1, min: -40, max: 80 },
            { step: 1, min: 0, max: 120 },
            { step: 1, min: -40, max: 40 },
            { step: 0.01, min: 0, max: 1 },
          ].map((spec, j) => {
            const box = h('input', { type: 'number', ...spec, value: layers[i][j], 'aria-label': `${name} layer ${i + 1} ${['y', 'blur', 'spread', 'opacity'][j]}` });
            box.addEventListener('input', () => { if (box.value !== '') set(['elevation', name, i, j], Number(box.value)); });
            return box;
          }),
          h('button', { type: 'button', title: 'Remove layer', disabled: layers.length === 1, onclick: () => { layers.splice(i, 1); buildControls(); schedule(); } }, '−'),
        ),
      ),
      h('button', { type: 'button', disabled: layers.length >= 4, onclick: () => { layers.push([4, 8, 0, 0.08]); buildControls(); schedule(); } }, 'Add layer'),
    ];
  };
  return section('Elevation', false, level('sm'), level('md'), level('lg'), hint('Set every opacity to 0 for a flat style.'));
}

function motionControls() {
  return section(
    'Motion',
    false,
    ['fast', 'base', 'slow'].map((name) => number(`Duration ${name}`, ['motion', 'durations', name], { min: 0, max: 800, step: 10 })),
    sub('Easing · cubic-bezier'),
    cells(
      [0, 1, 2, 3].map((j) => ({ label: ['x1', 'y1', 'x2', 'y2'][j], step: 0.05, min: -1, max: 2, path: (r) => ['motion', 'easings', r.key, j] })),
      ['standard', 'in', 'out'].map((key) => ({ label: key, key })),
    ),
  );
}

function buildControls() {
  const open = [...document.querySelectorAll('#controls > details')].map((d) => d.open);
  const scroll = $('controls').scrollTop;
  // Computed sizes are shown read-only in ratio mode; give the cells something to read.
  state.style.__computed = kaava.typeSizes(state.style.type.scale);
  const sections = [identityControls(), colorControls(), typeControls(), spaceControls(), shapeControls(), elevationControls(), motionControls()];
  delete state.style.__computed;
  sections.forEach((s, i) => { if (open[i] !== undefined) s.open = open[i]; });
  $('controls').replaceChildren(...sections);
  $('controls').scrollTop = scroll;
}

// ---------- rendering ----------

let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 60);
}

const brief = (brandColor) => ({ name: state.style.name, description: state.style.description, brandColor, style: state.style.id });

function refresh() {
  state.error = '';
  let system;
  try {
    kaava.registerStyle(state.style);
    system = kaava.buildSystem(brief(state.brand));
    showPreview(kaava.renderTargets(system, ['preview'])[0].content);
  } catch (err) {
    state.error = err.message;
  }
  if (system) {
    const layers = kaava.layersOf(system);
    paintSwatches(system);
    showComputedSizes();
    showAudit(layers);
    showBrandResults();
  }
  showStatus();
}

const frame = $('preview');
let frameReady = false;
let lastBody = '';
let lastFonts = '';
function showPreview(html) {
  if (!frameReady) {
    frame.addEventListener('load', () => { frameReady = true; applyTheme(); }, { once: true });
    frame.srcdoc = html;
    const first = new DOMParser().parseFromString(html, 'text/html');
    lastBody = first.body.innerHTML;
    lastFonts = [...first.querySelectorAll('link')].map((l) => l.href).join('|');
    return;
  }
  // Swap styles in place rather than reloading, so the scroll position survives every keystroke.
  const next = new DOMParser().parseFromString(html, 'text/html');
  const doc = frame.contentDocument;
  doc.querySelector('style').textContent = next.querySelector('style').textContent;
  const fonts = [...next.querySelectorAll('link')].map((l) => l.href).join('|');
  if (fonts !== lastFonts) {
    doc.querySelectorAll('link').forEach((l) => l.remove());
    next.querySelectorAll('link').forEach((l) => doc.head.append(doc.importNode(l)));
    lastFonts = fonts;
  }
  if (next.body.innerHTML !== lastBody) {
    const scroll = doc.documentElement.scrollTop;
    doc.body.innerHTML = next.body.innerHTML;
    doc.documentElement.scrollTop = scroll;
    lastBody = next.body.innerHTML;
  }
  doc.title = next.title;
  applyTheme();
}

function applyTheme() {
  const doc = frame.contentDocument;
  if (!doc?.documentElement) return;
  doc.documentElement.dataset.theme = state.theme;
  // The workbench owns the theme; the preview's own switch would fight it.
  const own = doc.querySelector('.theme');
  if (own) own.style.display = 'none';
}

function paintSwatches(system) {
  const palette = system.tokens.palette;
  document.querySelectorAll('[data-swatch]').forEach((el) => {
    const [name, step] = el.dataset.swatch.split('.');
    el.style.background = palette[name]?.[step]?.$value.hex ?? 'transparent';
  });
}

function showComputedSizes() {
  const sizes = kaava.typeSizes(state.style.type.scale);
  document.querySelectorAll('[data-computed]').forEach((el) => { el.value = sizes[SIZES.indexOf(el.dataset.computed)]; });
}

function showAudit(layers) {
  const contrast = kaava.auditContrast(layers);
  const failures = contrast.filter((r) => !r.pass);
  const findings = kaava.auditAccessibility(layers).filter((f) => f.level !== 'info');
  const line = (kind, tag, message) => h('div', { class: 'line' }, h('span', { class: `tag ${kind}` }, tag), h('span', {}, message));
  $('audit').replaceChildren(
    line(failures.length ? 'fail' : 'ok', failures.length ? 'FAIL' : 'pass', `${kaava.contrastSummary(contrast).split('\n')[0]} (brand ${state.brand})`),
    ...failures.map((f) => line('fail', '', `[${f.mode}] ${f.fg} (${f.fgHex}) on ${f.bg} (${f.bgHex}): ${f.ratio}:1, needs ${f.min}:1`)),
    ...findings.map((f) => line(f.level === 'fail' ? 'fail' : 'warn', f.level === 'fail' ? 'FAIL' : 'warn', `${f.mode ? `[${f.mode}] ` : ''}${f.message} (${f.criterion})`)),
  );
}

/** A style has to hold for any brand color, so every test color gets its own contrast verdict. */
function showBrandResults() {
  document.querySelectorAll('#brands button').forEach((button) => {
    const mark = button.querySelector('em');
    try {
      const failed = kaava.auditContrast(kaava.resolveLayers(brief(button.dataset.color))).filter((r) => !r.pass).length;
      mark.textContent = failed ? `${failed} fail` : 'AA';
      mark.className = failed ? 'bad' : '';
    } catch {
      mark.textContent = '';
    }
  });
}

function showStatus() {
  const status = $('status');
  status.className = state.error ? 'error' : dirty() ? 'dirty' : '';
  status.textContent = state.error || (dirty() ? 'Unsaved changes' : 'Saved');
  status.title = state.error;
  $('save').disabled = Boolean(state.error) || !dirty();
  $('revert').disabled = !dirty();
}

// ---------- loading and saving ----------

function open(style) {
  state.style = clone(style);
  state.saved = JSON.stringify(state.style);
  state.idFollowsName = false;
  buildControls();
  refresh();
}

function fillStyleSelect(selectedId) {
  $('style-select').replaceChildren(...state.list.map((s) => h('option', { value: s.id }, `${s.name} · ${s.author}`)));
  $('style-select').value = selectedId;
}

async function loadList() {
  state.list = await (await fetch('/api/styles')).json();
}

async function save() {
  const response = await fetch(`/api/styles/${encodeURIComponent(state.style.id)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.style) });
  const body = await response.json();
  if (!response.ok) {
    state.error = body.error;
    showStatus();
    return;
  }
  await loadList();
  fillStyleSelect(body.id);
  state.saved = JSON.stringify(state.style);
  showStatus();
  $('status').textContent = `Saved styles/${body.id}.json`;
}

function duplicate() {
  const copy = clone(state.style);
  const ids = new Set(state.list.map((s) => s.id));
  let id = `${copy.id}-copy`;
  for (let n = 2; ids.has(id); n++) id = `${copy.id}-copy-${n}`;
  copy.id = id;
  copy.name = `${copy.name} copy`;
  copy.author = localStorage.getItem('kaava.author') || '';
  state.style = copy;
  state.saved = ''; // a duplicate is unsaved until written
  state.idFollowsName = true;
  buildControls();
  refresh();
  const name = document.querySelector('#controls input[type="text"]');
  name.focus();
  name.select();
}

$('style-select').addEventListener('change', (event) => {
  if (dirty() && !confirm('Discard unsaved changes to this style?')) {
    event.target.value = state.list.some((s) => s.id === state.style.id) ? state.style.id : event.target.value;
    return;
  }
  open(state.list.find((s) => s.id === event.target.value));
});
$('save').addEventListener('click', save);
$('duplicate').addEventListener('click', duplicate);
$('revert').addEventListener('click', () => {
  const original = state.list.find((s) => JSON.stringify(s) === state.saved) ?? state.list.find((s) => s.id === $('style-select').value);
  if (confirm('Discard unsaved changes?')) open(original);
});
window.addEventListener('beforeunload', (event) => { if (dirty()) event.preventDefault(); });
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 's') {
    event.preventDefault();
    if (!$('save').disabled) save();
  }
});

function setBrand(color) {
  state.brand = color;
  document.querySelectorAll('#brands button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
  refresh();
}
$('brands').replaceChildren(
  ...BRANDS.map((color) => h('button', { type: 'button', 'data-color': color, 'aria-pressed': String(color === state.brand), title: `Preview with ${color}`, onclick: () => setBrand(color) }, h('i', { style: `background:${color}` }), color, h('em'))),
);
$('brand-custom').addEventListener('input', (event) => setBrand(event.target.value));
document.querySelectorAll('.seg button').forEach((button) =>
  button.addEventListener('click', () => {
    state.theme = button.dataset.theme;
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    applyTheme();
  }),
);

async function loadCatalogue() {
  try {
    const data = await (await fetch('/google-fonts.json')).json();
    catalogue.fonts = data.fonts;
    catalogue.index = indexFonts(data.fonts);
    catalogue.updated = data.updated;
    $('google-fonts').replaceChildren(...data.fonts.map(([name, category]) => h('option', { value: name, label: category })));
  } catch {
    // Without the catalogue the family fields are plain text fields, as before.
  }
}

await Promise.all([loadList(), loadCatalogue()]);
const initial = new URLSearchParams(location.search).get('style');
const first = state.list.find((s) => s.id === initial) ?? state.list.find((s) => s.id === 'default') ?? state.list[0];
fillStyleSelect(first.id);
open(first);
