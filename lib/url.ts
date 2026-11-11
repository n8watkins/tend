/** The site's public address (PUBLIC_URL in wrangler.jsonc, or AUTH_URL locally). */
export function siteUrl(): string {
  return (process.env.PUBLIC_URL || process.env.AUTH_URL || 'http://localhost:7841').replace(/\/$/, '')
}

export function publicUrl(path: string): string {
  return `${siteUrl()}${path}`
}
