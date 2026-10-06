/**
 * The one esbuild configuration for every browser build of the package, and
 * the size budgets of `.docs/proposals/zap-cms-v2.md` §2.7. Imported by
 * `release-cdn.mjs` (a CDN release), `tsup.config.ts` (the npm build's
 * plugins) and `src/budgets.test.ts` (rebuilds in memory: the budgets), so
 * they can never build differently.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = (file) => path.join(root, 'src', file)

/**
 * Gzip budgets in bytes, per subpath (§2.7 "Subpaths"). `budgets.test.ts`
 * fails the build on any excess. `analytics` is reserved: not built, but its
 * budget is fixed now so nothing else may grow into it.
 */
export const BUDGETS = {
  /** `.`: a delivery-only import (`createClient` and a read). */
  root: 6 * 1024,
  fields: 1024,
  /** `./next`, React and Next excluded. */
  next: 2 * 1024,
  /**
   * `./react`, React excluded. Raised from 2048 to 2112: it carries the boot,
   * which grew for Shift Z (above). Measured 2026-10-05: 2078. Raised to 2240
   * with the boot (below): 2205.
   */
  react: 2240,
  /**
   * The boot every visitor runs (script tag and component). Raised from 1024 to
   * 1152 for Shift Z, which must refuse typing and IME composition before it
   * loads anything (owner, 2026-10-05). Measured 2026-10-05: 1011 → 1113.
   * Raised to 1248 for local preview without a shim and StrictMode (Verde
   * Origen fixes, 2026-10-05): the overlay loads from the framing or
   * configured Zap origin, local means http or https on localhost, 127.0.0.1,
   * [::1] or *.localhost, and a second boot finds the first script. Measured
   * 1113 → 1214.
   */
  boot: 1248,
  /**
   * `./preview`, the overlay core. Raised from 12 KB to 13 KB for spot mode and
   * numbered pins («Comentarios», zap-cms-v2 §3.3). Measured 2026-10-05: core
   * 12078 → 12988 bytes, the release build with chunk names and SRI 13180.
   * Raised to 13568 for the Verde Origen fixes (2026-10-05): URL and EMAIL
   * values written to a link's href (`links`), *.localhost and https local
   * Zaps, one overlay per page. Measured: core 13096 → 13308, the release
   * build 13290 → 13498.
   */
  preview: 13568,
  signin: 8 * 1024,
  suggest: 25 * 1024,
  /** Reserved, not built (§2.7 "Room for `./analytics`"). */
  analytics: 1024,
}

/** The npm build's entries (tsup) and their sources. */
export const NPM_ENTRIES = {
  index: src('index.ts'),
  fields: src('fields.ts'),
  next: src('next.ts'),
  react: src('react.ts'),
  preview: src('preview/index.ts'),
}

export const PREVIEW_ENTRY = src('preview/live-entry.ts')
export const BOOT_ENTRY = src('boot/boot-entry.ts')

/**
 * Suggestion mode's two lazy chunks (zap-cms-v2 §3.4, `src/preview/site/`):
 * each its own immutable file beside the overlay, `<name>.v1.<hash>.js`,
 * whose name and SRI hash the release compiles into the overlay
 * (`__EELZAP_CHUNKS__`).
 */
export const CHUNK_ENTRIES = {
  signin: src('preview/site/signin-entry.ts'),
  suggest: src('preview/site/suggest-entry.ts'),
}

/**
 * The CDN overlay loads chunks with a script tag and an SRI hash
 * (`src/preview/site/load-cdn.ts`) instead of the npm build's `import()`
 * (`src/preview/site/load.ts`), so a bundler never inlines them.
 */
const cdnLoader = {
  name: 'eelzap-cdn-loader',
  setup(b) {
    b.onResolve({ filter: /^\.\/load$/ }, (args) =>
      args.importer.endsWith(`${path.sep}site${path.sep}boot.ts`)
        ? { path: src('preview/site/load-cdn.ts') }
        : undefined,
    )
  },
}

/**
 * The npm `./next` imports the boot component from the `./react` build
 * instead of bundling it, so the component keeps `react.js`'s `'use client'`
 * directive and `./next` stays server code.
 */
export const nextImportsReact = {
  name: 'eelzap-next-imports-react',
  setup(b) {
    b.onResolve({ filter: /^\.\/boot\/component$/ }, (args) =>
      args.importer === NPM_ENTRIES.next ? { path: './react.js', external: true } : undefined,
    )
  },
}

/**
 * The CDN release lands in Zap's public directory, served at
 * `/js/preview/<file>` (`apps/zap/next.config.ts` sets the immutable headers).
 * Its names and SRI hashes go to two committed modules: the boot's
 * (`src/boot/release.ts`, compiled into the npm build) and Zap's
 * (`apps/zap/src/lib/preview/live-client-release.ts`, the settings snippet).
 * Released files are never rewritten: a new build is a new file.
 */
