'use client'

import { useActionState, useMemo, useState } from 'react'

import { scheduleMessage, type FormState } from '@/app/(app)/actions'
import type { MessageKind, Translation } from '@/lib/enums'

import { TranslationOptions } from './TranslationOptions'
import { buildBody, MAX_BODY } from '@/lib/format'
import type { ContentItem } from '@/lib/item'

import { CalendarIcon, ChatIcon, PenIcon, SendIcon } from './icons'
import { SubmitButton } from './SubmitButton'
import { Section } from './ui'

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
  const firstName = props.contactName.split(' ')[0]

  return (
    <form action={action} className="app-columns">
      <input type="hidden" name="contactId" value={props.contactId} />
      <input type="hidden" name="kind" value={props.kind} />
      {props.item ? <input type="hidden" name="contentId" value={props.item.id} /> : null}
      {props.promptId ? <input type="hidden" name="promptId" value={props.promptId} /> : null}
      {props.nextAt ? <input type="hidden" name="nextAt" value={props.nextAt} /> : null}

      <div className="app-col">
      <Section
        title={props.kind === 'content' ? 'Your words' : 'Your message'}
        id="words-title"
        icon={PenIcon}
        hint={props.kind === 'content' ? 'Add a line of your own around the passage. All optional.' : `Write it the way you would say it to ${firstName}.`}
      >
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
            <label className="option">
              <input type="checkbox" name="readingLink" checked={readingLink} onChange={(e) => setReadingLink(e.target.checked)} />
              <span>Add a link to read more</span>
            </label>
          ) : null}
          <label className="option">
            <input type="checkbox" name="stopLink" checked={stopLink} onChange={(e) => setStopLink(e.target.checked)} />
            <span>
              Add a link they can use to stop these messages
              <span className="hint block">Recommended for the first few messages.</span>
            </span>
          </label>
        </div>
      </Section>

      <Section title="When should Tend remind you?" id="when-title" icon={CalendarIcon} hint={`Times are in ${firstName}’s time zone (${props.timezoneLabel}).`}>
        <div role="radiogroup" aria-labelledby="when-title" className="space-y-2">
          {props.nextAt ? (
            <label className="option">
              <input type="radio" name="when" value="next" checked={when === 'next'} onChange={() => setWhen('next')} />
              <span>
                {props.nextHeading ?? 'Next good time'}: <strong>{props.nextLabel}</strong>
              </span>
            </label>
          ) : (
            <p className="notice notice-warn">No good time fits their rules in the next 60 days. Choose a time, or loosen their rules.</p>
          )}
          <label className="option">
            <input type="radio" name="when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} disabled={!props.nowAllowed} />
            <span>
              Now, I&rsquo;ll send it straight away
              {props.nowRefusal ? <span className="hint block">{props.nowRefusal}</span> : null}
            </span>
          </label>
          <label className="option">
            <input type="radio" name="when" value="custom" checked={when === 'custom'} onChange={() => setWhen('custom')} />
            <span>Choose a time</span>
          </label>
        </div>
        {when === 'custom' ? (
          <div>
            <label htmlFor="at" className="label">
              Date and time
            </label>
            <input id="at" name="at" type="datetime-local" defaultValue={props.customDefault} step={900} className="input" required />
          </div>
        ) : null}
      </Section>
      </div>

      <div className="app-col app-col-sticky">
        <Section title="Exactly what you will send" id="preview-title" icon={ChatIcon} tone="primary" hint={`This is the text you paste into Signal for ${firstName}.`}>
          <div className="chat-stage">
            <div className="chat-bubble" data-testid="preview">
              {body || <span className="opacity-80">Write your message, and it shows here.</span>}
            </div>
          </div>
          <p className={`hint text-right ${tooLong ? 'text-danger' : ''}`}>
            {body.length} / {MAX_BODY} characters
          </p>
          {state?.error ? (
            <p role="alert" className="notice notice-danger">
              {state.error}
            </p>
          ) : null}
          <SubmitButton pending="Saving..." className="btn btn-primary btn-lg w-full">
            {when === 'now' ? (
              <>
                <SendIcon />
                Continue to send
              </>
            ) : (
              <>
                <CalendarIcon />
                Schedule reminder
              </>
            )}
          </SubmitButton>
        </Section>
      </div>
    </form>
  )
}
