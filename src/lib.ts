/** Programmatic API: the same engine the MCP server uses, without the protocol. */
export { createServer, type ServerOptions } from './server.js';
export { buildSystem, layersOf, resolveBrief, resolveLayers, type KaavaSystem, type Layers } from './engine/resolve.js';
export { renderTargets, type EmittedFile } from './emit/index.js';
export { auditContrast, type ContrastResult } from './audit.js';
export { briefSchema, EMIT_TARGETS, type Brief, type EmitTarget } from './schema.js';
export { PRESETS, type PresetName } from './presets.js';
export type { Token, TokenGroup, TokenType } from './tokens.js';
export { VERSION } from './version.js';
