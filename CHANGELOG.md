# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - Unreleased

The first release as **`@8ux-co/eelzap`**, which replaces
`@8ux-co/eelzap-api-sdk-ts` (its last release, 0.9.1, points here). One
package for the delivery client and the preview client, with subpaths. The
version continues the old line.

### Added

- `EelZapError.details`: a validation refusal from the API lists each problem as `{ path, message, code }` (`ApiErrorDetail`); empty for other errors.
- **Retries of `429`, and of `503` with `Retry-After`.** On by default: the
  client honours `Retry-After` (seconds or an HTTP date, plus jitter), backs
  off exponentially without it, and gives up after `retries` (default 3) or
  when `Retry-After` exceeds `maxDelayMs` (default 60 s). Only reads and writes
  that carry an `Idempotency-Key` are retried; no other write is ever
  repeated. `createClient({ retry: false | { retries, maxDelayMs, baseDelayMs,
onRetry } })`; `RetryOptions` and `RetryEvent` are exported. `timeout` is per
  attempt.
- **Subpaths.** `.` (the client), `./fields`, `./next`, `./react` and
  `./preview`; `./analytics` is reserved. Zero runtime dependencies, React and
  Next optional peers, ES2020, `sideEffects: false`, ESM and CJS for `.` and
  `./fields`, ESM for the browser subpaths, with a gzip budget per subpath
  checked in CI (`.` under 6 KB for a delivery-only import, `./fields` 1 KB,
  `./next` 2 KB, `./react` about 2.2 KB, the boot about 1.2 KB, `./preview`
  about 13.25 KB).
- **The preview boot.** `<ZapPreview />` (`./next`, `./react`) and a script
  tag: under 1 KB, no request outside a preview session (framed by Zap,
  `?zap`, the suggestion shortcut, a draft-mode session); in one, it loads the
  overlay with an SRI hash compiled into the package, from the Zap that framed
  the page, else `zapOrigin`, else `https://zap.eel.software`. A local Zap
  counts only from a local page: `localhost`, `127.0.0.1`, `[::1]` or
  `*.localhost`, over http or https, so local preview needs no shim. One
  script and one overlay per page, under React StrictMode and remounts too.
- **The overlay** (`./preview`), formerly the unpublished
  `@8ux-co/eelzap-preview`: the editor bridge, tag index, outlines, value
  substitution, select mode and the suggestion chunks. `zap:ready` announces
  the site's draft-mode route as a path; `zap:tags` says whether each field was
  found by a tag or by stega. A URL or EMAIL value (`{ url }`, `{ email }`,
  for a client advertising `links`) updates a tagged link's `href`
  (`mailto:` for an email) and never its label. «Editar o comentar» sits at
  the bottom centre, clear of a site's own corner buttons. Zap's editor frames the site by its real URL:
  its side of the bridge accepts messages only from the site's own preview
  origins and posts only to the exact origin that said `zap:ready`, never to
  `'*'`.
- **Stega.** Preview reads carry invisible markers on TEXT, LONG_TEXT and
  RICH_TEXT values, and the overlay finds the elements that render them with
  no tag. `cleanStega(value)` and `hasStega(value)` in `.`; a `stega: false`
  read option sends `stega=0`.
- **`fields(record)`** (`./fields`): typed pick helpers (`text`, `value`,
  `attrs`, `image`, `list`) whose keys come from generated types; plain values
  outside preview, `data-zap` attributes in preview. `list(prefix, n)` returns
  `FieldSlot`s with the same helpers scoped to each slot, for `prefix_{i}`
  (`s.text()`) and for slots of several fields `prefix_{i}_{suffix}`
  (`nav.text('texto')`, `nav.value('url')`), suffixes typed; each has `key`,
  `index` and `empty`.
- **`./next`:** `isZapPreview(request)`, `<ZapPreview />` announcing
  `/api/zap-preview` by default, beside `createDraftModeRoute`,
  `createDraftModeExitRoute`, `getPreviewToken` and `getValidPreviewToken`.
- **`./react`:** `onValues(entry, handler)` and `useZapLiveUpdates(entry)`
  without the overlay in your bundle (they listen to the overlay's
  `eelzap:values` event).
- **The public routes the client did not reach:** `sites.list`,
  `previewTokens.validate`, `media.fromUrl`, and `listDeleted` and `restore`
  on collection and document fields. `media.fromUrl` sends an
  `Idempotency-Key`.
