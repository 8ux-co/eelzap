import { recordRefsOf } from './refs'
import { cleanStega, hasStega } from './stega'

/**
 * `@8ux-co/eelzap/fields` (`.docs/proposals/zap-cms-v2.md` §2.4, §2.7): typed
 * pick helpers over an item or a document that tag themselves in preview.
 *
 * ```tsx
 * import { fields } from '@8ux-co/eelzap/fields'
 *
 * const f = fields(home)                  // a HomeDocument from codegen
 * <h1>{f.text('hero_title')}</h1>         // carries its stega marker in preview
 * <a href={f.value('cta_url')} {...f.attrs('cta_url')}>…</a>
 * <img {...f.image('hero_image')} />      // src, alt, width, height (+ data-zap in preview)
 *
 * // Numbered slots: `stat_1` … `stat_4`
 * {f.list('stat', 4).map((s) => <p key={s.key}>{s.text()}</p>)}
 * // Slots of several fields: `nav_1_texto` + `nav_1_url` … `nav_5_…`
 * {f.list('nav', 5).filter((nav) => !nav.empty).map((nav) => (
 *   <a key={nav.key} href={nav.value('url') ?? '/'} {...nav.attrs('url')}>{nav.text('texto')}</a>
 * ))}
 * ```
 *
 * Keys are typed from the record's `content`, so with codegen types a typo in
 * a field key fails to compile.
 *
 * Outside preview every helper returns plain values and EMPTY attribute
 * objects, so production HTML is byte-identical to reading values directly.
 * In preview (the record's text carries stega, or `{ preview: true }`), text
 * keeps its marker (the overlay finds it with no tag), and the non-text
 * helpers add `data-zap` (a manual tag). Markers never reach an attribute:
 * `value`, `image` and `attrs` clean them.
 */

/** What `fields` reads: an item (`collection.key` + `slug`) or a document (`key`). */
export interface FieldsRecord {
  content: object
  slug?: string | null
  key?: string | null
  collection?: { key?: string | null } | null
}

type Content<R extends FieldsRecord> = R['content']
type Key<R extends FieldsRecord> = keyof Content<R> & string
/** Field keys whose value is text (string, possibly null). */
type TextKey<R extends FieldsRecord> = {
  [K in Key<R>]: NonNullable<Content<R>[K]> extends string ? K : never
}[Key<R>]
/**
 * Every numbered prefix in `K`: `stat` for `stat_1`, `nav` for `nav_1_texto`,
 * `hero_stat` for `hero_stat_1`. Walks the key one `_` segment at a time, so a
 * prefix may itself contain `_`.
 */
type Prefixes<K extends string, Head extends string = ''> = K extends `${infer P}_${infer Rest}`
  ?
      | (Rest extends `${number}` | `${number}_${string}` ? `${Head}${P}` : never)
      | Prefixes<Rest, `${Head}${P}_`>
  : never
/** Numbered prefixes of the record (any string for an untyped record). */
type ListPrefix<R extends FieldsRecord> = string extends Key<R> ? string : Prefixes<Key<R>>
/** The suffixes of `prefix_{i}_{suffix}` slots: `texto` and `url` for `nav`. */
type SlotSuffix<R extends FieldsRecord, P extends string> =
  string extends Key<R>
    ? string
    : Key<R> extends infer K
      ? K extends `${P}_${number}_${infer S}`
        ? S
        : never
      : never
/** A slot field's value type; `unknown` for an untyped record. */
type SlotValue<R extends FieldsRecord, K> =
  string extends Key<R> ? unknown : Content<R>[Extract<Key<R>, K>]

/** `{ 'data-zap': 'blog/hola#cover' }` in preview, `{}` otherwise. */
export type ZapAttrs = { 'data-zap'?: string }

export interface FieldImage extends ZapAttrs {
  src: string | undefined
  alt: string | undefined
  width: number | undefined
  height: number | undefined
}

/**
 * One numbered slot of `f.list(prefix, n)`: the same helpers as `fields`,
 * scoped to the slot. With a suffix they read `prefix_{i}_{suffix}`
 * (`nav.text('texto')` is `nav_1_texto`); without one, `prefix_{i}` itself
 * (`stat.text()` is `stat_1`).
 */
