import { defineConfig } from 'vitest/config'

/**
 * Two projects in one package:
 * - `sdk`: the server-and-browser client (`.`, `./fields`, `./next`), `*.test.ts`, node;
 * - `browser`: the preview overlay, the boot and `./react`, `*.spec.ts`, jsdom.
 *   A spec that needs node (esbuild, gzip) opts in with a docblock.
 *
 * Coverage and its ratchet (`scripts/check-coverage.mjs`) measure the SDK core
 * as before; the preview modules are held by their own specs and the size
 * budgets (`src/budgets.test.ts`).
 */
export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'sdk', include: ['src/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
          environment: 'jsdom',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.spec.tsx',
        'src/types/**',
        'src/preview/**',
        'src/boot/**',
        'src/internal/**',
        'src/react.ts',
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
})
