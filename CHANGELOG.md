# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.0](https://github.com/randomikko/kaava-mcp/compare/v0.1.0...v0.2.0) (2026-11-16)


### Features

* command line and shadcn/ui emit target ([aa8fbe8](https://github.com/randomikko/kaava-mcp/commit/aa8fbe86f04e757dad33ef05e95ee310d9d2fa0a))
* command line for the tools ([44c5fee](https://github.com/randomikko/kaava-mcp/commit/44c5feeb674ca18b6a3ad333acb43d9b02553f7f))
* command line for the tools ([3b0ee19](https://github.com/randomikko/kaava-mcp/commit/3b0ee19f6af4fcf006d965bdd54dcdd6167acc83))
* shadcn/ui emit target, and a clearer list of supported systems in the README ([a0ff827](https://github.com/randomikko/kaava-mcp/commit/a0ff8277984cb75bb114af0bfb0c3155402650e4))

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
