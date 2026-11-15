import { defineConfig } from 'tsdown';

/** The engine as one browser module for the workbench. Not part of the published package. */
export default defineConfig({
  entry: { engine: 'src/browser.ts' },
  outDir: 'workbench/build',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  noExternal: [/.*/],
  dts: false,
  clean: true,
});
