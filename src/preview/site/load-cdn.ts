import type { ChunkModule, ChunkName } from './config'

/**
 * The script-tag build's chunk loader (`load.ts` is swapped for this file when
 * `scripts/bundle-config.mjs` builds the CDN core). Each chunk is its own
 * immutable file next to the core, `signin.v1.<hash>.js` and
 * `suggest.v1.<hash>.js`, and the release compiles their names AND their
 * SRI hashes into the core (`__EELZAP_CHUNKS__`), so the browser refuses a
 * chunk whose bytes are not the released ones, wherever it is served from.
 *
 * A loaded chunk hands its module back through `__eelZapChunk(name, module)`,
 * a non-writable function on `window`; only a name this loader is waiting for
 * is accepted, once.
 */

declare const __EELZAP_CHUNKS__: Record<string, { file: string; integrity: string }> | undefined

const loading: Partial<Record<ChunkName, Promise<ChunkModule>>> = {}
const waiting: Partial<Record<ChunkName, (module: ChunkModule) => void>> = {}

function hook(): void {
  if ('__eelZapChunk' in window) return
  Object.defineProperty(window, '__eelZapChunk', {
    value: (name: ChunkName, module: ChunkModule) => {
      const resolve = waiting[name]
      if (!resolve || typeof module?.start !== 'function') return
      delete waiting[name]
      resolve(module)
    },
  })
}

export function loadChunk(name: ChunkName, base?: string | null): Promise<ChunkModule> {
  const chunk = typeof __EELZAP_CHUNKS__ === 'object' ? __EELZAP_CHUNKS__[name] : undefined
  if (!chunk || !base) return Promise.reject(new Error(`eelzap: no ${name} chunk`))
  return (loading[name] ??= new Promise<ChunkModule>((resolve, reject) => {
    hook()
    waiting[name] = resolve
    const script = document.createElement('script')
    script.src = new URL(chunk.file, base).href
    script.integrity = chunk.integrity
    script.crossOrigin = 'anonymous'
    script.async = true
    script.onerror = () => {
      delete loading[name]
      reject(new Error(`eelzap: ${name} chunk failed to load`))
    }
    document.head.appendChild(script)
  }))
}
