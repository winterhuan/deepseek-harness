/**
 * The creative production page: six provider keys plus the runtime profile
 * (models, endpoints, voice routing) they authorize.
 *
 * Controls group by provider, so one provider's key, endpoint, and model sit
 * together; voice routing closes the page. Keys are written through the
 * credentials domain, never into the settings section, so a literal never
 * rides a response; the profile stages beside them and one save covers the
 * whole page.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './produce-card.module.css'
import { ProduceKeysDialog } from './ProduceKeysDialog.tsx'
import { formLabels } from './locales.ts'
import type { CreativeProduceCardFace, ProduceKeyControlState, ProduceKeyField } from './creative-produce-card-controller.ts'

/** Props the renderer binds for the creative production page. */
export type CreativeProduceCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.creativeProduce'>
  & InjectFace<CreativeProduceCardFace>

/**
 * One provider's controls under a shared heading.
 * @param props - the group's stable id, visible title, and controls.
 * @returns the labelled group.
 */
function ProduceGroup(props: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <div className={css.group} role="group" aria-labelledby={`${props.id}-title`}>
      <h3 className={css.groupTitle} id={`${props.id}-title`}>{props.title}</h3>
      {props.children}
    </div>
  )
}

/**
 * Render the creative production page, or its one-liner when the Plugins page asks for a summary.
 * @param props - the view asked for, locale copy, the page snapshot, and its form actions.
 * @returns the one-liner, or the form.
 */
