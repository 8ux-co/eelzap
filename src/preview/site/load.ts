import type { ChunkModule, ChunkName } from './config'

/**
 * The npm build's chunk loader: a dynamic `import()`, which the site's bundler
 * (and this package's own ESM build, `tsup` with splitting) turns into a
 * separate file fetched only when called. The script-tag build swaps this
 * module for `load-cdn.ts` at bundle time (`scripts/bundle-config.mjs`).
 */
export function loadChunk(name: ChunkName, _base?: string | null): Promise<ChunkModule> {
  return name === 'signin' ? import('./signin') : import('./suggest')
}
