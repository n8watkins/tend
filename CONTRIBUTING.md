# Contributing

Thanks for helping.
Issues and pull requests are welcome.

## Suggesting content

The library is small on purpose: every item must be public domain and checked word for word.

**A Bible passage:** add an entry to `content/scripture-refs.json` with an `id` (like `psalm-121-1-2`), the `reference`, the `chapter` it is in, one to four `topics` from `lib/topics.ts`, and one or two sentences of `context` in your own words.

**A quote:** add an entry to `content/quotes.json` with the `author`, `work`, `reference`, `translator` (if translated), the Project Gutenberg book number in `gutenberg`, the exact `text` as it appears in that book, `topics`, `occasions`, `tone` and `context`.
`occasions` is one or more of `birthday`, `encouragement`, `grief`, `congratulations`, `thinking-of-you`, `gratitude` and `new-chapter`; `tone` is `light`, `tender` or `steady` ([what they mean](docs/QUOTES.md#occasions-and-tone)).
The translation must be public domain too (for example, published before 1930).
No "attributed to" quotes: if it is not in the source, it cannot go in.
Keep it to about 200 characters, in words a reader today will not trip over.
[docs/QUOTES.md](docs/QUOTES.md) lists the sources we use and why each is free to use.

**A conversation starter:** add an entry to `content/prompts.json` with a unique `id`, the `text`, a `situation` (`birthday`, `been-a-while`, `going-through-something`, `congratulations` or `just-because`) and a `tone`.
Keep it short and natural, with nothing that needs names, dates or shared memories.

Then run:

```sh
node scripts/build-library.mjs
```

It fetches each passage in every translation Tend offers, checks every quote against its Gutenberg text, checks the conversation starters, and writes `content/library.json`.
Commit both the source file and `content/library.json`.

## Code

1. Fork, then branch from `main`.
2. `npm install`, then follow [Development](README.md#development).
3. Keep changes focused; add or update tests (`tests/` for logic, `e2e/` for flows).
4. `npm run lint && npm run typecheck && npm test`, then `npm run build && npm run test:e2e`.
5. Open a pull request with a [Conventional Commits](https://www.conventionalcommits.org) title, like `feat: weekly digest email`.

Please read [docs/SPEC.md](docs/SPEC.md) first for anything larger, especially the principles: Tend never sends to Signal, consent comes first, and it keeps as little data as possible.
A feature that automates sending on Signal will not be accepted ([why](docs/PRD-REVIEW.md)).

## Conduct

Be kind and assume good faith.
