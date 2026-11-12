'use client'

import { useActionState, useMemo, useState } from 'react'

import { scheduleMessage, type FormState } from '@/app/(app)/actions'
import type { MessageKind, Translation } from '@/lib/enums'

import { TranslationOptions } from './TranslationOptions'
import { buildBody, MAX_BODY } from '@/lib/format'
import type { ContentItem } from '@/lib/item'

import { SubmitButton } from './SubmitButton'

export interface ComposeProps {
  contactId: string
  contactName: string
  kind: MessageKind
  item?: ContentItem
  translation: Translation
  initialNote: string
  /** The conversation starter this message began from, if any. */
  promptId?: string
  stopUrl: string
  stopLinkDefault: boolean
  nextAt: number | null
  nextLabel: string | null
  /** "Next good time", or "On their birthday" from an occasion. */
  nextHeading?: string
  nowAllowed: boolean
  nowRefusal: string | null
  customDefault: string
  timezoneLabel: string
}

export function ComposeForm(props: ComposeProps) {
  const [state, action] = useActionState<FormState, FormData>(scheduleMessage, undefined)
  const [note, setNote] = useState(props.initialNote)
  const [question, setQuestion] = useState('')
  const [translation, setTranslation] = useState<Translation>(props.translation)
  const [readingLink, setReadingLink] = useState(false)
  const [stopLink, setStopLink] = useState(props.stopLinkDefault)
  const [when, setWhen] = useState<'next' | 'now' | 'custom'>(props.nextAt ? 'next' : props.nowAllowed ? 'now' : 'custom')

  const body = useMemo(
    () =>
      buildBody({
        note,
        item: props.item,
        translation,
        question: props.kind === 'content' ? question : undefined,
        readingLink,
        stopUrl: stopLink ? props.stopUrl : undefined,
      }),
    [note, props.item, translation, question, props.kind, readingLink, stopLink, props.stopUrl],
  )
  const tooLong = body.length > MAX_BODY

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="contactId" value={props.contactId} />
      <input type="hidden" name="kind" value={props.kind} />
      {props.item ? <input type="hidden" name="contentId" value={props.item.id} /> : null}
      {props.promptId ? <input type="hidden" name="promptId" value={props.promptId} /> : null}
      {props.nextAt ? <input type="hidden" name="nextAt" value={props.nextAt} /> : null}

      <div className="card space-y-4">
        <div>
          <label htmlFor="note" className="label">
            {props.kind === 'content' ? 'A note from you (optional)' : 'Your message'}
          </label>
          <textarea
            id="note"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={MAX_BODY}
            className="input"
            placeholder={props.kind === 'content' ? `Thinking of you this week, ${props.contactName.split(' ')[0]}.` : ''}
            required={props.kind !== 'content'}
          />
        </div>
        {props.kind === 'content' ? (
          <div>
            <label htmlFor="question" className="label">
              A question to start a conversation (optional)
            </label>
            <input
              id="question"
              name="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={300}
              className="input"
              placeholder="How has your week been?"
            />
          </div>
        ) : null}
        {props.item?.kind === 'scripture' ? (
          <div>
            <label htmlFor="translation" className="label">
              Translation
            </label>
            <select id="translation" name="translation" value={translation} onChange={(e) => setTranslation(e.target.value as Translation)} className="input">
              <TranslationOptions />
            </select>
          </div>
        ) : (
          <input type="hidden" name="translation" value={translation} />
        )}
        <div className="space-y-2">
          {props.item ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="readingLink" checked={readingLink} onChange={(e) => setReadingLink(e.target.checked)} className="mt-1 size-4" />
              <span>Add a link to read more</span>
            </label>
          ) : null}
          <label className="flex items-start gap-2">
            <input type="checkbox" name="stopLink" checked={stopLink} onChange={(e) => setStopLink(e.target.checked)} className="mt-1 size-4" />
            <span>
              Add a link they can use to stop these messages
              <span className="hint block">Recommended for the first few messages.</span>
            </span>
          </label>
        </div>
      </div>

      <section aria-labelledby="preview-title">
        <h2 id="preview-title" className="mb-2 font-bold">
          Exactly what you will send
        </h2>
        <div className="rounded-2xl rounded-bl-md bg-accent-soft p-4 whitespace-pre-wrap break-words text-accent-soft-ink" data-testid="preview">
          {body || <span className="opacity-70">Write your message above.</span>}
        </div>
        <p className={`hint mt-1 ${tooLong ? 'text-danger' : ''}`}>
          {body.length} / {MAX_BODY} characters
        </p>
      </section>

      <fieldset className="card space-y-3">
        <legend className="float-left font-bold">When should Tend remind you?</legend>
        <p className="hint clear-both">Times are in {props.contactName.split(' ')[0]}&rsquo;s time zone ({props.timezoneLabel}).</p>
        {props.nextAt ? (
          <label className="flex items-start gap-2">
            <input type="radio" name="when" value="next" checked={when === 'next'} onChange={() => setWhen('next')} className="mt-1 size-4" />
            <span>
              {props.nextHeading ?? 'Next good time'}: <strong>{props.nextLabel}</strong>
            </span>
          </label>
        ) : (
          <p className="notice notice-warn">No good time fits their rules in the next 60 days. Choose a time, or loosen their rules.</p>
        )}
        <label className="flex items-start gap-2">
          <input type="radio" name="when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} disabled={!props.nowAllowed} className="mt-1 size-4" />
          <span>
            Now, I&rsquo;ll send it straight away
            {props.nowRefusal ? <span className="hint block">{props.nowRefusal}</span> : null}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="when" value="custom" checked={when === 'custom'} onChange={() => setWhen('custom')} className="mt-1 size-4" />
          <span>Choose a time</span>
        </label>
        {when === 'custom' ? (
          <div className="pl-6">
            <label htmlFor="at" className="label">
              Date and time
            </label>
            <input id="at" name="at" type="datetime-local" defaultValue={props.customDefault} step={900} className="input" required />
          </div>
        ) : null}
      </fieldset>

      {state?.error ? (
        <p role="alert" className="notice notice-danger">
          {state.error}
        </p>
      ) : null}
      <SubmitButton pending="Saving...">{when === 'now' ? 'Continue to send' : 'Schedule reminder'}</SubmitButton>
    </form>
  )
}
