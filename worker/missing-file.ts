/**
 * A plain 404 for a path that cannot be a route, answered before Next.js starts.
 *
 * Scanners ask for /config.json, /.s3cfg, /www.zip, /terraform.tfvars and the
 * like. Static files (public/, /_next/static) are served by Workers static
 * assets before this Worker runs, so a file-like path that reaches it is a
 * miss, and Next.js would spend a full render (about 100 to 150 ms of CPU) on
 * the 404 page to say so.
 *
 * The rule is an allowlist plus a shape: a path with a dot in any segment (an
 * extension, or a leading-dot name such as /.env) is answered here unless it is
 * a route that really has a dot in it. Paths without a dot never match, so the
 * app's own not-found page still comes from Next.js for them. Ids and tokens in
 * the app's dynamic routes (uuids, base64url) never contain a dot.
 */

/** The metadata routes (app/manifest.ts, app/icon.svg, app/apple-icon.png) whose paths contain a dot. */
const DOTTED_ROUTES = new Set(['/manifest.webmanifest', '/icon.svg', '/apple-icon.png'])

/** Whether a path is file-like (a dot in any segment) and not a known route. */
export function isMissingFile(pathname: string): boolean {
  if (!pathname.includes('.')) return false
  return !DOTTED_ROUTES.has(pathname)
}

/**
 * The 404 for a missing file, or null for everything else. Small, no cookies,
 * and kept briefly by browsers and the edge so a scanner's repeat costs less.
 */
export function missingFile(request: Request): Response | null {
  if (!isMissingFile(new URL(request.url).pathname)) return null
  return new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  })
}