export function CreativeProduceCard(props: CreativeProduceCardProps) {
  const { t } = props
  const state = props.useCreativeProduceCard(snapshot => snapshot)
  const [bulk, setBulk] = useState<{
    readonly field: ProduceKeyField
    readonly title: string
    readonly label: string
  } | null>(null)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  const secret = (control: ProduceKeyControlState): Pick<
    Parameters<typeof SettingsSecretField>[0],
    'disabled' | 'text' | 'configured'
  > => ({
    // The credentials domain accepts a key even when the settings document
    // itself is read-only; they are separate stores with separate refusals.
    // Its own writability is what disables this control — a key sourced
    // from the process environment cannot be written from here.
    disabled: !control.writable,
    text: control.draft.text,
    configured: control.configured,
  })
  const value = { overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalidNumber'), disabled }
  // One button per provider opens the bulk dialog for that provider's key.
  // Titles and labels translate eagerly at these call sites for the locale checker.
  const bulkButton = (field: ProduceKeyField, title: string, label: string) => (
    <button
      type="button"
      className={css.manage}
      disabled={!state.keys[field].writable}
      onClick={() => { setBulk({ field, title, label }) }}
    >
      {t('manageKeys')}
    </button>
  )
  // Translated eagerly: the locale checker reads copy at the t() call, not
  // through a key table it cannot follow.
  return (
    <SettingsForm
      labels={formLabels(t)}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ProduceGroup id="plugin-config-produce-group-openai" title={t('groupOpenai')}>
        <SettingsSecretField
          id="plugin-config-produce-openai-key"
          label={t('openaiKeyLabel')}
          hint={t('openaiKeyHint')}
          stateLabel={state.keys.openaiApiKey.configured ? t('keySet') : t('keyUnset')}
          onEdit={(text) => { props.edit('openaiApiKey', text) }}
          {...secret(state.keys.openaiApiKey)}
        />
        {bulkButton('openaiApiKey', t('groupOpenai'), t('openaiKeyLabel'))}
        <SettingsValueField
          id="plugin-config-produce-openai-base-url"
          label={t('openaiBaseUrl')}
          hint={t('baseUrlHint')}
          {...state.openaiBaseUrl}
          onEdit={(text) => { props.edit('openaiBaseUrl', text) }}
          onReset={() => { props.resetField('openaiBaseUrl') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-seedance" title={t('groupSeedance')}>
        <SettingsSecretField
          id="plugin-config-produce-ark-key"
          label={t('arkKeyLabel')}
          hint={t('arkKeyHint')}
          stateLabel={state.keys.arkApiKey.configured ? t('keySet') : t('keyUnset')}
          onEdit={(text) => { props.edit('arkApiKey', text) }}
          {...secret(state.keys.arkApiKey)}
        />
        {bulkButton('arkApiKey', t('groupSeedance'), t('arkKeyLabel'))}
        <SettingsValueField
          id="plugin-config-produce-seedance-base-url"
          label={t('seedanceBaseUrl')}
          hint={t('baseUrlHint')}
          {...state.seedanceBaseUrl}
          onEdit={(text) => { props.edit('seedanceBaseUrl', text) }}
          onReset={() => { props.resetField('seedanceBaseUrl') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-seedance-model"
          label={t('seedanceModel')}
          hint={t('seedanceModelHint')}
          {...state.seedanceModel}
          onEdit={(text) => { props.edit('seedanceModel', text) }}
          onReset={() => { props.resetField('seedanceModel') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-minimax" title={t('groupMinimax')}>
        <SettingsSecretField
          id="plugin-config-produce-minimax-key"
          label={t('minimaxKeyLabel')}
          hint={t('minimaxKeyHint')}
          stateLabel={state.keys.minimaxApiKey.configured ? t('keySet') : t('keyUnset')}
          onEdit={(text) => { props.edit('minimaxApiKey', text) }}
          {...secret(state.keys.minimaxApiKey)}
        />
        {bulkButton('minimaxApiKey', t('groupMinimax'), t('minimaxKeyLabel'))}
        <SettingsValueField
          id="plugin-config-produce-minimax-base-url"
          label={t('minimaxBaseUrl')}
          hint={t('baseUrlHint')}
          {...state.minimaxBaseUrl}
          onEdit={(text) => { props.edit('minimaxBaseUrl', text) }}
          onReset={() => { props.resetField('minimaxBaseUrl') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-minimax-video-base-url"
          label={t('minimaxVideoBaseUrl')}
          hint={t('baseUrlHint')}
          {...state.minimaxVideoBaseUrl}
          onEdit={(text) => { props.edit('minimaxVideoBaseUrl', text) }}
          onReset={() => { props.resetField('minimaxVideoBaseUrl') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-minimax-video-model"
          label={t('minimaxVideoModel')}
          hint={t('minimaxVideoModelHint')}
          {...state.minimaxVideoModel}
          onEdit={(text) => { props.edit('minimaxVideoModel', text) }}
          onReset={() => { props.resetField('minimaxVideoModel') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-mimo" title={t('groupMimo')}>
        <SettingsSecretField
          id="plugin-config-produce-mimo-key"
          label={t('mimoKeyLabel')}
          hint={t('mimoKeyHint')}
          stateLabel={state.keys.mimoApiKey.configured ? t('keySet') : t('keyUnset')}
          onEdit={(text) => { props.edit('mimoApiKey', text) }}
          {...secret(state.keys.mimoApiKey)}
        />
        {bulkButton('mimoApiKey', t('groupMimo'), t('mimoKeyLabel'))}
        <SettingsValueField
          id="plugin-config-produce-mimo-api-url"
          label={t('mimoApiUrl')}
          hint={t('baseUrlHint')}
          {...state.mimoApiUrl}
          onEdit={(text) => { props.edit('mimoApiUrl', text) }}
          onReset={() => { props.resetField('mimoApiUrl') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-mimo-model"
          label={t('mimoModel')}
          hint={t('modelHint')}
          {...state.mimoModel}
          onEdit={(text) => { props.edit('mimoModel', text) }}
          onReset={() => { props.resetField('mimoModel') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-mimo-tts-voice"
          label={t('mimoTtsVoice')}
          hint={t('modelHint')}
          {...state.mimoTtsVoice}
          onEdit={(text) => { props.edit('mimoTtsVoice', text) }}
          onReset={() => { props.resetField('mimoTtsVoice') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-fish" title={t('groupFish')}>
        <SettingsSecretField
          id="plugin-config-produce-fish-key"
          label={t('fishKeyLabel')}
          hint={t('fishKeyHint')}
          stateLabel={state.keys.fishApiKey.configured ? t('keySet') : t('keyUnset')}
          onEdit={(text) => { props.edit('fishApiKey', text) }}
          {...secret(state.keys.fishApiKey)}
        />
        {bulkButton('fishApiKey', t('groupFish'), t('fishKeyLabel'))}
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-agnes" title={t('groupAgnes')}>
        <SettingsSecretField
          id="plugin-config-produce-agnes-key"
          label={t('agnesKeyLabel')}
          hint={t('agnesKeyHint')}
          stateLabel={state.keys.agnesApiKey.configured ? t('keySet') : t('keyUnset')}
          onEdit={(text) => { props.edit('agnesApiKey', text) }}
          {...secret(state.keys.agnesApiKey)}
        />
        {bulkButton('agnesApiKey', t('groupAgnes'), t('agnesKeyLabel'))}
        <SettingsValueField
          id="plugin-config-produce-agnes-base-url"
          label={t('agnesBaseUrl')}
          hint={t('baseUrlHint')}
          {...state.agnesBaseUrl}
          onEdit={(text) => { props.edit('agnesBaseUrl', text) }}
          onReset={() => { props.resetField('agnesBaseUrl') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-agnes-image-model"
          label={t('agnesImageModel')}
          hint={t('agnesImageModelHint')}
          {...state.agnesImageModel}
          onEdit={(text) => { props.edit('agnesImageModel', text) }}
          onReset={() => { props.resetField('agnesImageModel') }}
          {...value}
        />
        <SettingsValueField
          id="plugin-config-produce-agnes-video-model"
          label={t('agnesVideoModel')}
          hint={t('agnesVideoModelHint')}
          {...state.agnesVideoModel}
          onEdit={(text) => { props.edit('agnesVideoModel', text) }}
          onReset={() => { props.resetField('agnesVideoModel') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-voice" title={t('groupVoice')}>
        <SettingsValueField
          id="plugin-config-produce-tts-provider"
          label={t('ttsProvider')}
          hint={t('ttsProviderHint')}
          {...state.ttsProvider}
          onEdit={(text) => { props.edit('ttsProvider', text) }}
          onReset={() => { props.resetField('ttsProvider') }}
          {...value}
        />
      </ProduceGroup>
      {bulk === null
        ? null
        : (
          <ProduceKeysDialog
            title={bulk.title}
            description={t('keysDialogDescription')}
            label={bulk.label}
            inputId={`plugin-config-produce-${bulk.field}-bulk`}
            placeholder={t('keysDialogPlaceholder')}
            countLabel={t('keysCount')}
            clearLabel={t('keysClear')}
            saveLabel={t('save')}
            discardLabel={t('discard')}
            failedLabel={t('saveFailed')}
            closeLabel={t('keysCloseLabel')}
            disabled={!state.keys[bulk.field].writable}
            onSave={text => props.saveKeys(bulk.field, text)}
            onClose={() => { setBulk(null) }}
          />
        )}
    </SettingsForm>
  )
}
