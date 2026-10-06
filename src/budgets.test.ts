import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

import {
  BUDGETS,
  buildBootBundle,
  buildChunk,
  buildPreviewBundle,
  NPM_ENTRIES,
  nextImportsReact,
  release,
  // @ts-expect-error — a plain .mjs build helper, no types.
} from '../scripts/bundle-config.mjs'

/**
 * The size budgets of zap-cms-v2 §2.7, one per subpath, and the hard rules
 * every subpath keeps. Builds run in memory with the same esbuild settings as
 * the release and the npm build (`scripts/bundle-config.mjs`), minified and
 * gzipped at level 9. Any excess fails CI.
 */

const gz = (code: string) => gzipSync(code, { level: 9 }).length
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  sideEffects?: boolean
  exports: Record<string, unknown>
  publishConfig: { exports?: Record<string, unknown> }
}
/** What npm publishes: `publishConfig.exports` here, `exports` in the exported public package. */
const published = pkg.publishConfig.exports ?? pkg.exports

/** One npm entry (or a snippet importing it), bundled and minified as a site's bundler would. */
async function esm(contents: string, plugins: unknown[] = []): Promise<string> {
  const result = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    minify: true,
    write: false,
    logLevel: 'silent',
    external: ['react', 'react-dom', 'next'],
    plugins: plugins as never,
  })
  return result.outputFiles[0]!.text
}

/**
 * Real-length, incompressible values, as a release compiles them in. A
 * stand-in: no released file has this name.
 */
const FAKE_RELEASE = {
  path: '/js/preview/preview.v1.5f3a9c0e7b21d846.js',
  integrity: 'sha384-woQssMcr2wb0LL+Uc6y/y5ajPREi/Kn7B/O70nr3ajpjIJunqjzeac86zCA2jN/f',
}

describe('size budgets per subpath (§2.7)', () => {
  it('`.`: a delivery-only import stays under 6 KB', async () => {
    const code = await esm(
      `import { createClient } from './index'
       export const read = (key: string) => createClient({ apiKey: key }).items.get('blog', 'hola')`,
    )
    expect(gz(code)).toBeLessThanOrEqual(BUDGETS.root)
  }, 30_000)

  it('`./fields` stays under 1 KB', async () => {
    const code = await esm(`export { fields } from './fields'`)
    expect(gz(code)).toBeLessThanOrEqual(BUDGETS.fields)
  }, 30_000)

  it('`./next` stays under 2 KB, React and Next excluded, and never bundles the overlay', async () => {
    const result = await build({
      entryPoints: [NPM_ENTRIES.next],
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2020',
      minify: true,
      write: false,
      logLevel: 'silent',
      external: ['react', 'react-dom', 'next'],
      plugins: [nextImportsReact],
    })
    const code = result.outputFiles[0]!.text
    expect(gz(code)).toBeLessThanOrEqual(BUDGETS.next)
    expect(code).toContain('./react.js')
    expect(code).not.toContain('eel-zap-overlay')
  }, 30_000)

  it('`./react` stays within its budget, React excluded, and never bundles the overlay', async () => {
    const code = await esm(`export * from './react'`)
    expect(gz(code)).toBeLessThanOrEqual(BUDGETS.react)
    expect(code).not.toContain('eel-zap-overlay')
    expect(code).not.toMatch(/Entrar con Eel|Solicitar cambio/)
  }, 30_000)

  it('the boot stays within its budget, as a script tag and as an import', async () => {
    const tag: string = await buildBootBundle(FAKE_RELEASE)
    expect(gz(tag)).toBeLessThanOrEqual(BUDGETS.boot)
    expect(tag).toContain(FAKE_RELEASE.path)
    expect(tag).toContain(FAKE_RELEASE.integrity)
    const imported = await esm(`export { bootZapPreview } from './boot/boot'`)
    expect(gz(imported)).toBeLessThanOrEqual(BUDGETS.boot)
  }, 30_000)

  it('`./preview` (the CDN overlay) stays within its budget, its chunks within theirs', async () => {
    const core: string = await buildPreviewBundle()
    expect(gz(core)).toBeLessThanOrEqual(BUDGETS.preview)
    for (const name of ['signin', 'suggest'] as const) {
      const chunk: string = await buildChunk(name)
      expect(gz(chunk), name).toBeLessThanOrEqual(BUDGETS[name])
      expect(chunk).toContain('__eelZapChunk')
    }
  }, 30_000)

  it('`./analytics` is reserved: a budget, no export, no build', () => {
    expect(BUDGETS.analytics).toBe(1024)
    expect(pkg.exports['./analytics']).toBeUndefined()
    expect(published['./analytics']).toBeUndefined()
    expect(NPM_ENTRIES.analytics).toBeUndefined()
  })
})

