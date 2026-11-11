# Contributing

Thanks for helping.
Issues and pull requests are welcome.

## Suggesting content

The library is small on purpose: every item must be public domain and checked word for word.

**A Bible passage:** add an entry to `content/scripture-refs.json` with an `id` (like `psalm-121-1-2`), the `reference`, the `chapter` it is in, one to four `topics` from `lib/topics.ts`, and one or two sentences of `context` in your own words.

**A quote:** add an entry to `content/quotes.json` with the `author`, `work`, `reference`, `translator` (if translated), the Project Gutenberg book number in `gutenberg`, the exact `text` as it appears in that book, `topics` and `context`.
The translation must be public domain too (for example, published before 1930).
No "attributed to" quotes: if it is not in the source, it cannot go in.

Then run:

```sh
node scripts/build-library.mjs
```

It fetches each passage (WEB and KJV), checks every quote against its Gutenberg text, and writes `content/library.json`.
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