- **`comments`** («Comentarios»): `list`, `get`, `create`, `update`, `reply`,
  `apply`, `saveToDraft` and `onPage` over the public `/comments` routes,
  typed from the routes' schemas (`CommentThread`, `ThreadComment`,
  `CreateCommentInput`, …). A thread is a plain comment or, with
  `isChangeRequest`, a change request with an assignee, proposed values and a
  resolution. `create`, `reply` and `saveToDraft` send an `Idempotency-Key`.
- From the 0.8.0 to 0.9.0 line, now in this package: `cachedFetch` with
  `network-first` and `cache-first`, `itemVersions` and `documentVersions`,
  `verifyWebhookSignature` (WebCrypto, so edge runtimes and workers too) and
  `webhookChanges`, `getMediaUrl`, and the `preview` read option with `zpt_`
  preview tokens as the API key.
- **Webhook test vectors** in the repository: a fixed secret, timestamp, body
  and signature from Zap's signer, with tests of `verifyWebhookSignature` over
  them in Node and in an edge-like runtime.

### Changed

- **The CLI and codegen moved to `@8ux-co/eelzap-cli`** (bin `eelzap`,
  `eelzap codegen`; `@8ux-co/eelzap-cli/codegen` for the programmatic API).
  Generated code imports its types from `@8ux-co/eelzap`. This package no
  longer depends on `@inquirer/prompts` or `dotenv`.
- `verifyWebhookSignature(payload, headers, secret, options?)` takes the
  request headers and checks the signed timestamp; `WebhookPayload` is the
  suite event envelope.
- The cache strategies never store a preview response.
- **`FieldType` is the API's**: `TEXT`, not `SHORT_TEXT`, which the field
  routes refuse with a 400. Field creates, the field routes' answers and the
  delivery schema reads (`collections.list`, `collections.get`,
  `documents.list`) all use it: the delivery API publishes a text field as
  `TEXT` too, no longer `SHORT_TEXT`.
- **Every create sends an `Idempotency-Key`**, which suite bearers must send:
  `collections.create`, `collections.fields.create`,
  `collections.sections.create`, `items.create`, `documents.create`,
  `documents.fields.create` and `documents.sections.create` now do, as
  `media.fromUrl` and the comment writes already did. A fresh key per call;
  each takes a last `{ idempotencyKey }` argument to reuse a key on your own
  retry. Make these writes from server code (the API's CORS does not allow the
  header from a browser).
- **Comment webhook events.** The `zap.change_request.*` events are now
  `zap.comment.created`, `zap.comment.replied`, `zap.comment.resolved`,
  `zap.comment.reopened` and `zap.comment.updated`, with typed `data`
  (`WebhookCommentCreatedData`, …), for plain comments and change requests
  alike.
- **The live-site suggestion client calls `/comments`** instead of
  `/change-requests`: it sends `isChangeRequest` (true when there is a
  proposed value) and one top-level `pageUrl` in place of a per-anchor one, and
  reads `liveEditing` and `comments` from `on-page`. New CDN release
  (`boot.v1.a86632b937c1e248.js`).
- **`CurrencyValue` is `{ amountMinor, currency }`**, the name a write takes:
  the delivery API answered `amount` while every write took `amountMinor`,
  both in minor units. A currency value read can be written back unchanged.
- **`site.update({ url, previewOrigins })`** (`PATCH /site`) sets the site's
  address and the extra origins drafts may be shown on, under the settings
  page's rules, and `site.get()` reads both. `collections.update()` and
  `documents.update()` take `previewPath`. Server code, with a `secret_` key
  or an ADMIN suite credential.
- **A refused body says what was wrong.** The `400` message names each problem
  (`Invalid input: key: …; type: …`) instead of a bare `Invalid input`, and the
  body lists them in `error.details` (`path`, `message`, `code`).

## [0.2.0] - 2026-03-14

### Added

- Write operations for collections, items, documents, media, and site introspection.
- Nested resource clients for fields, sections, document values, and SEO.
- Configurable `pathPrefix` support for production rewrites and local `next-app` development.

## [0.1.0] - 2026-03-11

### Added

- Initial standalone SDK implementation for the EelZap Content Delivery API.
