# @8ux-co/eelzap

[![npm version](https://img.shields.io/npm/v/%408ux-co%2Feelzap)](https://www.npmjs.com/package/@8ux-co/eelzap)
[![license](https://img.shields.io/npm/l/%408ux-co%2Feelzap)](./LICENSE)

The Eel Zap client: typed content delivery and writes, field helpers that tag
themselves in preview, Next.js and React preview helpers, and the preview
overlay Zap's editor talks to. One package, zero runtime dependencies.

| Import                   | What                                                                                                         | Runs on            | Size, gzip         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------ |
| `@8ux-co/eelzap`         | `createClient`: delivery and writes, preview reads, cache strategies, versions, webhook verify, `cleanStega` | server and browser | under 6 KB to read |
| `@8ux-co/eelzap/fields`  | `fields(record)`: typed pick helpers that tag themselves in preview                                          | server and browser | under 1 KB         |
| `@8ux-co/eelzap/next`    | The draft-mode route, `isZapPreview()`, `<ZapPreview />`                                                     | Next.js            | under 2 KB         |
| `@8ux-co/eelzap/react`   | `<ZapPreview />`, `useZapLiveUpdates(entry)`, `onValues`                                                     | browser            | under 2.25 KB      |
| `@8ux-co/eelzap/preview` | The overlay itself. You rarely import it: the boot loads it from Zap's CDN in a preview session              | browser            | under 14 KB        |

`./analytics` is reserved for a future cookieless beacon.

The CLI that generates types from your schema is a separate dev dependency,
[`@8ux-co/eelzap-cli`](https://www.npmjs.com/package/@8ux-co/eelzap-cli)
(`npx eelzap codegen`), so neither it nor its prompts install on your site.

Every subpath is ES2020, side-effect free and dependency-free; React and Next
are optional peers. `.` and `./fields` ship ESM and CommonJS, the browser
subpaths ESM.

## Installation

```bash
npm install @8ux-co/eelzap
npm install -D @8ux-co/eelzap-cli   # optional: generated types
```

## Quick Start

```ts
import { createClient } from '@8ux-co/eelzap'

const cms = createClient({
  apiKey: process.env.EELZAP_API_KEY!,
})

const { data: posts } = await cms.items.list('blog-posts', {
  pageSize: 10,
  sort: '-publishedAt',
  locale: 'en',
})
```

## Configuration

`createClient` accepts:

| Option           | Type                              | Required | Default                  |
| ---------------- | --------------------------------- | -------- | ------------------------ |
| `apiKey`         | `string`                          | Yes      | —                        |
| `baseUrl`        | `string`                          | No       | `https://api.eelzap.com` |
| `pathPrefix`     | `string`                          | No       | `/v1`                    |
| `locale`         | `string`                          | No       | Site default locale      |
| `status`         | `'published' \| 'draft' \| 'all'` | No       | `published`              |
| `preview`        | `boolean`                         | No       | `true` for a `zpt_` key  |
| `fetch`          | `typeof fetch`                    | No       | Global `fetch`           |
| `defaultHeaders` | `HeadersInit`                     | No       | —                        |
| `timeout`        | `number`                          | No       | `30000`, per attempt     |
| `retry`          | `boolean \| RetryOptions`         | No       | On                       |

`apiKey` is a site API key (`secret_…` or `public_…`), or a preview token
(`zpt_…`) from a draft-mode URL.

### Draft preview

`preview: true` sends `preview=1` on the item and document reads
(`items.list`, `items.get`, `documents.list`, `documents.get`; the query
builder follows the client's setting): every entry comes back whatever its status, an entry with an open
draft comes back with the draft's content, and nothing is cached. It needs a
secret key that may read drafts, or a preview token; a public key is refused
with `DRAFT_ACCESS_DENIED`. Set it per client or per request — the request
wins. A client built with a `zpt_` token has it on by default.

```ts
const preview = createClient({ apiKey: previewToken }) // preview on
const post = await cms.items.get('blog-posts', 'hello-world', { preview: true })
```

### Pointing the client at another host

`baseUrl` and `pathPrefix` compose: the request URL is `baseUrl` +
`pathPrefix` + the resource path. The defaults are `https://api.eelzap.com`
and `/v1`.

```ts
// A Zap running locally on port 5047
createClient({
  apiKey,
  baseUrl: 'http://localhost:5047',
  pathPrefix: '/api/public/v1',
})

// Env-driven, which is what apps should do
createClient({
  apiKey: process.env.EELZAP_API_KEY!,
  baseUrl: process.env.EELZAP_BASE_URL, // undefined → default
  pathPrefix: process.env.EELZAP_PATH_PREFIX,
})
```

### Rate limits and retries

A site key may send 100 requests a minute (`public_`: 60), and past that the
API answers `429` with `Retry-After`. The client waits that long and tries
again, so a build that renders every page, or a seed script, does not fail
half-way. A `503` that carries `Retry-After` is retried the same way.

- **What is retried:** reads (`GET`), and writes that send an
  `Idempotency-Key` (every `create`, `media.fromUrl`, and `comments.create`,
  `reply` and `saveToDraft`), which the API deduplicates. Any other write (`update`, `delete`,
  `publish` …) is never repeated: the `429` is thrown.
- **How long it waits:** `Retry-After`, in seconds or as an HTTP date, plus up
  to a second of jitter. Without it, a `429` backs off exponentially from
  `baseDelayMs` (500 ms, then 1 s, 2 s …), half of each step random. A `503`
  without `Retry-After` is not retried.
- **When it stops:** after `retries` retries (default 3), or at once when
  `Retry-After` is longer than `maxDelayMs` (default 60 s). The last answer is
  thrown as an `EelZapError` with its status.

```ts
createClient({
  apiKey: process.env.EELZAP_API_KEY!,
  retry: {
    retries: 5, // default 3
    maxDelayMs: 30_000, // default 60000; a longer Retry-After is thrown, not waited
    baseDelayMs: 1_000, // default 500, used when there is no Retry-After
    onRetry: ({ attempt, delayMs, status, method, url }) =>
      console.warn(`[cms] ${status} on ${method} ${url}, retry ${attempt} in ${delayMs} ms`),
  },
})

createClient({ apiKey, retry: false }) // never retry
```

`timeout` applies to each attempt, not to the whole call, so a call that waits
out a `Retry-After` can take longer than `timeout`.

## Usage

### Collections

```ts
const collections = await cms.collections.list()
const blog = await cms.collections.get('blog-posts')
const created = await cms.collections.create({
  name: 'Blog Posts',
  key: 'blog-posts',
})
await cms.collections.fields.create('blog-posts', {
  key: 'title',
  name: 'Title',
  type: 'TEXT',
})
```

Field types are the API's (`FieldType`): `TEXT`, `LONG_TEXT`, `RICH_TEXT`, `NUMBER`, `INTEGER`,
`BOOLEAN`, `DATE`, `DATETIME`, `CURRENCY`, `ENUM`, `GALLERY`, `IMAGE`, `VIDEO`, `FILE`, `URL` and
`EMAIL`. The field routes (`collections.fields`, `documents.fields`) accept and answer these, and
the delivery schema reads (`collections.list`, `collections.get`, `documents.list`) publish the same
names.

### Items

```ts
const products = await cms.items.list('products', {
  page: 1,
  pageSize: 20,
  sort: '-price',
  fields: ['title', 'price', 'category'],
  filter: {
    category: 'electronics',
    price: { gte: 100, lt: 500 },
  },
})

const product = await cms.items.get('products', 'noise-cancelling-headphones', {
  locale: 'en',
})

await cms.items.create('products', {
  slug: 'noise-cancelling-headphones',
  values: {
    title: 'Noise Cancelling Headphones',
  },
})
await cms.items.publish('products', 'noise-cancelling-headphones')
```

### Query Builder

```ts
const result = await cms.items
  .collection('products')
  .locale('en')
  .filter('category', 'electronics')
  .filter('price', { gte: 100 })
  .sort('-price')
  .fields(['title', 'price'])
  .page(1)
  .pageSize(20)
  .get()
```

### Documents

```ts
const documents = await cms.documents.list({ locale: 'en' })
const homepage = await cms.documents.get('homepage', {
  locale: 'en',
  status: 'draft',
})

await cms.documents.update('homepage', {
  name: 'Homepage',
  key: 'homepage-v2',
  description: 'The main landing page',
})

await cms.documents.values.update('homepage', {
  hero_title: 'Welcome',
})
await cms.documents.seo.update('homepage', {
  metaTitle: 'Homepage',
  structuredData: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Homepage',
  },
})
```

### Site

```ts
const site = await cms.site.get()
```

### Media

```ts
const media = await cms.media.upload({
  file: new Blob(['hello'], { type: 'text/plain' }),
  filename: 'hello.txt',
  contentType: 'text/plain',
  title: 'Greeting',
})

await cms.media.publish(media.id)
```

### Content Versioning

Items and documents keep a version history. An entry has at most one open
draft: open it, stage changes on it, then publish or discard it. The live
entry does not change until the draft is published. Writing needs a secret
key; publishing and rolling back need one with publish rights.

```ts
// Open a draft from the live item (409 DUPLICATE_KEY if one is already open)
const draft = await cms.itemVersions.createDraft('blog', 'hello-world', {
  note: 'Update hero image',
})

// Stage values on the draft (and optionally a new slug)
await cms.itemVersions.updateDraft('blog', 'hello-world', {
  values: { hero_image: 'new-image-id' },
  locale: 'en',
})

// Publish it…
await cms.itemVersions.publishDraft('blog', 'hello-world')
// …or throw it away
await cms.itemVersions.discardDraft('blog', 'hello-world')

// History, newest first, and one version's snapshot
const { versions } = await cms.itemVersions.list('blog', 'hello-world')
const snapshot = await cms.itemVersions.get('blog', 'hello-world', versions[0].id)

// Restore an older version: it goes live as a NEW published version.
// Refused while a draft is open, and for a draft version.
await cms.itemVersions.rollback('blog', 'hello-world', versions[2].id)
```

Documents work the same way, keyed by the document key:

```ts
await cms.documentVersions.createDraft('homepage')
await cms.documentVersions.updateDraft('homepage', { values: { title: 'Welcome' } })
await cms.documentVersions.publishDraft('homepage')
```

`list`, `createDraft`, `publishDraft` and `rollback` answer a summary
(`ItemVersionSummary` / `DocumentVersionSummary`: number, status, author,
note, dates); `get` and `updateDraft` answer the snapshot too
(`ItemVersionDetail` / `DocumentVersionDetail`: the stored values, SEO and,
for items, slugs). A snapshot's values are the stored rows (`valueText`,
`valueInt`, …, keyed by `fieldKey`), not the delivery API's resolved values.

### Media URLs

Media values carry `url` when the file is published, and a short-lived
`signedUrl` instead when it is a draft the key may read. `getMediaUrl` picks
the one to render, or `null`:

```ts
import { getMediaUrl } from '@8ux-co/eelzap'

const src = getMediaUrl(item.content.heroImage)
```

Rich text fields need no helper: the delivery API returns them as sanitised
HTML strings, with embedded images already resolved to URLs.

## Next.js

```ts
// lib/cms.ts
import { createClient } from '@8ux-co/eelzap'

export const cms = createClient({
  apiKey: process.env.EELZAP_API_KEY!,
  baseUrl: process.env.EELZAP_BASE_URL,
  pathPrefix: process.env.EELZAP_PATH_PREFIX,
})
```

```tsx
// app/blog/page.tsx
import { cms } from '@/lib/cms'

export const revalidate = 60

export default async function BlogPage() {
  const { data } = await cms.items.list('blog-posts', { pageSize: 10 })
  return <pre>{JSON.stringify(data, null, 2)}</pre>
}
```

## Generated types

`npx eelzap codegen` (from [`@8ux-co/eelzap-cli`](https://www.npmjs.com/package/@8ux-co/eelzap-cli))
writes a type per collection and document, importing from `@8ux-co/eelzap`:

```ts
import type { BlogPostsItem } from './generated/cms'

const post = await cms.items.get<BlogPostsItem['content']>('blog-posts', 'hello-world')
```

Fields come in the order Zap's field builder shows them, sections included. A
required field is typed non-null, and a gallery is always an array; any other
field is `T | null`. The CLI's README says what that rests on.

## Preview in Zap's editor

Zap's editor shows your real page beside the form. With this package on the
page, it shows drafts as you type, unpublished entries included, and clicking
an element focuses its field. Three pieces, all optional, all free for
visitors:

1. **The boot**, `<ZapPreview />`: about 1 KB, and it makes no request
   unless a preview session is present (the page is framed by Zap, the URL
   carries `?zap`, the suggestion shortcut is pressed, or a draft-mode session
   is active). Only then does it load the overlay from Zap, pinned by an SRI
   hash compiled into the package, once per page: React StrictMode, a remount
   or a second `<ZapPreview />` add no second script and no second overlay.
2. **The draft-mode route** (`./next`), so saved drafts and unpublished
   entries render on the first load.
3. **Tags**: text fields need none (below); non-text fields take one spread
   from `fields`.

### Next.js

```tsx
// app/layout.tsx
import { draftMode } from 'next/headers'
import { ZapPreview } from '@8ux-co/eelzap/next'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <ZapPreview
          siteKey="your-site-key"
          siteId="your-site-id"
          preview={(await draftMode()).isEnabled}
        />
      </body>
    </html>
  )
}
```

```ts
// app/api/zap-preview/route.ts
import { cookies, draftMode } from 'next/headers'
import { createDraftModeRoute } from '@8ux-co/eelzap/next'

export const GET = createDraftModeRoute({
  siteKey: 'your-site-key',
  apiKey: process.env.EELZAP_API_KEY!, // one of the site's own API keys
  draftMode,
  cookies,
})
```

`<ZapPreview />` tells the editor where the route lives (`/api/zap-preview`
by default; `draftRoute="/es/preview"` or `draftRoute={null}` otherwise).
The page names only a path: the editor joins it to the page's own verified
origin, mints a ten-minute preview token and loads
`{origin}{route}?token=…&path=…`. The route checks the token with Zap
(minted for this site, live), enables draft mode with cookies that survive
inside Zap's frame (`SameSite=None; Secure; Partitioned`) and redirects to the
page without the token. `createDraftModeExitRoute({ draftMode })` ends it.

Read drafts on the server with the token as the credential:

```ts
import { cookies, draftMode, headers } from 'next/headers'
import { createClient } from '@8ux-co/eelzap'
import { getValidPreviewToken } from '@8ux-co/eelzap/next'

const token = (await draftMode()).isEnabled
  ? await getValidPreviewToken(
      { headers: await headers(), cookies: await cookies() },
      { siteKey: 'your-site-key', apiKey: process.env.EELZAP_API_KEY! },
    )
  : null
const cms = createClient({ apiKey: token ?? process.env.EELZAP_API_KEY! })
```

`getValidPreviewToken` checks the token with Zap on every request that serves
drafts and returns it only when Zap confirms it is live and minted for your
site (verdicts cached in memory, 60 seconds at most). `isZapPreview(request)`
is the cheap shape check for rendering choices; it must not gate drafts.
Browsers that block cookies in frames (Safari) send the token in the
`x-zap-preview-token` header instead, which both read.

### Other React frameworks

```tsx
import { ZapPreview, useZapLiveUpdates } from '@8ux-co/eelzap/react'
;<ZapPreview siteKey="your-site-key" siteId="your-site-id" draftRoute={null} />

const post = useZapLiveUpdates(props.post) // the entry with unsaved values merged in
```

### Without a bundler

```html
<script
  src="https://zap.eel.software/js/preview/boot.v1.<hash>.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-site="your-site-key"
  data-site-id="your-site-id"
  async
></script>
```

The exact URL and `integrity` are in your site's settings in Zap.
`data-zap-draft-route="/your/route"` announces a draft-mode route.

### Local development

The site and Zap can both run on your machine, with no shim. Zap accepts a
site URL (and «Otros dominios») over `http` or `https` on `localhost`,
`127.0.0.1` and `*.localhost` names, any port; every other host must be
`https`. Pass the Zap you work against:

```tsx
<ZapPreview siteKey="your-site-key" zapOrigin={process.env.EELZAP_ORIGIN} />
```

The boot loads the overlay from the Zap that framed the page when it is a Zap
origin (production, or a local Zap seen from a local page), else from
`zapOrigin` under the same rule, else from `https://zap.eel.software`. The path
and the SRI hash are compiled in, so only the released bytes run, whichever Zap
serves them, and the overlay trusts the Zap it came from. A local `zapOrigin`
left in production code is ignored. On the tag, it is `data-zap-origin`;
`authOrigin` (`data-auth-origin`) names a local Eel under the same rule.

### Text fields find themselves: stega

Preview reads (`preview: true`) append an invisible marker to TEXT and
LONG_TEXT values and to the last text node of each RICH_TEXT block, naming
the record, the field and the locale. The overlay reads the markers in the
page's text, so any element that renders a text field is found, in lists and
cards too, with no tag. Published reads never carry a marker.

Where your code compares, parses or puts a preview value in an attribute, a
URL or `<head>`, clean it, or read without markers:

```ts
import { cleanStega } from '@8ux-co/eelzap'

const slugLike = cleanStega(post.content.title).toLowerCase()
const seo = await cms.documents.get('home', { preview: true, stega: false })
```

Only prose fields are encoded; slugs, URLs, emails, numbers, dates, enums,
booleans, JSON and media never are.

### Non-text fields: `fields`

```tsx
import { fields } from '@8ux-co/eelzap/fields'

const f = fields(home) // a HomeDocument from `eelzap codegen`

<h1>{f.text('hero_title')}</h1>
<img {...f.image('hero_image')} />
<a href={f.value('cta_url') ?? '/'} {...f.attrs('cta_url')}>Ver más</a>
<a href={`mailto:${f.value('email')}`} {...f.attrs('email')}>Escríbenos</a>

// Numbered fields, `stat_1` … `stat_4`
{f.list('stat', 4).map((s) => <p key={s.key}>{s.text()}</p>)}

// Slots of several fields, `nav_1_texto` + `nav_1_url` … `nav_5_…`
{f.list('nav', 5)
  .filter((nav) => !nav.empty)
  .map((nav) => (
    <a key={nav.key} href={nav.value('url') ?? '/'} {...nav.attrs('url')}>
      {nav.text('texto')}
    </a>
  ))}
```

Keys are typed from your generated types, so a typo fails to compile.
Outside preview every helper returns plain values and empty attribute
objects, so production HTML is byte-identical to reading the values
directly. In preview, text keeps its marker and the other helpers add
`data-zap="record#field"`. `value`, `image` and `attrs` never carry a marker.
The tag grammar by hand: `data-zap="blog-posts/my-post#cover"` for an entry,
`data-zap="doc:home#cta_url"` for a document. A manual tag on an element wins
over a marker in its text.

A URL or EMAIL field tagged on a link updates the link's `href` as the editor
types (`mailto:` for an email) and leaves its label alone: «Ver más» stays «Ver
más». Tag the `<a>` or an element around it; with no link inside, the address
shows as text. An image field updates `src` and `alt`, never text.

`f.list(prefix, n)` returns slots `1` … `n`, each a `FieldSlot` with the same
helpers scoped to it: without a suffix they read `prefix_{i}` (`s.text()`,
`s.value()`, `s.attrs()`, `s.image()`), with one `prefix_{i}_{suffix}`
(`nav.text('texto')`, `nav.value('url')`). Suffixes are typed from your
generated types. Each slot has `key` (`nav_1`), `index` (from 1) and `empty`
(every field of the slot is empty).

### Values your site computes

The overlay updates every element it found as you type. For values your code
derives (excerpts, counts), `useZapLiveUpdates(entry)` returns the entry with
the unsaved values merged in, and `onValues(entry, handler)` from
`@8ux-co/eelzap/react` calls you with each patch (it is framework-free; the
overlay also announces each patch as an `eelzap:values` window event).

### Suggestions on the live site

With `siteId`, people with a Zap seat in your workspace can suggest changes on
your live site: `?zap` in the URL, or Shift Z (`shortcut="K"` picks another
letter, `shortcut={false}` turns it off), shows «Editar o comentar» at the
bottom centre of the page, clear of the corners sites keep for their own
floating buttons, and it opens a sign-in with Eel in a popup. The client must also run on your home page `/`, where the sign-in
lands. With a Content-Security-Policy, allow `https://zap.eel.software` in
`script-src` and `connect-src` and `https://auth.eel.software` in
`connect-src`. Everything renders in a closed Shadow DOM.

## Resilience & Caching

The SDK ships a `cachedFetch` helper and a `CacheAdapter` interface for
application-level content caching, with two strategies:

- `network-first` (default): always fetch fresh content, cache it on success,
  and fall back to the last cached value when the fetch fails.
- `cache-first`: return cached content immediately when there is some, and
  fetch only on a miss.

If nothing is cached and the fetch fails, the original error is re-thrown so
your app can handle it explicitly.

### Quick examples

```ts
import { createClient, cachedFetch, MemoryCacheAdapter } from '@8ux-co/eelzap'

const cms = createClient({ apiKey: process.env.EELZAP_API_KEY! })
const cache = new MemoryCacheAdapter()

// Positional form: always network-first
const homepage = await cachedFetch('homepage', () => cms.documents.get('homepage'), cache)

// Options form: choose the strategy
const posts = await cachedFetch({
  key: 'blog:page-1',
  adapter: cache,
  strategy: 'cache-first',
  fetcher: () => cms.items.list('blog-posts', { pageSize: 10 }),
})
```

#### `network-first`

1. Runs your `fetcher`.
2. Stores the fresh result in the adapter and returns it.
3. If the fetch fails, returns the last cached value when there is one.

#### `cache-first`

1. Reads the adapter.
2. Returns the cached value on a hit.
3. On a miss, runs your `fetcher`, stores the result and returns it.

Pair `cache-first` with [webhooks](#webhooks) to drop keys when content
changes.

### Custom cache adapters

`MemoryCacheAdapter` works for long-lived servers but data is lost on
restart. Implement the `CacheAdapter` interface to persist to any
backend:

```ts
import type { CacheAdapter } from '@8ux-co/eelzap'

// Example: filesystem adapter (Node.js)
class FsCacheAdapter<T = unknown> implements CacheAdapter<T> {
  #dir: string
  constructor(dir: string) {
    this.#dir = dir
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(path.join(this.#dir, `${key}.json`), 'utf8')
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }

  async set(key: string, value: T): Promise<void> {
    await fs.mkdir(this.#dir, { recursive: true })
    await fs.writeFile(path.join(this.#dir, `${key}.json`), JSON.stringify(value))
  }
}
```

Other backends that work well: Vercel KV, Cloudflare KV, Redis,
IndexedDB (for client-side apps), or your framework's built-in cache.

### Recommendations

| Scenario                               | Recommended adapter               | Notes                                   |
| -------------------------------------- | --------------------------------- | --------------------------------------- |
| Long-running server (Express, Fastify) | `MemoryCacheAdapter`              | Fast, no I/O; lost on restart           |
| Serverless (Lambda, Vercel Functions)  | File system or KV store           | Memory is discarded between invocations |
| Edge (Cloudflare Workers)              | KV or Durable Objects             | Workers have no filesystem              |
| Static builds (Astro, Gatsby)          | Not needed                        | Content is fetched at build time        |
| Client-side SPA                        | IndexedDB or localStorage adapter | Survives page reloads                   |

### Why not hardcoded fallbacks?

Hardcoded default strings go stale immediately and create a maintenance
burden. With `cachedFetch`, your site always serves real CMS content:

- **First deploy:** content is fetched fresh and cached.
- **CMS goes down:** last-known-good content is served seamlessly.
- **CMS recovers:** the cache is silently refreshed on the next request.
- **Content never fetched:** the error propagates — you decide how to
  handle it (error page, skeleton, etc.) rather than showing stale
  placeholder text.

## Webhooks

Zap sends webhooks to the workspace endpoints set up in Nest (workspace
settings, Webhooks), subscribed to the `zap.*` events you want and narrowed to sites.
Each delivery is a JSON envelope signed with the endpoint's `whsec_…` secret:

| Header            | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| `X-Eel-Timestamp` | Unix seconds when it was sent                              |
| `X-Eel-Signature` | `v1=` + hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` |
| `X-Eel-Event`     | The event name, e.g. `zap.item.published`                  |
| `X-Eel-Event-Id`  | The envelope `id`, the same for every endpoint and retry   |
| `X-Eel-Delivery`  | This endpoint's delivery id                                |
| `X-Eel-Attempt`   | The attempt number, from 1                                 |

### Verifying a delivery

`verifyWebhookSignature(payload, headers, secret, options?)` checks the
signature over the raw body and timestamp, and refuses a timestamp more than
five minutes away (`toleranceSeconds` changes that), which is what stops a
captured delivery being replayed. It resolves `false` for anything
inauthentic or malformed. It uses WebCrypto only, so it runs in Node 20+,
edge runtimes, workers and browsers; it throws if the runtime has no
`globalThis.crypto` (Node 18 needs `globalThis.crypto` set to `node:crypto`'s
`webcrypto`).

```ts
import { verifyWebhookSignature, type WebhookPayload } from '@8ux-co/eelzap'

export async function POST(request: Request) {
  // The raw body, exactly as received — never a re-serialised parse.
  const payload = await request.text()

  const valid = await verifyWebhookSignature(
    payload,
    request.headers, // a Headers object, or a plain object such as Express's req.headers
    process.env.EELZAP_WEBHOOK_SECRET!,
  )
  if (!valid) {
    return new Response('Invalid signature', { status: 401 })
  }

  const event = JSON.parse(payload) as WebhookPayload
  // `event.id` is the same across retries: dedupe on it.
  return new Response('ok')
}
```

### Payload

Every delivery is the same envelope; `data` depends on the event and is
minimal by design — ids, keys, slugs, version numbers and the names of what
changed, never a field value. Read the content itself with the client.

```ts
interface WebhookPayload<TData = unknown> {
  id: string // idempotency key
  type: WebhookEventName // 'zap.item.published', 'zap.document.updated', 'ping', …
  version: number // payload contract version: 2
  app: string // 'zap'
  workspace_id: string
  occurred_at: string // ISO timestamp
  actor: { user_id: string | null; display_name: string; kind: 'USER' | 'SYSTEM' | 'API_KEY' }
  subject: { workspace_id: string; site_id?: string; collection_id?: string }
  data: TData
}
```

The item, document and media events have typed `data`:
`WebhookItemEventData` (`site`, `collection`, `items`),
`WebhookDocumentEventData` (`site`, `documents`) and `WebhookMediaEventData`
(`site`, `media`).

The `zap.comment.*` events (`created`, `replied`, `resolved`, `reopened`,
`updated`) carry `{ site, collection, comments }`, where each entry has the
thread's `id`, its `url` and its `target`, plus the event's own fields. They
never include comment text. Their types are `WebhookCommentCreatedData`,
`WebhookCommentRepliedData`, `WebhookCommentResolvedData`,
`WebhookCommentReopenedData` and `WebhookCommentUpdatedData`.

### Cache invalidation

`webhookChanges(payload)` flattens an event into the changes a site
revalidates by, `{ type, action, id, resourceKey, collectionKey?, siteKey }`:

| `type`       | From                                                                    | `resourceKey`        | `collectionKey` |
| ------------ | ----------------------------------------------------------------------- | -------------------- | --------------- |
| `item`       | `zap.item.*`, and `zap.seo.updated` on entries (action `updated`)       | the entry's slug     | its collection  |
| `document`   | `zap.document.*`, and `zap.seo.updated` on documents (action `updated`) | the document's key   |                 |
| `document`   | `zap.schema.field_changed` on a document's fields (`field_changed`)     | the document's key   |                 |
| `media`      | `zap.media.*`                                                           | the file's id        |                 |
| `collection` | `zap.collection.*`                                                      | the collection's key | the same key    |
| `collection` | `zap.schema.field_changed` on a collection's fields (`field_changed`)   | the collection's key | the same key    |
| `site`       | `zap.site.updated`                                                      | the site's key       |                 |

One event can name several entries, documents or files: each is its own
change. A `collection` change means everything that shows that collection; a
`site` change means the whole site. Drafts (`draft_updated`), assignments,
comments, API keys, `ping`, and sites created or deleted give an empty list.

A `zap.schema.field_changed` sent before the event carried `collection_key`
and `document_key` names its owners by id only: a collection's fields give a
`collection` change whose `resourceKey` is the collection's id, with no
`collectionKey`, and a document's fields give one `site` change.

#### Subscribing a live site

Subscribe the site's webhook, narrowed to the site with `site_ids`, to:

- the `zap.item.*`, `zap.document.*` and `zap.media.*` events, except
  `zap.item.draft_updated`, `zap.document.draft_updated`, `zap.item.assigned`
  and `zap.document.assigned`;
- `zap.collection.created`, `zap.collection.updated` and
  `zap.collection.deleted`;
- `zap.seo.updated`, `zap.schema.field_changed` and `zap.site.updated`.

Do not subscribe to `draft_updated` or `assigned`: a saved draft and a new
Responsable change nothing the site serves, and drafts save often.

#### Revalidating

A Next.js route handler for a site that serves documents at `/<key>` and
entries at `/<collection>/<slug>`:

```ts
// app/api/zap-webhook/route.ts
import { revalidatePath } from 'next/cache'
import {
  verifyWebhookSignature,
  webhookChanges,
  type WebhookChange,
  type WebhookPayload,
} from '@8ux-co/eelzap'

function revalidate(change: WebhookChange) {
  switch (change.type) {
    case 'item':
      revalidatePath(`/${change.collectionKey}/${change.resourceKey}`)
      revalidatePath(`/${change.collectionKey}`) // the listing
      return
    case 'document':
      revalidatePath(`/${change.resourceKey}`)
      return
    case 'collection':
      // An older field change without the key names the collection by id: refresh the whole site.
      revalidatePath(change.collectionKey ? `/${change.collectionKey}` : '/', 'layout')
      return
    case 'media':
    case 'site':
      revalidatePath('/', 'layout')
      return
  }
}

export async function POST(request: Request) {
  const payload = await request.text()
  if (
    !(await verifyWebhookSignature(payload, request.headers, process.env.EELZAP_WEBHOOK_SECRET!))
  ) {
    return new Response('Invalid signature', { status: 401 })
  }

  for (const change of webhookChanges(JSON.parse(payload) as WebhookPayload)) {
    revalidate(change)
  }
  return new Response('ok')
}
```

With `cachedFetch` and a `MemoryCacheAdapter`, do the same with
`cache.delete(key)` for an item or a document, and `cache.clear()` for a
`collection`, `media` or `site` change.

`WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER` and
`WEBHOOK_TOLERANCE_SECONDS` export the header names and the default window.

## Error Handling

```ts
import { isEelZapError } from '@8ux-co/eelzap'

try {
  await cms.items.get('blog-posts', 'missing-post')
} catch (error) {
  if (isEelZapError(error)) {
    console.error(error.code, error.status, error.message)
  }
}
```

## TypeScript

Use generics when you know a content shape:

```ts
type BlogPost = {
  title: string
  excerpt: string
}

const post = await cms.items.get<BlogPost>('blog-posts', 'hello-world')
post.content.title
```

## Client Reference

Everything `.` exports, at a glance (TypeDoc has the details: `npm run docs`).

| `EelZapClient` member  | Methods                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `site`                 | `get`                                                                                                              |
| `collections`          | `list`, `get`, `create`, `update`, `delete`                                                                        |
| `collections.fields`   | `list`, `create`, `update`, `delete`, `reorder`, `listDeleted`, `restore`                                          |
| `collections.sections` | `list`, `get`, `create`, `update`, `delete`                                                                        |
| `items`                | `list`, `get`, `collection` (query builder), `create`, `update`, `delete`, `publish`, `unpublish`                  |
| `items.seo`            | `get`, `update`                                                                                                    |
| `itemVersions`         | `list`, `get`, `createDraft`, `updateDraft`, `discardDraft`, `publishDraft`, `rollback`                            |
| `documents`            | `list`, `get`, `create`, `update`, `delete`, `publish`, `unpublish`                                                |
| `documents.fields`     | `list`, `get`, `create`, `update`, `delete`, `reorder`, `listDeleted`, `restore`                                   |
| `documents.sections`   | `list`, `get`, `create`, `update`, `delete`                                                                        |
| `documents.values`     | `get`, `update`                                                                                                    |
| `documents.seo`        | `get`, `update`                                                                                                    |
| `documentVersions`     | `list`, `get`, `createDraft`, `updateDraft`, `discardDraft`, `publishDraft`, `rollback`                            |
| `media`                | `list`, `get`, `update`, `delete`, `publish`, `unpublish`, `createUploadUrl`, `confirmUpload`, `upload`, `fromUrl` |
| `sites`                | `list`                                                                                                             |
| `previewTokens`        | `validate`                                                                                                         |
| `comments`             | `list`, `get`, `create`, `update`, `reply`, `apply`, `saveToDraft`, `onPage`                                       |
| `toString()`           | The client with its API key masked                                                                                 |

`ItemQueryBuilder` (from `items.collection(key)`): `locale`, `status`,
`filter`, `sort`, `fields`, `page`, `pageSize`, `get`, `toJSON`.

| Function                                                      | Purpose                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `createClient(config)`                                        | Build a client ([Configuration](#configuration))                         |
| `cachedFetch(key, fetcher, adapter)` / `cachedFetch(options)` | [Resilience & Caching](#resilience--caching)                             |
| `getMediaUrl(media)`                                          | [Media URLs](#media-urls)                                                |
| `verifyWebhookSignature(payload, headers, secret, options?)`  | [Webhooks](#webhooks)                                                    |
| `webhookChanges(payload)`                                     | [Cache invalidation](#cache-invalidation)                                |
| `isEelZapError(error)`                                        | [Error Handling](#error-handling)                                        |
| `cleanStega(value)` / `hasStega(value)`                       | [Text fields find themselves: stega](#text-fields-find-themselves-stega) |

Classes: `EelZapClient`, `MemoryCacheAdapter`, `EelZapError`,
`EelZapNetworkError`, `ItemQueryBuilder`, and one `…Resource` class per row
of the table above. Codegen lives in `@8ux-co/eelzap-cli`.

### Credentials, scopes and the 0.10.0 additions

Credentials, in the order the API checks them:

- **Secret key** (`secret_…`): one site, everything on it, while site-key management is on.
- **Public key** (`public_…`): one site, published delivery reads only.
- **Preview token** (`zpt_…`): one site, ten minutes, delivery reads only, always as preview.
- **Suite bearer** (`eel_sk_…` workspace key or `eel_at_…` OAuth token): a person in a workspace,
  limited by scopes. Send the site in `X-Eel-Site` on every call except `sites.list()`:

```ts
const zap = createClient({
  apiKey: process.env.EEL_API_KEY!,
  defaultHeaders: { 'X-Eel-Site': 'verdeorigen' },
})
```

Every create the API deduplicates sends an `Idempotency-Key`, which suite bearers must send:
`collections.create`, `collections.fields.create`, `collections.sections.create`,
`items.create`, `documents.create`, `documents.fields.create`, `documents.sections.create`,
`media.fromUrl`, and `comments.create`, `reply` and `saveToDraft`. The SDK makes a fresh key for
each call (`crypto.randomUUID()`) and never retries on its own. To make your retry safe, pass
your own key as the last argument, `{ idempotencyKey }`, and reuse it on the retry:

```ts
const key = crypto.randomUUID()
const create = () => zap.items.create('blog', { slug: 'hola', values: {} }, { idempotencyKey: key })
const item = await create().catch(create) // the retry replays the first answer, no duplicate
```

Make these writes from server code: the API's CORS rules do not allow the `Idempotency-Key`
header from a browser.

#### Preview reads: `stega`

`preview: true` responses add invisible stega markers to prose fields (TEXT, LONG_TEXT, and the
last text node of each RICH_TEXT block), so the preview overlay can find them on the page.
Pass `stega: false` to turn the markers off for one request. It sends `stega=0` and only has an
effect together with `preview`. Use it in server code that compares text or uses it as a key, and
for `<title>` and meta tags. A read without `preview` never has markers and sends nothing.

```ts
const doc = await zap.documents.get('home', { preview: true, stega: false })
const items = await zap.items.list('blog', { preview: true, stega: false })
```

The `cachedFetch` strategies (`network-first` and `cache-first`) return preview responses but never
store them. This covers any read with `preview: true` and any read made with a `zpt_` token.

#### `sites`

`list(): SiteListEntry[]` calls `GET /sites`. It needs a suite bearer with `zap:sites:read` and no
`X-Eel-Site`, because this call is how you find out which values `X-Eel-Site` accepts. It returns
the workspace's sites, newest first, as `GET /site` does, plus `url`. Site keys are refused.

```ts
const zap = createClient({ apiKey: process.env.EEL_API_KEY! })
const sites = await zap.sites.list()
const site = createClient({
  apiKey: process.env.EEL_API_KEY!,
  defaultHeaders: { 'X-Eel-Site': sites[0]!.key },
})
```

#### `previewTokens`

`validate(siteApiKey): PreviewTokenValidation` calls `GET /preview/token`. It checks that the
client's preview token is live and was minted for the site that `siteApiKey` belongs to. Run it
before you trust a token taken from a URL. The client's `apiKey` must be the `zpt_` token. Any
other bearer gets 403. `siteApiKey` is one of the site's own keys (public or secret) and is sent as
`X-Zap-Site-Api-Key`. The response is `{ site: { key }, expiresAt? }`. An unknown, revoked or
expired token rejects with 401, and another site's token with 403 `WRONG_SITE`.

```ts
const zap = createClient({ apiKey: tokenFromUrl })
const { site, expiresAt } = await zap.previewTokens.validate(process.env.ZAP_PUBLIC_KEY!)
```

#### `media.fromUrl`

`fromUrl(input, opts?): MediaDetail` calls `POST /media/from-url`. It needs a secret key, or a
suite bearer with `zap:media:write`. Zap downloads the file on its own servers, with SSRF checks
on every redirect, a list of allowed types and a size limit. The new file starts as `DRAFT`, so
the response has a 15-minute `signedUrl` and no `url` until you call `media.publish(id)`.
`filename` defaults to the last segment of the URL. Errors: 422 `URL_NOT_ALLOWED`, 415
`UNSUPPORTED_MEDIA_TYPE`, 413 `FILE_TOO_LARGE`, 502 `FETCH_FAILED`. Call it from server code only,
because the API's general CORS rules do not allow the `Idempotency-Key` header from a browser.

```ts
const media = await zap.media.fromUrl({
  url: 'https://example.com/hero.jpg',
  alt: 'Hero',
})
await zap.media.publish(media.id)
```

#### `comments`

«Comentarios» are comment threads on an entry or a document. A thread flagged `isChangeRequest`
can also have an assignee, proposed values and, once resolved, a resolution (`APPLIED` or
`DISMISSED`). A plain comment has none of these. These methods need a suite bearer and
`X-Eel-Site`, because every comment is written by a person. Site keys are refused. Records are
named by key: an entry by `collection` + `slug`, or a document by `document`. Fields in anchors
and proposed values are also named by key.

| Method                       | Route                          | Scope                                      |
| ---------------------------- | ------------------------------ | ------------------------------------------ |
| `list(opts?)`                | `GET /comments`                | `zap:content:read`                         |
| `get(id)`                    | `GET /comments/{id}`           | `zap:content:read`                         |
| `create(input, opts?)`       | `POST /comments`               | `zap:content:write` or `zap:suggest:write` |
| `update(id, input)`          | `PATCH /comments/{id}`         | `zap:content:write`                        |
| `reply(id, { body }, opts?)` | `POST /comments/{id}/replies`  | `zap:content:write` or `zap:suggest:write` |
| `apply(id)`                  | `POST /comments/{id}/apply`    | `zap:content:write`                        |
| `saveToDraft(input, opts?)`  | `POST /comments/save-to-draft` | `zap:content:write` or `zap:suggest:write` |
| `onPage(url, refs?)`         | `GET /comments/on-page`        | the site's own suggestion client only      |

- `list` filters by record, `isChangeRequest`, `status` (`OPEN` or `RESOLVED`), `resolution`,
  `pageUrl` and `assignee` (`me`, `none` or a user id), with `page` and `pageSize` (at most 100).
  It returns `{ items, counts: { OPEN, RESOLVED }, page, pageSize, total, hasMore }`.
- `get`, `create` and `update` return `{ thread, comments }`. `create` takes the first comment as
  `body`, 0 to 20 `anchors` (a field, an element, both, or a `spot` pin) and the `pageUrl` they were
  made on. Element and spot anchors need that `pageUrl`. `assigneeId` and `proposedValues` are for
  change requests only. Without `assigneeId`, a change request is assigned to the record's
  Responsable when they hold Zap.
- `update` changes `status`, a change request's `resolution`, the `isChangeRequest` flag, the
  assignee, or the first comment's `body`. Turning the flag off for a thread with proposed values is
  409 `HAS_PROPOSAL`, and for one with any linked Swarm task (open or done) 422 `HAS_LINKED_TASKS`:
  unlink the tasks in the editor first. Giving an assignee or a resolution to a plain comment is 422
  `NOT_A_CHANGE_REQUEST`.
- `apply` writes an open change request's proposed values into the record's draft and resolves it
  as `APPLIED`. It returns `{ thread, comments, draftVersionId }`. It fails with 409 `NO_PROPOSAL`
  or `NOT_OPEN`.
- `saveToDraft` writes values straight into the draft. It records them as a change request that is
  already resolved as `APPLIED`, and nobody is notified. It is 403 when the site has live editing
  turned off.
- `create`, `reply` and `saveToDraft` send an `Idempotency-Key`, as `media.fromUrl` does.

```ts
const zap = createClient({
  apiKey: process.env.EEL_API_KEY!,
  defaultHeaders: { 'X-Eel-Site': 'verdeorigen' },
})
const { thread } = await zap.comments.create({
  collection: 'blog',
  slug: 'hello-world',
  isChangeRequest: true,
  body: 'A shorter title?',
  proposedValues: [{ fieldKey: 'title', value: 'Hello' }],
})
await zap.comments.reply(thread.id, { body: 'Agreed.' })
await zap.comments.apply(thread.id)
```

Threads send the `zap.comment.created`, `zap.comment.replied`, `zap.comment.resolved`,
`zap.comment.reopened` and `zap.comment.updated` webhook events (see [Webhooks](#webhooks)).

#### Archived fields: `collections.fields` and `documents.fields`

Deleting a field archives it and keeps its values.

- `listDeleted(key): FieldInfo[]` calls `GET /collections/{key}/fields/deleted` or
  `GET /documents/{key}/fields/deleted`. It needs a secret key, or a suite bearer with
  `zap:content:read`. The most recently deleted field comes first.
- `restore(key, fieldId): FieldInfo` calls `POST …/fields/{fieldId}/restore`. It needs a secret
  key, or a suite bearer with `zap:schema:write` and the Zap ADMIN role. The field comes back with
  all its values, at the end of the root list and outside any section.

```ts
const [archived] = await zap.collections.fields.listDeleted('blog')
if (archived) await zap.collections.fields.restore('blog', archived.id)
```

## Security

- Keep secret keys on the server only; use public keys for browser clients.
- Preview responses carry drafts: they need a draft-capable credential, are
  `private, no-store`, and the SDK's cache strategies never store them.
- `EelZapClient#toString()` masks the API key for safer logging.
- The boot loads the overlay only from the CDN URL and SRI hash compiled into
  the package, never from a URL in the page.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

`npm run docs` generates the TypeDoc reference into `docs/`.

## License

MIT
