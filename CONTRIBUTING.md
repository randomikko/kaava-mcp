# Contributing

Thanks for taking the time. Bug reports, ideas and pull requests are all welcome.

## Setup

```sh
git clone https://github.com/randomikko/kaava-mcp.git
cd kaava-mcp
npm install
npm test
```

Node 20 or newer.

## Working on it

| Command | What it does |
|---|---|
| `npm test` | Engine, emitter and end-to-end MCP tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Bundle to `dist/` |
| `npm run workbench` | Open the style workbench at `http://127.0.0.1:4174` |
| `npm run fonts` | Refresh `workbench/google-fonts.json`, the Google Fonts catalogue the workbench lists and autocompletes |
| `npm run examples` | Regenerate `examples/`; run it when a change alters generated output |
| `npm run inspect` | Open the MCP Inspector against the built server |

To try a local build in a client, point it at the built file:

```sh
claude mcp add kaava-dev -- node /absolute/path/to/kaava-mcp/dist/index.mjs
```

## Where things live

- `src/engine/` turns a brief into tokens: color ramps and semantic roles, type, space, radius, shadow.
- `src/emit/` turns tokens into files, one emitter per output format.
- `src/server.ts` is the MCP surface: tools, resources, prompt.
- `styles/` holds the styles, one JSON file each; `src/style.ts` is their schema. Edit them in the workbench (`npm run workbench`), not by hand.
- `workbench/` and `scripts/workbench.mjs` are the style workbench. It is a repo tool and is not published.

## Ground rules

- **Deterministic.** The same brief must always produce the same system. No randomness, no network, no clock.
- **Contrast is a guarantee.** `test/engine.test.ts` checks every promised pairing across a wide sweep of brand colors and all styles. Changes to color logic must keep it green.
- **Tests with the change.** New behavior comes with a test; bug fixes come with a test that failed before.
- **Small tool surface.** Prefer making an existing tool more capable over adding a new one.

## Pull requests

Keep them focused on one thing, describe what changed and why, and add a line to `CHANGELOG.md`. For anything large, open an issue first so we can agree on the direction.
