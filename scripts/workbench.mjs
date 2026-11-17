// The style workbench: a local page for designing Kaava styles with a live preview.
// Run with `npm run workbench`. It serves workbench/ and reads and writes the JSON files in styles/.
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stylesIndex } from './styles-index.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_BODY = 200_000;

const STATIC = {
  '/': ['workbench/index.html', 'text/html; charset=utf-8'],
  '/wordmark.svg': ['docs/kaava-wordmark-dark.svg', 'image/svg+xml'],
  '/app.js': ['workbench/app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['workbench/app.css', 'text/css; charset=utf-8'],
  '/fonts.js': ['workbench/fonts.js', 'text/javascript; charset=utf-8'],
  '/google-fonts.json': ['workbench/google-fonts.json', 'application/json; charset=utf-8'],
  '/engine.js': ['workbench/build/engine.js', 'text/javascript; charset=utf-8'],
};

/** Style files are written with short arrays on one line, so curves and shadow layers stay readable in a diff. */
export function formatStyle(style) {
  return `${JSON.stringify(style, null, 2)
    .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.replace(/\s+/g, ' ')}]`)
    .replace(/\[\s+((?:\[[^[\]]*\],?\s*)+)\]/g, (_, inner) => `[${inner.trim().replace(/\s+/g, ' ')}]`)}\n`;
}

/**
 * @param {object} options
 * @param {string} [options.root] Repository root that holds workbench/.
 * @param {string} [options.stylesDir] Where style files are read and written.
 * @param {(style: unknown) => unknown} options.parseStyle Validates a style, throwing a readable error.
 */
export function createWorkbench({ root = ROOT, stylesDir = path.join(ROOT, 'styles'), parseStyle }) {
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  async function listStyles() {
    const files = (await readdir(stylesDir)).filter((f) => f.endsWith('.json')).sort();
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(stylesDir, f), 'utf8'))));
  }

  async function saveStyle(id, body) {
    if (!ID.test(id) || id.length > 40) throw Object.assign(new Error('A style id uses lowercase letters, digits and hyphens only.'), { status: 400 });
    let style;
    try {
      style = parseStyle(JSON.parse(body));
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: 400 });
    }
    if (style.id !== id) throw Object.assign(new Error(`The style's id "${style.id}" does not match the address "${id}".`), { status: 400 });
    await mkdir(stylesDir, { recursive: true });
    const target = path.join(stylesDir, `${id}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, formatStyle(style));
    await rename(temp, target);
    const ids = (await readdir(stylesDir)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    await writeFile(path.join(stylesDir, 'index.ts'), stylesIndex(ids));
    return style;
  }

  return createServer(async (req, res) => {
    try {
      // Only this machine may talk to the workbench, and only pages it served may write.
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') return send(res, 403, { error: 'Forbidden host.' });
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, await readFile(path.join(root, file)), type);
      }
      if (req.method === 'GET' && url.pathname === '/api/styles') return send(res, 200, await listStyles());

      const match = /^\/api\/styles\/([^/]+)$/.exec(url.pathname);
      if (req.method === 'PUT' && match) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-origin writes are not allowed.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > MAX_BODY) return send(res, 413, { error: 'Style file too large.' });
        }
        return send(res, 200, await saveStyle(decodeURIComponent(match[1]), body));
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (err) {
      return send(res, err.status ?? 500, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { parseStyle } = await import('../dist/lib.mjs');
  const port = Number(process.env.PORT ?? 4174);
  createWorkbench({ parseStyle }).listen(port, '127.0.0.1', () => {
    console.log(`Kaava workbench: http://127.0.0.1:${port}`);
    console.log('Styles are saved to styles/. Stop with Ctrl+C.');
  });
}
