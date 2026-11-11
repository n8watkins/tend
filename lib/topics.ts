/** The fixed topic list (docs/SPEC.md section 7). Library items and contacts use these slugs. */

export const TOPICS = [
  { slug: 'comfort', label: 'Comfort' },
  { slug: 'hope', label: 'Hope' },
  { slug: 'peace', label: 'Peace' },
  { slug: 'courage', label: 'Courage' },
  { slug: 'strength', label: 'Strength' },
  { slug: 'gratitude', label: 'Gratitude' },
  { slug: 'joy', label: 'Joy' },
  { slug: 'love', label: 'Love' },
  { slug: 'friendship', label: 'Friendship' },
  { slug: 'forgiveness', label: 'Forgiveness' },
  { slug: 'patience', label: 'Patience' },
  { slug: 'wisdom', label: 'Wisdom' },
  { slug: 'purpose', label: 'Purpose' },
  { slug: 'rest', label: 'Rest' },
  { slug: 'grief', label: 'Grief' },
  { slug: 'new-beginnings', label: 'New beginnings' },
] as const

export type TopicSlug = (typeof TOPICS)[number]['slug']

export const TOPIC_SLUGS = TOPICS.map((t) => t.slug) as TopicSlug[]

export function isTopic(value: string): value is TopicSlug {
  return (TOPIC_SLUGS as string[]).includes(value)
}

export function topicLabel(slug: string): string {
  return TOPICS.find((t) => t.slug === slug)?.label ?? slug
}

export const MAX_TOPICS_PER_CONTACT = 6
