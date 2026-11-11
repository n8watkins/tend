import { TRANSLATIONS } from '@/lib/enums'
import { TRANSLATION_HINT, TRANSLATION_LABEL } from '@/lib/item'

/** The <option>s for a Bible translation <select>: every translation Tend can send. */
export function TranslationOptions() {
  return (
    <>
      {TRANSLATIONS.map((t) => (
        <option key={t} value={t}>
          {TRANSLATION_LABEL[t]} ({TRANSLATION_HINT[t]})
        </option>
      ))}
    </>
  )
}
