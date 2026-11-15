# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release: generate a design system from a brief and emit it for any stack.

### Added

- `kaava_create_system`: brief (brand color, mood, density, radius, type scale, fonts) to a full token set saved as `kaava.json`.
- `kaava_update_system`: patch the brief or override single tokens; previously emitted files are regenerated.
- `kaava_get_tokens`: look up tokens by path.
- `kaava_emit`: CSS custom properties, Tailwind v4 theme, SCSS, TypeScript, W3C design tokens (DTCG), `DESIGN.md`, and a self-contained `preview.html`.
- File safety: writes stay inside the project root (symlinks included), files Kaava did not generate are never replaced without `overwrite`, and writes are atomic.
- `kaava_audit`: accessibility audit against WCAG 2.2 AA in light and dark. Checks every promised color pairing (with APCA values), whether solid fills have a visible boundary, whether status colors stay distinguishable with protanopia, deuteranopia and tritanopia, and control target sizes.
- `kaava_check_contrast`: check any two colors or tokens; a failing pair comes back with the nearest passing color of the same hue and the system text colors that pass.
- Emitted stylesheets set the duration tokens to 0ms under `prefers-reduced-motion: reduce`.
- Six mood presets: minimal, friendly, corporate, playful, editorial, technical.
- `kaava://system` and `kaava://presets` resources, and the `new-design-system` prompt.
- Programmatic API (`buildSystem`, `renderTargets`, `auditContrast`, `auditAccessibility`, `checkContrast`).
