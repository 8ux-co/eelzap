import { defineConfig } from 'tsup'

// @ts-expect-error — a plain .mjs build helper, no types.
import { NPM_ENTRIES, nextImportsReact } from './scripts/bundle-config.mjs'

/**
 * The npm build (zap-cms-v2 §2.7 "Hard rules"): ES2020, zero runtime
 * dependencies, React and Next external (optional peers).
 *
 * - `.` and `./fields`: ESM and CJS (server and browser).
 * - `./next`, `./react`, `./preview`: ESM. `./react` carries `'use client'`
 *   (its boot component and hook run in the browser); `./next` imports the
 *   boot component from `./react.js` rather than bundling it, so it stays
 *   server code (`nextImportsReact`). `./preview` splits its suggestion
 *   chunks behind `import()`.
 * - `./internal/*` (Zap's own entries) and the CLI are not built here.
 */
const shared = {
  dts: { compilerOptions: { incremental: false, composite: false } },
  sourcemap: true,
  minify: false,
  target: 'es2020',
  outDir: 'dist',
  external: ['react', 'react-dom', 'next'],
} as const

export default defineConfig([
  {
    ...shared,
    entry: { index: NPM_ENTRIES.index, fields: NPM_ENTRIES.fields },
    format: ['esm', 'cjs'],
    clean: false,
    splitting: false,
  },
  {
    ...shared,
    entry: { react: NPM_ENTRIES.react },
    format: ['esm'],
    splitting: false,
    banner: { js: "'use client'" },
  },
  {
    ...shared,
    entry: { next: NPM_ENTRIES.next },
    format: ['esm'],
    splitting: false,
    esbuildPlugins: [nextImportsReact],
  },
  {
    ...shared,
    entry: { preview: NPM_ENTRIES.preview },
    format: ['esm'],
    splitting: true,
  },
])
