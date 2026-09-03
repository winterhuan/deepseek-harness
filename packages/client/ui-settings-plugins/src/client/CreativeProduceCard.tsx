/**
 * The creative production card: six provider keys plus the runtime profile
 * (models, endpoints, voice routing) they authorize.
 *
 * Controls group by provider, so one provider's key, endpoint, and model sit
 * together; voice routing closes the card. Keys are written through the
 * credentials domain, never into the settings section, so a literal never
 * rides a response; the profile stages beside them and one save covers the
 * whole card.
 */

import type { ReactNode } from 'react'
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import css from './fields.module.css'
import { PluginCard } from './PluginCard.tsx'
import { ProduceKeysDialog } from './ProduceKeysDialog.tsx'
import type { CreativeProduceCardFace, ProduceKeyControlState, ProduceKeyField } from './creative-produce-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the creative production card. */
export type CreativeProduceCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
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
 * Render the creative production card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function CreativeProduceCard(props: CreativeProduceCardProps) {
  const { t } = props
  const state = props.useCreativeProduceCard(snapshot => snapshot)
  const [bulk, setBulk] = useState<{
    readonly field: ProduceKeyField
    readonly title: string
    readonly label: string
  } | null>(null)
  const disabled = !state.writable
  const secret = (control: ProduceKeyControlState): Pick<
    Parameters<typeof SecretField>[0],
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
      {t('produceManageKeys')}
    </button>
  )
  // Translated eagerly: the locale checker reads copy at the t() call, not
  // through a key table it cannot follow.
  return (
    <PluginCard
      t={t}
      titleKey="produceTitle"
      descriptionKey="produceDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ProduceGroup id="plugin-config-produce-group-openai" title={t('produceGroupOpenai')}>
        <SecretField
          id="plugin-config-produce-openai-key"
          label={t('produceOpenaiKeyLabel')}
          hint={t('produceOpenaiKeyHint')}
          stateLabel={state.keys.openaiApiKey.configured ? t('produceKeySet') : t('produceKeyUnset')}
          onEdit={(text) => { props.edit('openaiApiKey', text) }}
          {...secret(state.keys.openaiApiKey)}
        />
        {bulkButton('openaiApiKey', t('produceGroupOpenai'), t('produceOpenaiKeyLabel'))}
        <ValueField
          id="plugin-config-produce-openai-base-url"
          label={t('produceOpenaiBaseUrl')}
          hint={t('produceBaseUrlHint')}
          {...state.openaiBaseUrl}
          onEdit={(text) => { props.edit('openaiBaseUrl', text) }}
          onReset={() => { props.resetField('openaiBaseUrl') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-seedance" title={t('produceGroupSeedance')}>
        <SecretField
          id="plugin-config-produce-ark-key"
          label={t('produceArkKeyLabel')}
          hint={t('produceArkKeyHint')}
          stateLabel={state.keys.arkApiKey.configured ? t('produceKeySet') : t('produceKeyUnset')}
          onEdit={(text) => { props.edit('arkApiKey', text) }}
          {...secret(state.keys.arkApiKey)}
        />
        {bulkButton('arkApiKey', t('produceGroupSeedance'), t('produceArkKeyLabel'))}
        <ValueField
          id="plugin-config-produce-seedance-base-url"
          label={t('produceSeedanceBaseUrl')}
          hint={t('produceBaseUrlHint')}
          {...state.seedanceBaseUrl}
          onEdit={(text) => { props.edit('seedanceBaseUrl', text) }}
          onReset={() => { props.resetField('seedanceBaseUrl') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-seedance-model"
          label={t('produceSeedanceModel')}
          hint={t('produceSeedanceModelHint')}
          {...state.seedanceModel}
          onEdit={(text) => { props.edit('seedanceModel', text) }}
          onReset={() => { props.resetField('seedanceModel') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-minimax" title={t('produceGroupMinimax')}>
        <SecretField
          id="plugin-config-produce-minimax-key"
          label={t('produceMinimaxKeyLabel')}
          hint={t('produceMinimaxKeyHint')}
          stateLabel={state.keys.minimaxApiKey.configured ? t('produceKeySet') : t('produceKeyUnset')}
          onEdit={(text) => { props.edit('minimaxApiKey', text) }}
          {...secret(state.keys.minimaxApiKey)}
        />
        {bulkButton('minimaxApiKey', t('produceGroupMinimax'), t('produceMinimaxKeyLabel'))}
        <ValueField
          id="plugin-config-produce-minimax-base-url"
          label={t('produceMinimaxBaseUrl')}
          hint={t('produceBaseUrlHint')}
          {...state.minimaxBaseUrl}
          onEdit={(text) => { props.edit('minimaxBaseUrl', text) }}
          onReset={() => { props.resetField('minimaxBaseUrl') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-minimax-video-base-url"
          label={t('produceMinimaxVideoBaseUrl')}
          hint={t('produceBaseUrlHint')}
          {...state.minimaxVideoBaseUrl}
          onEdit={(text) => { props.edit('minimaxVideoBaseUrl', text) }}
          onReset={() => { props.resetField('minimaxVideoBaseUrl') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-minimax-video-model"
          label={t('produceMinimaxVideoModel')}
          hint={t('produceMinimaxVideoModelHint')}
          {...state.minimaxVideoModel}
          onEdit={(text) => { props.edit('minimaxVideoModel', text) }}
          onReset={() => { props.resetField('minimaxVideoModel') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-mimo" title={t('produceGroupMimo')}>
        <SecretField
          id="plugin-config-produce-mimo-key"
          label={t('produceMimoKeyLabel')}
          hint={t('produceMimoKeyHint')}
          stateLabel={state.keys.mimoApiKey.configured ? t('produceKeySet') : t('produceKeyUnset')}
          onEdit={(text) => { props.edit('mimoApiKey', text) }}
          {...secret(state.keys.mimoApiKey)}
        />
        {bulkButton('mimoApiKey', t('produceGroupMimo'), t('produceMimoKeyLabel'))}
        <ValueField
          id="plugin-config-produce-mimo-api-url"
          label={t('produceMimoApiUrl')}
          hint={t('produceBaseUrlHint')}
          {...state.mimoApiUrl}
          onEdit={(text) => { props.edit('mimoApiUrl', text) }}
          onReset={() => { props.resetField('mimoApiUrl') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-mimo-model"
          label={t('produceMimoModel')}
          hint={t('produceModelHint')}
          {...state.mimoModel}
          onEdit={(text) => { props.edit('mimoModel', text) }}
          onReset={() => { props.resetField('mimoModel') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-mimo-tts-voice"
          label={t('produceMimoTtsVoice')}
          hint={t('produceModelHint')}
          {...state.mimoTtsVoice}
          onEdit={(text) => { props.edit('mimoTtsVoice', text) }}
          onReset={() => { props.resetField('mimoTtsVoice') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-fish" title={t('produceGroupFish')}>
        <SecretField
          id="plugin-config-produce-fish-key"
          label={t('produceFishKeyLabel')}
          hint={t('produceFishKeyHint')}
          stateLabel={state.keys.fishApiKey.configured ? t('produceKeySet') : t('produceKeyUnset')}
          onEdit={(text) => { props.edit('fishApiKey', text) }}
          {...secret(state.keys.fishApiKey)}
        />
        {bulkButton('fishApiKey', t('produceGroupFish'), t('produceFishKeyLabel'))}
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-agnes" title={t('produceGroupAgnes')}>
        <SecretField
          id="plugin-config-produce-agnes-key"
          label={t('produceAgnesKeyLabel')}
          hint={t('produceAgnesKeyHint')}
          stateLabel={state.keys.agnesApiKey.configured ? t('produceKeySet') : t('produceKeyUnset')}
          onEdit={(text) => { props.edit('agnesApiKey', text) }}
          {...secret(state.keys.agnesApiKey)}
        />
        {bulkButton('agnesApiKey', t('produceGroupAgnes'), t('produceAgnesKeyLabel'))}
        <ValueField
          id="plugin-config-produce-agnes-base-url"
          label={t('produceAgnesBaseUrl')}
          hint={t('produceBaseUrlHint')}
          {...state.agnesBaseUrl}
          onEdit={(text) => { props.edit('agnesBaseUrl', text) }}
          onReset={() => { props.resetField('agnesBaseUrl') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-agnes-image-model"
          label={t('produceAgnesImageModel')}
          hint={t('produceAgnesImageModelHint')}
          {...state.agnesImageModel}
          onEdit={(text) => { props.edit('agnesImageModel', text) }}
          onReset={() => { props.resetField('agnesImageModel') }}
          {...value}
        />
        <ValueField
          id="plugin-config-produce-agnes-video-model"
          label={t('produceAgnesVideoModel')}
          hint={t('produceAgnesVideoModelHint')}
          {...state.agnesVideoModel}
          onEdit={(text) => { props.edit('agnesVideoModel', text) }}
          onReset={() => { props.resetField('agnesVideoModel') }}
          {...value}
        />
      </ProduceGroup>
      <ProduceGroup id="plugin-config-produce-group-voice" title={t('produceGroupVoice')}>
        <ValueField
          id="plugin-config-produce-tts-provider"
          label={t('produceTtsProvider')}
          hint={t('produceTtsProviderHint')}
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
            description={t('produceKeysDialogDescription')}
            label={bulk.label}
            inputId={`plugin-config-produce-${bulk.field}-bulk`}
            placeholder={t('produceKeysDialogPlaceholder')}
            countLabel={t('produceKeysCount')}
            clearLabel={t('produceKeysClear')}
            saveLabel={t('save')}
            discardLabel={t('discard')}
            failedLabel={t('saveFailed')}
            closeLabel={t('produceKeysCloseLabel')}
            disabled={!state.keys[bulk.field].writable}
            onSave={text => props.saveKeys(bulk.field, text)}
            onClose={() => { setBulk(null) }}
          />
        )}
    </PluginCard>
  )
}
