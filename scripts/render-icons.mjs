// Renders the installable-app icons from the Tend mark (app/icon.svg) with
// sharp. The PNGs are committed; run this again only when the mark changes.
//
//   node scripts/render-icons.mjs
//
// - public/icons/icon-192.png, icon-512.png: the mark as is (rounded square).
// - public/icons/icon-maskable-512.png: full-bleed green with the sprout inside
//   the 80% safe zone, so Android can crop it to any shape.
// - app/apple-icon.png (180): full bleed too, since iOS rounds the corners
//   itself and fills transparency with black.
// - public/icons/badge-96.png: the sprout alone in white on transparent, for
//   Android's monochrome notification badge.

import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import sharp from 'sharp'

const root = process.cwd()
const mark = readFileSync(join(root, 'app', 'icon.svg'))

// The sprout from app/icon.svg (a 32-unit grid; its drawing is centred near 15.5, 17.4).
const SPROUT = `
  <path d="M16 25v-9" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M16 17c0-4.5-3-7.5-8-7.5 0 4.5 3 7.5 8 7.5Z" fill="#fff"/>
  <path d="M16 15.5c0-4 2.6-6.8 7-6.8 0 4-2.6 6.8-7 6.8Z" fill="#fff" opacity=".8"/>`

/** The sprout scaled about the centre of a 32-unit square, on an optional full-bleed background. */
function sprout(scale, background) {
  const [tx, ty] = [16 - 15.5 * scale, 16 - 17.4 * scale]
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${background ? `<rect width="32" height="32" fill="${background}"/>` : ''}<g transform="translate(${tx} ${ty}) scale(${scale})">${SPROUT}</g></svg>`,
  )
}

async function render(svg, size, file) {
  await sharp(svg, { density: 72 * Math.ceil(size / 32) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(file)
  console.log(`wrote ${file.slice(root.length + 1)}`)
}

const icons = join(root, 'public', 'icons')
mkdirSync(icons, { recursive: true })
await render(mark, 192, join(icons, 'icon-192.png'))
await render(mark, 512, join(icons, 'icon-512.png'))
await render(sprout(0.95, '#2f6b4f'), 512, join(icons, 'icon-maskable-512.png'))
await render(sprout(0.95, '#2f6b4f'), 180, join(root, 'app', 'apple-icon.png'))
await render(sprout(1.25, null), 96, join(icons, 'badge-96.png'))