export interface FieldSlot<R extends FieldsRecord, P extends string> {
  /** `prefix_{i}`, unique in the list: a React key. */
  readonly key: string
  /** 1 for the first slot. */
  readonly index: number
  /** True when every field of the slot is empty (or the slot has no field). */
  readonly empty: boolean
  /** A text field as delivered, with its stega marker in preview. */
  text(suffix?: SlotSuffix<R, P>): string
  /** The single field `prefix_{i}`, with any marker removed. */
  value(): SlotValue<R, `${P}_${number}`>
  /** The slot's field `prefix_{i}_{suffix}`, with any marker removed. */
  value<S extends SlotSuffix<R, P>>(suffix: S): SlotValue<R, `${P}_${number}_${S}`>
  /** `{ 'data-zap': ref#key }` in preview, `{}` otherwise. */
  attrs(suffix?: SlotSuffix<R, P>): ZapAttrs
  /** An image or media field as `<img>` attributes, tagged in preview. */
  image(suffix?: SlotSuffix<R, P>): FieldImage
}

export interface Fields<R extends FieldsRecord> {
  /** True when the helpers tag (the record was read in preview). */
  readonly preview: boolean
  /** A text field as delivered: with its stega marker in preview, so the overlay finds it. */
  text<K extends TextKey<R>>(key: K): string
  /** A field's value with any marker removed: safe in attributes, URLs, comparisons. */
  value<K extends Key<R>>(key: K): Content<R>[K]
  /** `{ 'data-zap': ref#key }` in preview, `{}` otherwise: spread it on the element. */
  attrs(key: Key<R>): ZapAttrs
  /** An image or media field as `<img>` attributes, tagged in preview. */
  image(key: Key<R>): FieldImage
  /**
   * Slots `1` … `count` of a numbered prefix, each a `FieldSlot`: fields
   * `prefix_1` … `prefix_n`, or slots of several fields
   * `prefix_{i}_{suffix}` (`nav_1_texto`, `nav_1_url`), read by suffix.
   */
  list<P extends ListPrefix<R>>(prefix: P, count: number): FieldSlot<R, P>[]
}

export interface FieldsOptions {
  /** Force preview on or off; default: on when any text value carries stega. */
  preview?: boolean
}

export function fields<R extends FieldsRecord>(record: R, options: FieldsOptions = {}): Fields<R> {
  const content = (record?.content ?? {}) as Record<string, unknown>
  const preview = options.preview ?? Object.values(content).some((value) => hasStega(value))
  const [ref] = recordRefsOf(record)
  const attrs = (key: string): ZapAttrs => (preview && ref ? { 'data-zap': `${ref}#${key}` } : {})
  const value = (key: string) => cleanStega(content[key])
  const text = (key: string) => {
    const raw = content[key]
    return typeof raw === 'string' ? (preview ? raw : cleanStega(raw)) : ''
  }
  const image = (key: string): FieldImage => {
    const media = (value(key) ?? {}) as Record<string, unknown>
    const pick = <T>(name: string, type: string) =>
      typeof media[name] === type ? (media[name] as T) : undefined
    return {
      src: pick<string>('url', 'string'),
      alt: pick<string>('alt', 'string'),
      width: pick<number>('width', 'number'),
      height: pick<number>('height', 'number'),
      ...attrs(key),
    }
  }

  return {
    preview,
    text,
    value: value as Fields<R>['value'],
    attrs,
    image,
    list: (prefix, count) =>
      Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
        const key = `${prefix}_${i + 1}`
        const at = (suffix?: string) => (suffix ? `${key}_${suffix}` : key)
        const own = Object.keys(content).filter((k) => k === key || k.startsWith(`${key}_`))
        return {
          key,
          index: i + 1,
          empty: own.every((k) => {
            const v = value(k)
            return v === null || v === undefined || (typeof v === 'string' && !v.trim())
          }),
          text: (suffix?: string) => text(at(suffix)),
          value: (suffix?: string) => value(at(suffix)),
          attrs: (suffix?: string) => attrs(at(suffix)),
          image: (suffix?: string) => image(at(suffix)),
        } as FieldSlot<R, typeof prefix>
      }),
  }
}
