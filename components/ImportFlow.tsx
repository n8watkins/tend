'use client'

import { useActionState, useState } from 'react'

import { importStep, type ImportState } from '@/app/(app)/people/import/actions'
import { CSV_FIELD_LABEL, CSV_FIELDS, MAX_IMPORT_ROWS } from '@/lib/import'
import { describePartialDate, parsePartialDate } from '@/lib/occasions'

import { SubmitButton } from './SubmitButton'

const STATUS: Record<string, { label: string; className: string } | undefined> = {
  existing: { label: 'Already in People', className: 'badge badge-warn' },
  repeat: { label: 'Twice in this file', className: 'badge badge-warn' },
}

function dateLabel(value: string | null) {
  const date = parsePartialDate(value)
  return date ? describePartialDate(date) : null
}

function Restart() {
  return (
    <button type="submit" name="intent" value="restart" formNoValidate className="btn btn-ghost">
      Start over
    </button>
  )
}

function ErrorNotice({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="notice notice-danger">
      {error}
    </p>
  ) : null
}

export function ImportFlow({ initial = { step: 'upload' } }: { initial?: ImportState }) {
  const [state, action] = useActionState(importStep, initial)

  if (state.step === 'map') {
    const sample = state.rows[0] ?? []
    return (
      <form action={action} className="space-y-6">
        <fieldset className="card space-y-4">
          <legend className="float-left font-semibold">Match the columns</legend>
          <p className="hint clear-both">
            {state.fileName}: {state.rows.length} {state.rows.length === 1 ? 'row' : 'rows'}. Tend guessed these; change any that are wrong.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {CSV_FIELDS.map((field) => (
              <div key={field}>
                <label htmlFor={`map-${field}`} className="label">
                  {CSV_FIELD_LABEL[field]}
                </label>
                <select id={`map-${field}`} name={field} defaultValue={String(state.mapping[field])} className="input">
                  <option value="-1">Not in this file</option>
                  {state.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                      {sample[i] ? ` (e.g. ${sample[i]!.slice(0, 24)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <label htmlFor="dateOrder" className="label">
                Dates like 03/04/1990 mean
              </label>
              <select id="dateOrder" name="dateOrder" defaultValue={state.mapping.dateOrder} className="input">
                <option value="mdy">3 April (month first)</option>
                <option value="dmy">4 March (day first)</option>
              </select>
            </div>
          </div>
          <p className="hint">Use either Full name, or First and Last name. Email is only used to spot people already in Tend; it is not kept.</p>
        </fieldset>
        <ErrorNotice error={state.error} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="map" pending="Reading...">
            Preview
          </SubmitButton>
          <Restart />
        </div>
      </form>
    )
  }

  if (state.step === 'review') return <Review state={state} action={action} />

  return (
    <form action={action} className="space-y-6">
      <div className="card space-y-4">
        <div>
          <label htmlFor="file" className="label">
            Contacts file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".vcf,.vcard,.csv,text/vcard,text/x-vcard,text/csv"
            required
            className="input file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:font-semibold file:text-accent-soft-ink"
            aria-describedby="file-hint"
          />
          <p id="file-hint" className="hint mt-1">
            A .vcf from your phone or a .csv from a spreadsheet, up to 1 MB and {MAX_IMPORT_ROWS} people.
          </p>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">How to export your contacts</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>iPhone: in Contacts, tap Lists, touch and hold a list (like All Contacts), then Export. Or on icloud.com, select contacts and choose Export vCard.</li>
            <li>Android: in Contacts, open Fix &amp; manage (or Settings), then Export to file. You get a .vcf.</li>
            <li>Google Contacts on the web: Export, then vCard or Google CSV.</li>
            <li>Outlook or a spreadsheet: save as CSV with a header row.</li>
          </ul>
        </details>
      </div>
      <ErrorNotice error={state.error} />
      <SubmitButton name="intent" value="read" pending="Reading...">
        Read the file
      </SubmitButton>
      <p className="hint">The file is read on Tend&rsquo;s server and not kept. You choose who to add before anything is saved.</p>
    </form>
  )
}

function Review({ state, action }: { state: Extract<ImportState, { step: 'review' }>; action: (form: FormData) => void }) {
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(state.rows.flatMap((r, i) => (r.status === 'new' ? [i] : []))))
  const counts = { new: 0, existing: 0, repeat: 0 }
  for (const r of state.rows) counts[r.status]++
  const toggle = (i: number) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  const source = state.source === 'google' ? 'Google Contacts' : state.source === 'vcard' ? 'the file' : 'the spreadsheet'
  return (
    <form action={action} className="space-y-6">
      <div className="card space-y-3">
        <p>
          <strong>
            Found {state.rows.length} {state.rows.length === 1 ? 'person' : 'people'} in {source}.
          </strong>{' '}
          {counts.existing ? `${counts.existing} already in People. ` : ''}
          {counts.repeat ? `${counts.repeat} twice in the file. ` : ''}
          {state.truncated ? `Only the first ${MAX_IMPORT_ROWS} are shown.` : ''}
        </p>
        <p className="hint">They start at &ldquo;Not asked yet&rdquo;: Tend helps you ask each one before it suggests any messages.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChosen(new Set(state.rows.map((_, i) => i)))}>
            Choose all
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(new Set())}>
            Choose none
          </button>
        </div>
      </div>

      <fieldset>
        <legend className="sr-only">People to import</legend>
        <ul className="space-y-2">
          {state.rows.map((row, i) => {
            const status = STATUS[row.status]
            const birthday = dateLabel(row.birthday)
            const anniversary = dateLabel(row.anniversary)
            const details = [row.phone, birthday && `Birthday ${birthday}`, anniversary && `Anniversary ${anniversary}`].filter(Boolean)
            return (
              <li key={i}>
                <label className="option">
                  <input type="checkbox" name="row" value={i} checked={chosen.has(i)} onChange={() => toggle(i)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold break-words">{row.name}</span>
                      {status ? <span className={status.className}>{status.label}</span> : null}
                    </span>
                    {details.length ? <span className="mt-0.5 block text-sm text-muted">{details.join(' · ')}</span> : null}
                    {row.unreadablePhone ? (
                      <span className="mt-0.5 block text-sm text-warn-ink">
                        Number {row.unreadablePhone} left out: it needs a country code. Add it later on their page.
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <ErrorNotice error={state.error} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="import" pending="Importing..." disabled={chosen.size === 0}>
          {chosen.size === 0 ? 'Choose people to import' : `Import ${chosen.size} ${chosen.size === 1 ? 'person' : 'people'}`}
        </SubmitButton>
        <Restart />
      </div>
    </form>
  )
}
