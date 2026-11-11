/** Every IANA time zone the runtime knows, plus UTC and any extra values passed in. */
export function timeZoneOptions(...include: string[]): string[] {
  let zones: string[] = []
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = []
  }
  return [...new Set(['UTC', ...zones, ...include.filter(Boolean)])].sort()
}
