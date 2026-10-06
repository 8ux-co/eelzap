import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The script-tag overlay (`live-entry.ts`): each copy of the file on a page
 * is a separate bundle with its own module state, so `initZap`'s "one client
 * per page" cannot see another copy. The entry itself must refuse to start a
 * second overlay (React StrictMode and remounts used to add the tag twice).
 */

const initZap = vi.fn()

vi.mock('./live', () => ({
  initZap,
  onValues: vi.fn(),
  getPreviewToken: vi.fn(),
  previewHeaders: vi.fn(),
  ZAP_PREVIEW_TOKEN_HEADER: 'x-zap-preview-token',
}))

function runCopy() {
  const script = document.createElement('script')
  script.setAttribute('data-site', 'verdeorigen')
  script.setAttribute('data-zap-origin', 'http://localhost:5047')
  vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script)
  vi.resetModules()
  return import('./live-entry')
}

afterEach(() => vi.restoreAllMocks())

describe('two copies of the overlay on one page', () => {
  it('only the first starts a client; the second leaves window.EelZap alone', async () => {
    await runCopy()
    expect(initZap).toHaveBeenCalledTimes(1)
    expect(initZap.mock.calls[0]![0]).toMatchObject({
      siteKey: 'verdeorigen',
      zapOrigin: 'http://localhost:5047',
    })
    const api = (window as unknown as { EelZap: unknown }).EelZap
    expect(api).toBeTruthy()

    await runCopy()
    expect(initZap).toHaveBeenCalledTimes(1)
    expect((window as unknown as { EelZap: unknown }).EelZap).toBe(api)
  })
})
