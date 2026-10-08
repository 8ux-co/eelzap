#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { checkPreviewBundles, pinnedPreviewUrls } from './cdn-preflight.mjs'

try {
  const source = readFileSync(new URL('../src/boot/release.ts', import.meta.url), 'utf8')
  await checkPreviewBundles(pinnedPreviewUrls(source), fetch)
  console.log(
    'Preview CDN preflight passed: every pinned bundle returns 200 with and without a cache-busting query.',
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
