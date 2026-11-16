# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Command line: `kaava-mcp init`, `update`, `emit`, `tokens`, `audit`, `contrast` and `styles` run the tools without an MCP client. `audit` and `contrast` exit 1 on a failure, for use in CI. Without a command, `kaava-mcp` still runs as the MCP server.

## [0.1.0] - 2026-11-16

First release: generate a design system from a brief and emit it for any stack.

### Added

- `kaava_create_system`: brief (brand color, style, density, radius, type scale, fonts) to a full token set saved as `kaava.json`.
- `kaava_update_system`: patch the brief or override single tokens; previously emitted files are regenerated.
- `kaava_get_tokens`: look up tokens by path.
- `kaava_emit`: CSS custom properties, Tailwind v4 theme, SCSS, TypeScript, W3C design tokens (DTCG), `DESIGN.md`, and a self-contained `preview.html`.
- `DESIGN.md` follows the open [DESIGN.md format](https://github.com/google-labs-code/design.md): light-theme tokens and the contrast-checked pairings as YAML front matter, prose in the format's section order. The test suite runs the format's linter on every built-in style and expects no errors or warnings.
- File safety: writes stay inside the project root (symlinks included), files Kaava did not generate are never replaced without `overwrite`, and writes are atomic.
- `kaava_audit`: accessibility audit against WCAG 2.2 AA in light and dark. Checks every promised color pairing (with APCA values), whether solid fills have a visible boundary, whether status colors stay distinguishable with protanopia, deuteranopia and tritanopia, and control target sizes.
- `kaava_check_contrast`: check any two colors or tokens; a failing pair comes back with the nearest passing color of the same hue and the system text colors that pass.
- Emitted stylesheets set the duration tokens to 0ms under `prefers-reduced-motion: reduce`.
- Styles: each built-in style is a JSON file that holds every character decision (ramp curves, surfaces, typography with web fonts, letter-spacing, spacing rhythm, radii, border width, shadows, motion) and names its author. Six ship as starting points: minimal, friendly, corporate, playful, editorial, technical.
- `kaava://system` and `kaava://styles` resources, and the `new-design-system` prompt.
- Programmatic API (`buildSystem`, `renderTargets`, `auditContrast`, `auditAccessibility`, `checkContrast`).
