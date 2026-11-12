import { SUGGEST_MODES, type SuggestMode } from '@/lib/enums'
import { SUGGEST_HINT, SUGGEST_LABEL } from '@/lib/prompts'

/**
 * "What to suggest": Scripture, Quotes, A mix or Just my words, as radio
 * cards. On a person's form `defaultMode` adds a first choice that follows the
 * sender's default (value ''). The sender always chooses; Tend never guesses.
 */
export function SuggestChoice({
  value,
  defaultMode,
  legend,
  hint,
}: {
  value: SuggestMode | ''
  defaultMode?: SuggestMode
  legend: string
  hint?: string
}) {
  const options: { value: SuggestMode | ''; title: string; hint: string }[] = [
    ...(defaultMode ? [{ value: '' as const, title: `Your default (${SUGGEST_LABEL[defaultMode]})`, hint: 'Follows what you chose in Settings' }] : []),
    ...SUGGEST_MODES.map((m) => ({ value: m, title: SUGGEST_LABEL[m], hint: SUGGEST_HINT[m] })),
  ]
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      {hint ? <p className="hint -mt-1 mb-2">{hint}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value || 'default'} className={`choice ${defaultMode && o.value === '' ? 'sm:col-span-2' : ''}`}>
            <input type="radio" name="suggest" value={o.value} defaultChecked={value === o.value} className="sr-only" />
            <span className="text-sm font-semibold">{o.title}</span>
            <span className="text-xs opacity-80">{o.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
