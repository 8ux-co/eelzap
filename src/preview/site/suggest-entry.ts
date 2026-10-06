import type { ChunkModule } from './config'
import { start } from './suggest'

/**
 * The script-tag build of the `suggest` chunk (`suggest.v1.<hash>.js`, beside the core).
 * The core injected this file with its SRI hash and waits for it on
 * `window.__eelZapChunk` (`load-cdn.ts`); nothing else is exposed.
 */
const register = (
  window as unknown as { __eelZapChunk?: (name: string, module: ChunkModule) => void }
).__eelZapChunk
register?.('suggest', { start })