export const CDN_ORIGIN = 'https://zap.eel.software'
export const CDN_URL_PATH = '/js/preview'
export const CDN_PUBLIC_DIR = path.resolve(root, '../../apps/zap/public/js/preview')
export const CDN_RELEASE_MODULE = path.resolve(
  root,
  '../../apps/zap/src/lib/preview/live-client-release.ts',
)
export const BOOT_RELEASE_MODULE = src('boot/release.ts')

/*
 * No define carries an origin: Zap's own preview deployments are not editors,
 * so no deployment-specific origin is compiled into a public bundle. The CDN
 * builds trust production, the configured `zapOrigin` and local Zaps only.
 */

async function buildIife(entry, define = {}, plugins = []) {
  const result = await build({
    plugins,
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    write: false,
    logLevel: 'silent',
    define,
  })
  return result.outputFiles[0].text.trim()
}

/**
 * Build the CDN overlay (`./preview` as a script). `chunks` compiles in the
 * suggestion chunks' names and SRI hashes.
 */
export async function buildPreviewBundle(chunks = undefined) {
  const define = {}
  if (chunks) {
    define.__EELZAP_CHUNKS__ = JSON.stringify(
      Object.fromEntries(
        Object.entries(chunks).map(([name, chunk]) => [
          name,
          { file: chunk.file, integrity: chunk.integrity },
        ]),
      ),
    )
  }
  return buildIife(PREVIEW_ENTRY, define, [cdnLoader])
}

/**
 * Build the script-tag boot. It loads the overlay named in
 * `src/boot/release.ts`, or `release` when given (specs, and the release
 * itself before that module is rewritten).
 */
export async function buildBootBundle(release = undefined) {
  const plugins = release
    ? [
        {
          name: 'eelzap-boot-release',
          setup(b) {
            b.onResolve({ filter: /^\.\/release$/ }, () => ({
              path: 'release',
              namespace: 'eelzap-release',
            }))
            b.onLoad({ filter: /.*/, namespace: 'eelzap-release' }, () => ({
              contents: renderBootReleaseModule(release),
              loader: 'ts',
            }))
          },
        },
      ]
    : []
  return buildIife(BOOT_ENTRY, {}, plugins)
}

/** Build one suggestion chunk's script-tag file (`signin` or `suggest`). */
export async function buildChunk(name) {
  return buildIife(CHUNK_ENTRIES[name])
}

/** `<prefix>v1.<first 16 hex of sha256>.js`, its SRI value, path and URL. */
export function release(code, prefix = '') {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 16)
  const file = `${prefix}v1.${hash}.js`
  const urlPath = `${CDN_URL_PATH}/${file}`
  return {
    file,
    path: urlPath,
    url: `${CDN_ORIGIN}${urlPath}`,
    integrity: `sha384-${createHash('sha384').update(code).digest('base64')}`,
  }
}

export function renderBootReleaseModule(preview) {
  return [
    '// GENERATED by packages/zap-sdk/scripts/release-cdn.mjs. Committed: the CDN',
    '// release of `./preview` the boot loads, compiled into the npm build and the',
    '// script-tag boot. The boot joins the path to the Zap origin it trusts (the',
    '// framing editor, the configured Zap, or production); the SRI hash pins the',
    '// bytes. apps/zap live-client.spec.ts checks it names a released file.',
    '',
    `export const PREVIEW_RELEASE_PATH = '${preview.path}'`,
    '',
    'export const PREVIEW_RELEASE_INTEGRITY =',
    `  '${preview.integrity}'`,
    '',
  ].join('\n')
}

export function renderReleaseModule(boot, preview, chunks = {}) {
  // Written the way prettier prints it (single quotes, the long SRI value on
  // its own line), so a release never leaves a formatting diff behind.
  return [
    '// GENERATED by packages/zap-sdk/scripts/release-cdn.mjs. Committed: it names',
    '// the boot the settings snippet and the docs page install, and the overlay',
    '// and chunks it loads. live-client.spec.ts fails if it disagrees with the files.',
    '',
    `export const LIVE_CLIENT_FILE = '${boot.file}'`,
    '',
    `export const LIVE_CLIENT_PATH = '${boot.path}'`,
    '',
    'export const LIVE_CLIENT_INTEGRITY =',
    `  '${boot.integrity}'`,
    '',
    '// The overlay (`./preview`) the boot loads in a preview session.',
    `export const LIVE_PREVIEW_FILE = '${preview.file}'`,
    '',
    'export const LIVE_PREVIEW_INTEGRITY =',
    `  '${preview.integrity}'`,
    '',
    '// The suggestion chunks (zap-cms-v2 §3.4) whose names and SRI hashes the overlay carries.',
    'export const LIVE_CLIENT_CHUNKS = {',
    ...Object.entries(chunks).flatMap(([name, chunk]) => [
      `  ${name}: {`,
      `    file: '${chunk.file}',`,
      `    integrity: '${chunk.integrity}',`,
      '  },',
    ]),
    '} as const',
    '',
  ].join('\n')
}
