/** Browser build of the engine, used by the workbench. No file system, no MCP: styles in, files out. */
export { accessibilitySummary, auditAccessibility } from './a11y.js';
export { auditContrast, contrastSummary } from './audit.js';
export { renderTargets } from './emit/index.js';
export { buildSystem, layersOf, resolveLayers } from './engine/resolve.js';
export { typeSizes } from './engine/scales.js';
export { getStyle, parseStyle, registerStyle, styles, TYPE_STEPS } from './style.js';
