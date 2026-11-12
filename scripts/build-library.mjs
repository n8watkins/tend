// Builds content/library.json, the verified content library, from:
//   content/scripture-refs.json  passages, fetched from bible-api.com in every
//                                translation Tend offers (docs/TRANSLATIONS.md)
//   content/quotes.json          quotes, each checked word for word against its
//                                Project Gutenberg source text (docs/QUOTES.md)
//
// It also checks content/prompts.json, the conversation starters, which are
// read directly by the app: valid situations and tones, and unique ids.
//
//   node scripts/build-library.mjs           fetch, verify and write the library
//   node scripts/build-library.mjs --check   verify only: fails if library.json
//                                            differs from what the sources give
//
// Only whitespace is normalised. A quote that is not found in its source fails
// the run; nothing is ever written from memory. bible-api.com allows 15
// requests per 30 seconds, so passages are fetched 2.2 seconds apart.
// Gutenberg texts are cached in .cache/gutenberg.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const check = process.argv.includes('--check')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const squash = (s) => s.replace(/\s+/g, ' ').trim()

const refs = JSON.parse(await readFile(join(root, 'content/scripture-refs.json'), 'utf8'))
const quotes = JSON.parse(await readFile(join(root, 'content/quotes.json'), 'utf8'))
const prompts = JSON.parse(await readFile(join(root, 'content/prompts.json'), 'utf8'))

// When a quote fits (docs/QUOTES.md), and how it feels: light, tender or steady.
const OCCASIONS = ['birthday', 'encouragement', 'grief', 'congratulations', 'thinking-of-you', 'gratitude', 'new-chapter']
const TONES = ['light', 'tender', 'steady']
// What a conversation starter is for (content/prompts.json).
const SITUATIONS = ['birthday', 'been-a-while', 'going-through-something', 'congratulations', 'just-because']

// Cheap checks first, so a typo fails before minutes of fetching.
const problems = []
const seen = new Set()
for (const quote of quotes) {
  if (seen.has(quote.id)) problems.push(`quote ${quote.id}: duplicate id`)
  seen.add(quote.id)
  if (!Array.isArray(quote.occasions) || quote.occasions.length === 0) problems.push(`quote ${quote.id}: no occasions`)
  for (const occasion of quote.occasions ?? []) {
    if (!OCCASIONS.includes(occasion)) problems.push(`quote ${quote.id}: unknown occasion "${occasion}"`)
  }
  if (!TONES.includes(quote.tone)) problems.push(`quote ${quote.id}: unknown tone "${quote.tone}"`)
}
if (!Array.isArray(prompts)) problems.push('content/prompts.json: not an array')
const promptIds = new Set()
for (const [index, prompt] of (Array.isArray(prompts) ? prompts : []).entries()) {
  const label = `prompt ${prompt?.id ?? `#${index}`}`
  if (typeof prompt?.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(prompt.id)) problems.push(`${label}: id must be lowercase words joined by hyphens`)
  else if (promptIds.has(prompt.id)) problems.push(`${label}: duplicate id`)
  promptIds.add(prompt?.id)
  if (typeof prompt?.text !== 'string' || !prompt.text.trim()) problems.push(`${label}: no text`)
  else if (prompt.text !== prompt.text.trim() || /\s{2}/.test(prompt.text)) problems.push(`${label}: stray whitespace`)
  else if (/[[\]{}<>]|\u2014/.test(prompt.text)) problems.push(`${label}: placeholder brackets or an em dash`)
  if (!SITUATIONS.includes(prompt?.situation)) problems.push(`${label}: unknown situation "${prompt?.situation}"`)
  if (!TONES.includes(prompt?.tone)) problems.push(`${label}: unknown tone "${prompt?.tone}"`)
  const extra = Object.keys(prompt ?? {}).filter((key) => !['id', 'text', 'situation', 'tone'].includes(key))
  if (extra.length) problems.push(`${label}: unexpected field(s) ${extra.join(', ')}`)
}
if (problems.length) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}

// Keep in step with TRANSLATIONS in lib/enums.ts. Each is public domain; see
// docs/TRANSLATIONS.md for the licence and source of each.
const TRANSLATIONS = ['web', 'webbe', 'kjv', 'asv', 'bsb', 'bbe', 'darby', 'dra']

