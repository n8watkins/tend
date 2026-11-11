// Builds content/library.json, the verified content library, from:
//   content/scripture-refs.json  passages, fetched in WEB and KJV from bible-api.com
//   content/quotes.json          quotes, each checked word for word against its
//                                Project Gutenberg source text
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

const TRANSLATIONS = ['web', 'kjv']
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
    const passage = await fetchPassage(ref.reference, translation)
    text[translation] = passage.text
    sourceUrl[translation] = passage.sourceUrl
    await sleep(2_200)
  }
  items.push({
    id: ref.id,
    kind: 'scripture',
    reference: ref.reference,
    text,
    license: 'public-domain',
    sourceUrl,
    readingUrl: { web: gatewayUrl(ref.chapter, 'WEB'), kjv: gatewayUrl(ref.chapter, 'KJV') },
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
  console.log(`library verified: ${items.length} items`)
} else {
  await writeFile(target, output, 'utf8')
  console.log(`wrote ${items.length} items to content/library.json`)
}
