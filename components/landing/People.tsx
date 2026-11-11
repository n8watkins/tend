/**
 * The people on the landing page and in the sign-in dialog: real photos from
 * Pexels (Pexels licence; photographers in CREDITS.md), cropped
 * and encoded as AVIF with a WebP fallback by hand, so they cost nothing at
 * runtime. The names and topics are made up for the story the page tells.
 */

export type Person = {
  name: string
  topic: string
  /** public/people/avatar-<photo>.{avif,webp}, a 256px square face crop. */
  photo: string
}

export const PEOPLE = [
  { name: 'Mum', topic: 'Hope', photo: 'mum' },
  { name: 'Sam', topic: 'Courage', photo: 'sam' },
  { name: 'Grandpa Joe', topic: 'Comfort', photo: 'joe' },
  { name: 'Priya', topic: 'Joy', photo: 'priya' },
  { name: 'Lee', topic: 'Friendship', photo: 'lee' },
  { name: 'Auntie Ada', topic: 'Gratitude', photo: 'ada' },
] as const satisfies readonly Person[]

/**
 * One person, as a round photo. Decorative: the page names them in text.
 * `eager` for the few above the fold; everything else loads lazily.
 */
export function Avatar({ person: p, className = 'size-12', eager = false }: { person: Person; className?: string; eager?: boolean }) {
  return (
    <picture className={`avatar shrink-0 ${className}`}>
      <source srcSet={`/people/avatar-${p.photo}.avif`} type="image/avif" />
      <img
        src={`/people/avatar-${p.photo}.webp`}
        alt=""
        width={256}
        height={256}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
      />
    </picture>
  )
}

export type Scene = { photo: string; alt: string }

/**
 * A 4:5 scene photo, 480 or 960 wide by `sizes`. Lazy: the scenes all sit
 * below the fold.
 */
export function ScenePhoto({ scene, sizes, className = '' }: { scene: Scene; sizes: string; className?: string }) {
  const set = (ext: string) => `/people/${scene.photo}-480.${ext} 480w, /people/${scene.photo}-960.${ext} 960w`
  return (
    <picture className={className}>
      <source srcSet={set('avif')} sizes={sizes} type="image/avif" />
      <img src={`/people/${scene.photo}-960.webp`} srcSet={set('webp')} sizes={sizes} alt={scene.alt} width={960} height={1200} loading="lazy" decoding="async" />
    </picture>
  )
}