describe('hard rules for every subpath (§2.7)', () => {
  it('zero runtime dependencies; React and Next optional peers; no side effects', () => {
    expect(pkg.dependencies ?? {}).toEqual({})
    expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true)
    expect(pkg.peerDependenciesMeta?.next?.optional).toBe(true)
    expect(pkg.sideEffects).toBe(false)
  })

  it('publishes ESM and CJS for `.` and `./fields`, ESM for the browser subpaths, nothing internal', () => {
    const exports = published as Record<string, Record<string, unknown>>
    expect(Object.keys(exports).sort()).toEqual(
      ['.', './fields', './next', './package.json', './preview', './react'].sort(),
    )
    for (const both of ['.', './fields'])
      expect(Object.keys(exports[both]!)).toEqual(['import', 'require'])
    for (const esmOnly of ['./next', './react', './preview']) {
      expect(exports[esmOnly]).toEqual({
        types: `./dist/${esmOnly.slice(2)}.d.ts`,
        default: `./dist/${esmOnly.slice(2)}.js`,
      })
    }
  })
})

describe('the CDN builds', () => {
  it('compile in no deployment origin', async () => {
    // Zap's own preview deployments are not editors (zap-cms-v2 §2.6).
    const builds: string[] = [
      await buildPreviewBundle(),
      await buildBootBundle(FAKE_RELEASE),
      await buildChunk('signin'),
      await buildChunk('suggest'),
    ]
    for (const code of builds) {
      expect(code).not.toContain('vercel.app')
      expect(code).not.toContain('__EELZAP_PREVIEW_ORIGIN_PATTERN__')
    }
  }, 30_000)

  it('the overlay carries none of the suggestion UI, and loads its chunks by script tag with SRI', async () => {
    const markers = [
      'Solicitar cambio',
      'Entrar con Eel',
      'Guardado en el borrador',
      'eel-zap-site',
    ]
    const core: string = await buildPreviewBundle()
    for (const marker of markers) expect(core, marker).not.toContain(marker)
    expect(core).not.toMatch(/\bimport\(/)
    // Real-length names and SRI values: the release compiles exactly these in.
    const chunks = {
      signin: {
        file: 'signin.v1.0123456789abcdef.js',
        integrity: 'sha384-Osz55dItVhbQUQWKTmARYcD/hDb81RzCLTuarmYciVXBkn4QdY3xzfFwc2EsVW2A',
      },
      suggest: {
        file: 'suggest.v1.fedcba9876543210.js',
        integrity: 'sha384-gbkOW3iupCH08sCEAaoUWoF25xDciwtr4i7QRo4iVStxzL1jof6w9dsM+5PAJ+ww',
      },
    }
    const released: string = await buildPreviewBundle(chunks)
    for (const chunk of Object.values(chunks)) {
      expect(released).toContain(chunk.file)
      expect(released).toContain(chunk.integrity)
    }
    expect(gz(released)).toBeLessThanOrEqual(BUDGETS.preview)
  }, 30_000)

  it('the npm `./preview` keeps the suggestion UI behind import() too', async () => {
    const result = await build({
      entryPoints: [NPM_ENTRIES.preview],
      bundle: true,
      format: 'esm',
      splitting: true,
      platform: 'browser',
      target: 'es2020',
      outdir: '/virtual',
      write: false,
      logLevel: 'silent',
    })
    const entry = result.outputFiles.find((file) => /\/index\.js$/.test(file.path))!
    expect(entry.text).not.toContain('Entrar con Eel')
    expect(entry.text).toMatch(/import\("\.\/(signin|suggest)-[A-Z0-9]+\.js"\)/)
    const holder = result.outputFiles.find((file) => file.text.includes('Solicitar cambio'))
    expect(holder?.path).not.toMatch(/\/index\.js$/)
  }, 30_000)

  it('names a release by its content hash, with a sha384 SRI value', () => {
    const one = release('x', 'preview.')
    expect(one.file).toMatch(/^preview\.v1\.[0-9a-f]{16}\.js$/)
    expect(one.path).toBe(`/js/preview/${one.file}`)
    expect(one.url).toBe(`https://zap.eel.software/js/preview/${one.file}`)
    expect(one.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/)
    expect(release('x;', 'preview.').file).not.toBe(one.file)
  })
})
