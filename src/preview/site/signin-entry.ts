import type { ChunkModule } from './config'
import { start } from './signin'

/**
 * The script-tag build of the `signin` chunk (`signin.v1.<hash>.js`, beside the core).
 * The core injected this file with its SRI hash and waits for it on
 * `window.__eelZapChunk` (`load-cdn.ts`); nothing else is exposed.
 */
const register = (
  window as unknown as { __eelZapChunk?: (name: string, module: ChunkModule) => void }
).__eelZapChunk
register?.('signin', { start })
