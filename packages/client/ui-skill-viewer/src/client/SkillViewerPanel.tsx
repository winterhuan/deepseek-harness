import type { ReactNode } from 'react'
import { Input, rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillViewerGetValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { SkillViewerReferenceState, SkillViewerState } from './controller.ts'
import css from './SkillViewerPanel.module.css'

/** Plain-data props of the viewer panel: snapshot plus intent callbacks. */
export interface SkillViewerPanelProps extends PropsLocale<'skillViewer'> {
  /** Current panel snapshot. */
  state: SkillViewerState
  /** Search text changed. */
  onQuery: (query: string) => void
  /** List reload requested. */
  onRetry: () => void
  /** Skill row picked. */
  onSelect: (name: string) => void
  /** Detail back navigation requested. */
  onBack: () => void
  /** Reference file or the skill instructions selected. */
  onReference: (path: string) => void
}

/** Provider resource base rendered as one verbatim line. */
function resourceLine(value: NonNullable<SkillViewerGetValue['resourceBase']>): string {
  if (value.kind === 'directory') return value.path
  if (value.kind === 'url') return value.url
  return value.description
}

/**
 * Render one list row: name, badges, description, and source metadata.
 * @param props - row entry plus selection callback and copy.
 * @returns the row button.
 */
function SkillRow({ name, description, modelInvocable, source, provider, selected, t, onSelect }: {
  name: string
  description: string
  modelInvocable: boolean
  source: string
  provider: string
  selected: boolean
  t: SkillViewerPanelProps['t']
  onSelect: (name: string) => void
}): ReactNode {
  return (
    <li key={name} className={css.row}>
      <button type="button" className={css.rowButton} aria-current={selected ? 'true' : undefined} onClick={() => { onSelect(name) }}>
        <span className={css.rowTitle}>
          <code className={css.name}>{name}</code>
          {modelInvocable ? null : <span className={css.badge}>{t('row.userOnly')}</span>}
        </span>
        <span className={css.description}>{description}</span>
        <span className={css.meta}>{`${source} · ${provider}`}</span>
      </button>
    </li>
  )
}

/**
 * Render the searchable catalog alongside a reader, with single-pane navigation on narrow screens.
 * @param props - panel snapshot, copy, and intent callbacks.
 * @returns the panel tree.
 */
export function SkillViewerPanel({ state, t, onQuery, onRetry, onSelect, onBack, onReference }: SkillViewerPanelProps): ReactNode {
  const detail = state.detail
  const matches = rankByName(state.skills, state.query)
  return (
    <div className={css.panel} data-detail={detail !== null || undefined}>
      <div className={css.catalog}>
        {state.scoped ? (
          <div className={css.search}>
            <Input
              className={css.searchInput as string}
              autoFocus
              aria-label={t('search.label')}
              placeholder={t('search.placeholder')}
              value={state.query}
              onChange={(event) => { onQuery(event.target.value) }}
            />
          </div>
        ) : null}
        <div className={css.catalogScroll}>
          {state.status === 'idle' || state.status === 'loading' ? (
            <p className={css.status}>{t('list.loading')}</p>
          ) : null}
          {state.status === 'error' ? (
            <div className={css.errorBlock} role="alert">
              <p className={css.error}>{`${t('list.error')}：${state.error ?? t('error.unknown')}`}</p>
              <button type="button" className={css.retry} onClick={onRetry}>{t('list.retry')}</button>
            </div>
          ) : null}
          {state.status === 'ready' ? (
            <>
              {state.stale ? <p className={css.stale}>{t('list.stale')}</p> : null}
              {state.skills.length === 0 ? (
                <div className={css.empty}>
                  <p className={css.status}>{t('list.empty')}</p>
                  {state.scoped ? null : <p className={css.hint}>{t('list.emptyHint')}</p>}
                </div>
              ) : matches.length === 0 ? (
                <p className={css.status}>{t('list.noResults')}</p>
              ) : (
                <ul className={css.list}>
                  {matches.map(skill => (
                    <SkillRow
                      key={skill.name}
                      name={skill.name}
                      description={skill.description}
                      modelInvocable={skill.modelInvocable}
                      source={skill.source}
                      provider={skill.provider}
                      selected={detail?.name === skill.name}
                      t={t}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>
      </div>
      <div className={css.reader}>
        {detail === null ? (
          <p className={css.selectionHint}>{t('detail.empty')}</p>
        ) : (
          <>
            <div className={css.detailHeader}>
              <button type="button" className={state.reference === null ? css.back : css.referenceBack} onClick={onBack}>
                {t(state.reference === null ? 'detail.back' : 'reference.back')}
              </button>
              <h2 className={css.detailName}><code>{detail.name}</code></h2>
            </div>
            {detail.status === 'loading' ? <p className={css.readerStatus}>{t('detail.loading')}</p> : null}
            {detail.status === 'error' ? (
              <div className={css.readerStatus} role="alert">
                <p className={css.error}>{`${t('detail.error')}：${detail.error ?? t('error.unknown')}`}</p>
                <button type="button" className={css.retry} onClick={() => { onSelect(detail.name) }}>
                  {t('detail.retry')}
                </button>
              </div>
            ) : null}
            {detail.status === 'ready' && detail.value !== null ? (
              <SkillDetail key={`${detail.name}/${state.reference?.path ?? ''}`} value={detail.value} reference={state.reference} onReference={onReference} t={t} />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Render one loaded skill: metadata plus the full instruction body.
 * @param props - loaded skill value and copy.
 * @returns the detail tree.
 */
function SkillDetail({ value, reference, onReference, t }: {
  value: SkillViewerGetValue
  reference: SkillViewerReferenceState | null
  onReference: SkillViewerPanelProps['onReference']
  t: SkillViewerPanelProps['t']
}): ReactNode {
  return (
    <div className={css.detail} role="region" aria-label={t('detail.content')} tabIndex={0}>
      <p className={css.description}>{value.description}</p>
      <section className={css.metadata} aria-label={t('meta.details')}>
        <h3 className={css.metadataHeading}>{t('meta.details')}</h3>
        <dl className={css.metaList}>
          <div className={css.metaRow}>
            <dt>{t('meta.source')}</dt>
            <dd>{value.source}</dd>
          </div>
          <div className={css.metaRow}>
            <dt>{t('meta.provider')}</dt>
            <dd>{value.provider}</dd>
          </div>
          {value.whenToUse === undefined ? null : (
            <div className={css.metaRow}>
              <dt>{t('meta.whenToUse')}</dt>
              <dd>{value.whenToUse}</dd>
            </div>
          )}
          {value.path === undefined ? null : (
            <div className={css.metaRow}>
              <dt>{t('meta.path')}</dt>
              <dd><code>{value.path}</code></dd>
            </div>
          )}
          {value.resourceBase === undefined ? null : (
            <div className={css.metaRow}>
              <dt>{t('meta.resources')}</dt>
              <dd><code>{resourceLine(value.resourceBase)}</code></dd>
            </div>
          )}
        </dl>
      </section>
      <div className={css.references}>
        {value.references === null ? <p className={css.hint}>{t('reference.unavailable')}</p>
          : value.references.files.length === 0 ? null
            : (
              <label className={css.referenceLabel}>
                <span>{t('reference.label')}</span>
                <select className={css.referenceSelect} value={reference?.path ?? ''} onChange={(event) => { onReference(event.target.value) }}>
                  <option value="">{t('reference.instructions')}</option>
                  {value.references.files.map(path => <option key={path} value={path}>{path}</option>)}
                </select>
              </label>
            )}
        {value.references?.files.length === 0 && !value.references.truncated ? <p className={css.hint}>{t('reference.empty')}</p> : null}
        {value.references?.truncated === true ? <p className={css.hint}>{t('reference.listTruncated')}</p> : null}
      </div>
      <section className={css.instructions} aria-label={t('detail.instructions')}>
        <div className={css.instructionsHeader}>{reference?.path ?? t('detail.instructions')}</div>
        {reference?.status === 'loading' ? <p className={css.readerStatus}>{t('reference.loading')}</p> : null}
        {reference?.status === 'error' ? (
          <div className={css.readerStatus} role="alert">
            <p className={css.error}>{`${t('reference.error')}：${reference.error ?? t('error.unknown')}`}</p>
            <button type="button" className={css.retry} onClick={() => { onReference(reference.path) }}>{t('detail.retry')}</button>
          </div>
        ) : null}
        {reference?.value?.truncated === true ? <p className={css.readerStatus}>{t('reference.truncated')}</p> : null}
        {reference === null || reference.status === 'ready'
          ? <pre className={css.body}>{reference === null ? value.content : reference.value?.content}</pre>
          : null}
      </section>
    </div>
  )
}