// Where "Read more" links go: Bible Gateway where it has the text, else
// ebible.org (which uses USFM book codes, and three-digit Psalm chapters).
const GATEWAY = { web: 'WEB', kjv: 'KJV', asv: 'ASV', darby: 'DARBY', dra: 'DRA' }
const EBIBLE = { webbe: 'eng-webbe', bsb: 'engbsb', bbe: 'engBBE' }
const USFM = {
  Genesis: 'GEN', Exodus: 'EXO', Leviticus: 'LEV', Numbers: 'NUM', Deuteronomy: 'DEU', Joshua: 'JOS', Judges: 'JDG', Ruth: 'RUT',
  '1 Samuel': '1SA', '2 Samuel': '2SA', '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH', '2 Chronicles': '2CH', Ezra: 'EZR',
  Nehemiah: 'NEH', Esther: 'EST', Job: 'JOB', Psalm: 'PSA', Psalms: 'PSA', Proverbs: 'PRO', Ecclesiastes: 'ECC', 'Song of Solomon': 'SNG',
  Isaiah: 'ISA', Jeremiah: 'JER', Lamentations: 'LAM', Ezekiel: 'EZK', Daniel: 'DAN', Hosea: 'HOS', Joel: 'JOL', Amos: 'AMO',
  Obadiah: 'OBA', Jonah: 'JON', Micah: 'MIC', Nahum: 'NAM', Habakkuk: 'HAB', Zephaniah: 'ZEP', Haggai: 'HAG', Zechariah: 'ZEC',
  Malachi: 'MAL', Matthew: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', Romans: 'ROM', '1 Corinthians': '1CO',
  '2 Corinthians': '2CO', Galatians: 'GAL', Ephesians: 'EPH', Philippians: 'PHP', Colossians: 'COL', '1 Thessalonians': '1TH',
  '2 Thessalonians': '2TH', '1 Timothy': '1TI', '2 Timothy': '2TI', Titus: 'TIT', Philemon: 'PHM', Hebrews: 'HEB', James: 'JAS',
  '1 Peter': '1PE', '2 Peter': '2PE', '1 John': '1JN', '2 John': '2JN', '3 John': '3JN', Jude: 'JUD', Revelation: 'REV',
}

function readingUrl(chapter, translation) {
  if (GATEWAY[translation]) return gatewayUrl(chapter, GATEWAY[translation])
  const [, book, number] = chapter.match(/^(.+) (\d+)$/) ?? []
  const code = USFM[book]
  if (!code) throw new Error(`${chapter}: no USFM book code`)
  return `https://ebible.org/${EBIBLE[translation]}/${code}${number.padStart(code === 'PSA' ? 3 : 2, '0')}.htm`
}
const items = []

function gatewayUrl(chapter, version) {
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(chapter)}&version=${version}`
}

async function fetchPassage(reference, translation) {
  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (response.ok) {
      const data = await response.json()
      const text = squash(data.verses.map((v) => v.text).join(' '))
      if (!text) throw new Error(`${reference} (${translation}): empty text`)
      return { text, sourceUrl: url }
    }
    if (response.status === 429) {
      await sleep(30_000)
      continue
    }
    throw new Error(`${reference} (${translation}): HTTP ${response.status}`)
  }
  throw new Error(`${reference} (${translation}): rate limited three times`)
}

for (const ref of refs) {
  const text = {}
  const sourceUrl = {}
  for (const translation of TRANSLATIONS) {
    // A translation that numbers the passage differently (the Douay-Rheims
    // follows the Vulgate's Psalm numbers) has its own reference, checked by hand.
    const passage = await fetchPassage(ref.references?.[translation] ?? ref.reference, translation)
    text[translation] = passage.text
    sourceUrl[translation] = passage.sourceUrl
    await sleep(2_200)
  }
  items.push({
    id: ref.id,
    kind: 'scripture',
    reference: ref.reference,
    ...(ref.references ? { references: ref.references } : {}),
    text,
    license: 'public-domain',
    sourceUrl,
    readingUrl: Object.fromEntries(TRANSLATIONS.map((t) => [t, readingUrl(ref.references?.[t]?.replace(/:.*$/, '') ?? ref.chapter, t)])),
    context: ref.context,
    topics: ref.topics,
  })
  console.log(`scripture ${ref.reference}`)
}

const cacheDir = join(root, '.cache/gutenberg')
await mkdir(cacheDir, { recursive: true })

async function gutenberg(id) {
  const file = join(cacheDir, `${id}.txt`)
  if (!existsSync(file)) {
    const response = await fetch(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`)
    if (!response.ok) throw new Error(`Gutenberg ${id}: HTTP ${response.status}`)
    await writeFile(file, await response.text(), 'utf8')
  }
  return squash(await readFile(file, 'utf8'))
}

let failures = 0
for (const quote of quotes) {
  const source = await gutenberg(quote.gutenberg)
  if (!source.includes(squash(quote.text))) {
    console.error(`NOT FOUND in Gutenberg ${quote.gutenberg}: ${quote.id}`)
    failures++
    continue
  }
  items.push({
    id: quote.id,
    kind: 'quote',
    reference: quote.reference,
    text: squash(quote.text),
    author: quote.author,
    work: quote.work,
    ...(quote.translator ? { translator: quote.translator } : {}),
    license: 'public-domain',
    sourceUrl: `https://www.gutenberg.org/ebooks/${quote.gutenberg}`,
    readingUrl: `https://www.gutenberg.org/ebooks/${quote.gutenberg}`,
    context: quote.context,
    topics: quote.topics,
    occasions: quote.occasions,
    tone: quote.tone,
  })
  console.log(`quote ${quote.id}`)
}

if (failures) {
  console.error(`${failures} quote(s) failed verification`)
  process.exit(1)
}

const output = `${JSON.stringify(items, null, 2)}\n`
const target = join(root, 'content/library.json')
if (check) {
  const current = existsSync(target) ? await readFile(target, 'utf8') : ''
  if (current !== output) {
    console.error('content/library.json differs from its sources; run node scripts/build-library.mjs')
    process.exit(1)
  }
  console.log(`library verified: ${items.length} items; ${prompts.length} prompts checked`)
} else {
  await writeFile(target, output, 'utf8')
  console.log(`wrote ${items.length} items to content/library.json; ${prompts.length} prompts checked`)
}
