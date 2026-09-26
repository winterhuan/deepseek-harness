/**
 * The bulk key dialog: one provider's whole key pool as lines of text.
 *
 * The textarea is local state that always starts empty — key literals never
 * ride a Host response, so there is nothing to seed it from, and thousands of
 * staged lines must not linger in the card form after the dialog closes. The
 * dialog owns its save gesture: it writes through the card's bulk entry point
 * directly instead of staging into the card form, then clears and closes when
 * the Host confirms.
 */

import { useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ProduceKeysDialog.module.css'

/** Props the card assembles for one provider's bulk dialog. */
export interface ProduceKeysDialogProps {
  /** Provider group title doubling as the dialog heading. */
  title: string
  /** One line explaining the one-key-per-line format. */
  description: string
  /** Visible label for the key list. */
  label: string
  /** Stable id associating the label with the textarea. */
  inputId: string
  /** Hint shown while the textarea is empty. */
  placeholder: string
  /** Prefix rendered before the live valid-line count. */
  countLabel: string
  /** Copy for the control clearing the local text. */
  clearLabel: string
  /** Copy for the control writing the pool. */
  saveLabel: string
  /** Copy for the control dropping the local text. */
  discardLabel: string
  /** Copy shown when the Host did not accept the pool. */
  failedLabel: string
  /** Accessible label for the dialog close control. */
  closeLabel: string
  /** Disables the write while the credentials domain refuses it. */
  disabled: boolean
  /** Write the whole text as the provider's pool; resolves to Host acceptance. */
  onSave: (text: string) => Promise<boolean>
  /** Close the dialog, dropping the local text. */
  onClose: () => void
}

/**
 * Count the lines a save would store: trimmed, blanks dropped.
 * @param text - the dialog's current text.
 * @returns the storable lines.
 */
function validLines(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(line => line !== '')
}

/**
 * Render one provider's bulk key dialog.
 * @param props - locale copy and the dialog actions.
 * @returns the modal dialog.
 */
export function ProduceKeysDialog(props: ProduceKeysDialogProps) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const count = validLines(text).length
  const save = async (): Promise<void> => {
    setSaving(true)
    setFailed(false)
    const landed = await props.onSave(text)
    setSaving(false)
    if (landed) props.onClose()
    else setFailed(true)
  }
  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.title}
      description={props.description}
      closeLabel={props.closeLabel}
      className={css.wide ?? ''}
      footer={(
        <>
          <button
            type="button"
            className={css.ghost}
            disabled={text === ''}
            onClick={() => {
              setText('')
              setFailed(false)
            }}
          >
            {props.clearLabel}
          </button>
          <button type="button" className={css.ghost} onClick={props.onClose}>
            {props.discardLabel}
          </button>
          <button
            type="button"
            className={css.primary}
            disabled={props.disabled || count === 0 || saving}
            onClick={() => { void save() }}
          >
            {props.saveLabel}
          </button>
        </>
      )}
    >
      <label className={css.label} htmlFor={props.inputId}>{props.label}</label>
      <textarea
        id={props.inputId}
        className={css.area}
        rows={12}
        wrap="off"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={props.placeholder}
        value={text}
        disabled={saving}
        onChange={(event) => {
          setText(event.target.value)
          setFailed(false)
        }}
      />
      <p className={css.count}>{props.countLabel}{count}</p>
      {failed ? <p className={css.failed} role="status">{props.failedLabel}</p> : null}
    </Modal>
  )
}
