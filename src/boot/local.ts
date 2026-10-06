/**
 * Development origins: `localhost`, `127.0.0.1`, `[::1]` and any `*.localhost`
 * name (which browsers resolve to the machine itself and treat as secure
 * contexts), over http OR https, any port: a site in development runs on
 * either.
 *
 * Shared by the boot (`./boot.ts`, which every visitor runs, so one regex and
 * no more) and the overlay (`../preview/live.ts`), so the two never disagree
 * about what counts as local.
 */
export const LOCAL_ORIGIN =
  /^https?:\/\/(?:(?:[a-z\d-]+\.)*localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i

/** True for a development hostname (no scheme, no port). */
export const isLocalHost = (hostname: string): boolean => LOCAL_ORIGIN.test(`http://${hostname}`)
