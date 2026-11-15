import { resolveBrief, traits, type KaavaSystem, type Layers } from '../engine/resolve.js';
import { cssValue, resolveToken, type ColorValue } from '../tokens.js';
import { emitCss } from './css.js';
import { cssVar, HEADER } from './names.js';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SOLID_ROLES = ['primary', 'accent', 'success', 'warning', 'danger', 'info'] as const;
const PALETTES = ['neutral', 'primary', 'accent', 'success', 'warning', 'danger', 'info'] as const;

/**
 * preview.html: a self-contained page that shows the system in use and documents every token.
 * It is styled only with the emitted custom properties, so it doubles as a visual test of them.
 */
export function emitPreview(system: KaavaSystem, layers: Layers): string {
  const b = resolveBrief(system.brief);
  const base = (path: string): string => cssValue(resolveToken(path, [layers.base]), base);
  const keys = (prefix: string): string[] => [...layers.base.keys()].filter((p) => p.startsWith(prefix));

  const pair = (bg: string, fg: string, label = bg): string =>
    `<div class="role" style="background:var(--color-${bg});color:var(--color-${fg})"><b>${label}</b><span>${fg}</span></div>`;

  const roles = [
    pair('bg', 'fg'),
    pair('surface', 'fg'),
    pair('surface-muted', 'fg-muted'),
    ...SOLID_ROLES.flatMap((r) => [pair(r, `on-${r}`), pair(`${r}-subtle`, `on-${r}-subtle`)]),
  ].join('\n      ');

  const ramps = PALETTES.map((name) => {
    const swatches = keys(`palette.${name}.`)
      .map((p) => {
        const step = Number(p.split('.')[2]);
        const hex = (resolveToken(p, [layers.base]).$value as ColorValue).hex;
        return `<div class="swatch" style="background:var(${cssVar(p)});color:var(--color-${step >= 500 ? 'white' : 'neutral-950'})" title="${cssVar(p)}"><b>${step}</b><span>${hex}</span></div>`;
      })
      .join('');
    return `<div class="ramp"><span class="ramp-name">${name}</span>${swatches}</div>`;
  }).join('\n      ');

  const type = keys('font.size.')
    .reverse()
    .map((p) => {
      const step = p.split('.')[2]!;
      const heading = ['2xl', '3xl', '4xl', '5xl'].includes(step);
      return `<div class="specimen"><code>${step} · ${base(p)}</code><span style="font-size:var(${cssVar(p)});line-height:var(--font-line-height-${step});letter-spacing:var(--font-tracking-${step});${heading ? 'font-family:var(--font-family-display);font-weight:var(--font-weight-heading)' : ''}">The quick brown fox</span></div>`;
    })
    .join('\n      ');

  const space = keys('space.')
    .filter((p) => /^\d+$/.test(p.split('.')[1]!) && p !== 'space.0')
    .map((p) => `<div class="bar"><code>${p.split('.')[1]}</code><i style="width:var(${cssVar(p)})"></i><code>${base(p)}</code></div>`)
    .join('\n        ');

  const radii = ['sm', 'md', 'lg', 'xl', 'full']
    .map((r) => `<div class="shape" style="border-radius:var(--radius-${r})"><code>${r}</code></div>`)
    .join('');
  const shadows = ['sm', 'md', 'lg']
    .map((s) => `<div class="shape elevated" style="box-shadow:var(--shadow-${s})"><code>${s}</code></div>`)
    .join('');

  const chips = traits(b)
    .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
    .join('');

  const status = (role: string, title: string, label: string): string =>
    `<li><span>${title}</span><span class="badge" style="background:var(--color-${role}-subtle);color:var(--color-on-${role}-subtle)">${label}</span></li>`;

  const webfonts = b.style.type.webfonts.map((url) => `<link rel="stylesheet" href="${escapeHtml(url)}">\n`).join('');
  const tokensCss = emitCss(system, layers).split('\n').slice(1).join('\n');

  return `<!doctype html>
<!-- ${HEADER(system.name)} -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(system.name)} · design system</title>
${webfonts}<style>
${tokensCss}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-family-sans); font-size: var(--font-size-base); line-height: var(--font-line-height-base); letter-spacing: var(--font-tracking-base); -webkit-font-smoothing: antialiased; }
main { max-width: 68rem; margin: 0 auto; padding: var(--space-section) var(--space-6); display: grid; gap: var(--space-section); }
h1, h2, h3 { font-family: var(--font-family-display); margin: 0; }
h1 { font-size: var(--font-size-4xl); line-height: var(--font-line-height-4xl); font-weight: var(--font-weight-heading); letter-spacing: var(--font-tracking-4xl); }
h2 { font-size: var(--font-size-xs); line-height: 1; font-family: var(--font-family-sans); font-weight: var(--font-weight-semibold); letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-fg-muted); margin-bottom: var(--space-4); }
h3 { font-size: var(--font-size-xl); line-height: var(--font-line-height-xl); font-weight: var(--font-weight-heading); letter-spacing: var(--font-tracking-xl); }
p { margin: 0; }
code { font-family: var(--font-family-mono); font-size: var(--font-size-xs); color: var(--color-fg-muted); }
.muted { color: var(--color-fg-muted); }
:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }

header { display: flex; flex-wrap: wrap; gap: var(--space-6); align-items: flex-end; justify-content: space-between; }
header p { max-width: 40rem; margin-top: var(--space-2); color: var(--color-fg-muted); font-size: var(--font-size-lg); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
.chip { border: var(--border-width) solid var(--color-border); border-radius: var(--radius-control); padding: 2px var(--space-3); font-size: var(--font-size-sm); color: var(--color-fg-muted); background: var(--color-surface); }
.theme { display: inline-flex; padding: 3px; gap: 2px; background: var(--color-surface-muted); border-radius: var(--radius-control); }
.theme button { border: 0; background: none; color: var(--color-fg-muted); font: inherit; font-size: var(--font-size-sm); padding: var(--space-1) var(--space-3); border-radius: var(--radius-control); cursor: pointer; }
.theme button[aria-pressed="true"] { background: var(--color-surface); color: var(--color-fg); box-shadow: var(--shadow-sm); }

.demo { display: grid; grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr)); gap: var(--space-6); align-items: start; }
.card { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-surface); padding: var(--space-inset); box-shadow: var(--shadow-sm); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
.field { display: grid; gap: var(--space-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
.input { height: var(--size-control-md); padding: 0 var(--space-3); border: var(--border-width) solid var(--color-border-strong); border-radius: var(--radius-control); background: var(--color-surface); color: var(--color-fg); font: inherit; font-weight: var(--font-weight-regular); }
.input::placeholder { color: var(--color-fg-muted); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-gap); }
.btn { display: inline-flex; align-items: center; justify-content: center; height: var(--size-control-md); padding: 0 var(--space-control); border: var(--border-width) solid transparent; border-radius: var(--radius-control); font: inherit; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); white-space: nowrap; cursor: pointer; transition: background-color var(--duration-fast) var(--ease-standard); }
.btn-primary { background: var(--color-primary); color: var(--color-on-primary); }
.btn-primary:hover { background: var(--color-primary-hover); }
.btn-secondary { background: var(--color-surface); color: var(--color-fg); border-color: var(--color-border-strong); }
.btn-secondary:hover { background: var(--color-surface-muted); }
.btn-ghost { background: none; color: var(--color-primary-text); padding: 0 var(--space-2); }
.btn-ghost:hover { background: var(--color-primary-subtle); color: var(--color-on-primary-subtle); }
.btn-danger { background: var(--color-danger); color: var(--color-on-danger); }
.btn-danger:hover { background: var(--color-danger-hover); }
.badge { display: inline-block; border-radius: var(--radius-control); padding: 1px var(--space-2); font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); }
.list { list-style: none; margin: 0; padding: 0; }
.list li { display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) 0; border-top: var(--border-width) solid var(--color-border); font-size: var(--font-size-sm); }
.list li:first-child { border-top: 0; padding-top: 0; }
.alert { border-radius: var(--radius-md); padding: var(--space-3) var(--space-4); font-size: var(--font-size-sm); background: var(--color-accent-subtle); color: var(--color-on-accent-subtle); }
.stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-gap); }
.stat { background: var(--color-surface-muted); border-radius: var(--radius-md); padding: var(--space-4); }
.stat b { display: block; font-family: var(--font-family-display); font-weight: var(--font-weight-heading); font-size: var(--font-size-xl); line-height: var(--font-line-height-xl); letter-spacing: var(--font-tracking-xl); white-space: nowrap; }
.stat span { font-size: var(--font-size-sm); color: var(--color-fg-muted); }
.link { color: var(--color-primary-text); font-weight: var(--font-weight-medium); }

.specimens { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr)); gap: var(--space-6); align-items: start; }
.prose { display: grid; gap: var(--space-4); max-width: 38rem; }
.prose .kicker { font-size: var(--font-size-sm); letter-spacing: var(--font-tracking-sm); font-weight: var(--font-weight-medium); color: var(--color-primary-text); }
.prose .title { font-family: var(--font-family-display); font-weight: var(--font-weight-heading); font-size: var(--font-size-3xl); line-height: var(--font-line-height-3xl); letter-spacing: var(--font-tracking-3xl); text-wrap: balance; }
.prose .lead { font-size: var(--font-size-lg); line-height: var(--font-line-height-lg); letter-spacing: var(--font-tracking-lg); color: var(--color-fg-muted); }
.prose blockquote { margin: 0; padding-left: var(--space-4); border-left: calc(var(--border-width) * 3) solid var(--color-primary); font-family: var(--font-family-display); font-size: var(--font-size-xl); line-height: var(--font-line-height-xl); letter-spacing: var(--font-tracking-xl); }
.prose .meta { font-size: var(--font-size-sm); color: var(--color-fg-muted); }
.panel { background: var(--color-surface); border: var(--border-width) solid var(--color-border); border-radius: var(--radius-surface); box-shadow: var(--shadow-md); overflow: hidden; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-gap); padding: var(--space-3) var(--space-4); border-bottom: var(--border-width) solid var(--color-border); }
.toolbar .input { height: var(--size-control-sm); min-width: 0; flex: 1 1 8rem; font-size: var(--font-size-sm); }
.btn-sm { height: var(--size-control-sm); }
table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); letter-spacing: var(--font-tracking-sm); }
th { text-align: left; font-weight: var(--font-weight-medium); color: var(--color-fg-muted); background: var(--color-surface-muted); padding: var(--space-2) var(--space-4); white-space: nowrap; }
td { padding: var(--space-3) var(--space-4); border-top: var(--border-width) solid var(--color-border); white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.selected td { background: var(--color-primary-subtle); color: var(--color-on-primary-subtle); }
.table-scroll { overflow-x: auto; }

.roles { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: var(--space-3); }
.role { border: var(--border-width) solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-4); min-height: 5.5rem; display: flex; flex-direction: column; justify-content: space-between; font-size: var(--font-size-sm); }
.role span { font-size: var(--font-size-xs); opacity: 0.85; }
.ramp { display: grid; grid-template-columns: 5rem repeat(11, 1fr); align-items: center; margin-bottom: var(--space-1); }
.ramp-name { font-size: var(--font-size-sm); color: var(--color-fg-muted); }
.swatch { height: 3.25rem; padding: var(--space-1) var(--space-2); display: flex; flex-direction: column; justify-content: space-between; font-size: 0.6875rem; line-height: 1.2; overflow: hidden; }
.swatch span { font-family: var(--font-family-mono); opacity: 0.8; }
.swatch:first-of-type { border-radius: var(--radius-md) 0 0 var(--radius-md); }
.swatch:last-of-type { border-radius: 0 var(--radius-md) var(--radius-md) 0; }
.specimen { display: grid; grid-template-columns: 9rem 1fr; align-items: baseline; gap: var(--space-4); padding: var(--space-2) 0; border-top: var(--border-width) solid var(--color-border); overflow: hidden; white-space: nowrap; }
.split { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: var(--space-section) var(--space-8); }
.bar { display: grid; grid-template-columns: 2rem 1fr 4rem; align-items: center; gap: var(--space-3); margin-bottom: var(--space-1); }
.bar i { height: 0.75rem; background: var(--color-primary); border-radius: 2px; }
.shapes { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--space-6); }
.shape { width: 4.5rem; height: 4.5rem; display: grid; place-items: center; background: var(--color-primary-subtle); border: var(--border-width) solid var(--color-border); }
.shape.elevated { background: var(--color-surface); border-radius: var(--radius-md); }
@media (max-width: 40rem) { .swatch span { display: none; } .ramp { grid-template-columns: 4rem repeat(11, 1fr); } }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>${escapeHtml(system.name)}</h1>
      ${b.description ? `<p>${escapeHtml(b.description)}</p>` : ''}
      <div class="chips">${chips}</div>
    </div>
    <div class="theme" role="group" aria-label="Theme">
      <button type="button" data-theme-choice="auto">Auto</button><button type="button" data-theme-choice="light">Light</button>${layers.dark ? '<button type="button" data-theme-choice="dark">Dark</button>' : ''}
    </div>
  </header>

  <section>
    <h2>In use</h2>
    <div class="demo">
      <div class="card">
        <div><h3>Create your account</h3><p class="muted">Start a 14-day trial. No card needed.</p></div>
        <label class="field">Work email<input class="input" type="email" placeholder="you@company.com"></label>
        <label class="field">Password<input class="input" type="password" value="correct horse"></label>
        <div class="actions"><button class="btn btn-primary" type="button">Create account</button><button class="btn btn-ghost" type="button">Sign in instead</button></div>
        <p class="muted" style="font-size:var(--font-size-sm)">By continuing you agree to the <a class="link" href="#">terms</a>.</p>
      </div>
      <div class="card">
        <h3>Deployments</h3>
        <ul class="list">
          ${status('success', 'api-gateway', 'Live')}
          ${status('warning', 'billing-worker', 'Degraded')}
          ${status('danger', 'search-indexer', 'Failed')}
          ${status('info', 'web-frontend', 'Queued')}
        </ul>
        <div class="actions"><button class="btn btn-secondary" type="button">View logs</button><button class="btn btn-danger" type="button">Roll back</button></div>
      </div>
      <div class="card">
        <h3>This week</h3>
        <div class="stats"><div class="stat"><b>12.4k</b><span>Requests</span></div><div class="stat"><b>99.9%</b><span>Uptime</span></div></div>
        <div class="alert"><b>Heads up.</b> Usage is at 80% of your plan.</div>
        <div class="actions"><span class="badge" style="background:var(--color-primary);color:var(--color-on-primary)">New</span><span class="badge" style="background:var(--color-accent);color:var(--color-on-accent)">Beta</span><span class="badge" style="background:var(--color-primary-subtle);color:var(--color-on-primary-subtle)">Team plan</span></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Reading and data</h2>
    <div class="specimens">
      <article class="prose">
        <span class="kicker">Release notes</span>
        <p class="title">Ship on Friday without holding your breath</p>
        <p class="lead">Every deploy now runs behind a health gate, so a bad build rolls itself back before anyone notices.</p>
        <p>The gate watches error rate and latency for the first five minutes. If either drifts past its budget, traffic returns to the previous version and the team gets <a class="link" href="#">a short report</a> instead of a page at midnight.</p>
        <blockquote>We stopped scheduling releases around who was on call.</blockquote>
        <p class="meta">4 min read · Updated 12 March</p>
      </article>
      <div class="panel">
        <div class="toolbar"><input class="input" type="search" placeholder="Filter builds" aria-label="Filter builds"><button class="btn btn-secondary btn-sm" type="button">Export</button><button class="btn btn-primary btn-sm" type="button">New build</button></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Build</th><th>Branch</th><th>Status</th><th class="num">Duration</th></tr></thead>
            <tbody>
              <tr><td>#4182</td><td>main</td><td><span class="badge" style="background:var(--color-success-subtle);color:var(--color-on-success-subtle)">Passed</span></td><td class="num">3m 12s</td></tr>
              <tr class="selected"><td>#4181</td><td>fix/cache-key</td><td><span class="badge" style="background:var(--color-info-subtle);color:var(--color-on-info-subtle)">Running</span></td><td class="num">1m 48s</td></tr>
              <tr><td>#4180</td><td>feat/health-gate</td><td><span class="badge" style="background:var(--color-danger-subtle);color:var(--color-on-danger-subtle)">Failed</span></td><td class="num">5m 03s</td></tr>
              <tr><td>#4179</td><td>main</td><td><span class="badge" style="background:var(--color-success-subtle);color:var(--color-on-success-subtle)">Passed</span></td><td class="num">3m 07s</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>

  <section>
    <h2>Color roles · background with its text color</h2>
    <div class="roles">
      ${roles}
    </div>
  </section>

  <section>
    <h2>Palettes</h2>
    <div>
      ${ramps}
    </div>
  </section>

  <section>
    <h2>Type</h2>
    <div>
      ${type}
    </div>
  </section>

  <section class="split">
    <div>
      <h2>Spacing</h2>
      <div>
        ${space}
      </div>
    </div>
    <div>
      <h2>Radius</h2>
      <div class="shapes">${radii}</div>
      <h2>Elevation</h2>
      <div class="shapes">${shadows}</div>
    </div>
  </section>
</main>
<script>
(function () {
  var root = document.documentElement;
  var buttons = document.querySelectorAll('[data-theme-choice]');
  function apply(choice) {
    if (choice === 'light' || choice === 'dark') root.dataset.theme = choice; else { delete root.dataset.theme; choice = 'auto'; }
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice)); });
  }
  buttons.forEach(function (b) { b.addEventListener('click', function () { apply(b.dataset.themeChoice); }); });
  apply(location.hash.slice(1));
})();
</script>
</body>
</html>
`;
}
