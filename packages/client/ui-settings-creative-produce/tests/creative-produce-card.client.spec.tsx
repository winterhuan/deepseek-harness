// @vitest-environment jsdom

/**
 * The creative production page chrome: six write-only key controls plus the
 * runtime profile, and that it renders nothing while unserved.
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreativeProduceCard, type CreativeProduceCardProps } from '../src/client/CreativeProduceCard.tsx'
import type { CreativeProduceCardState } from '../src/client/creative-produce-card-controller.ts'

afterEach(cleanup)

function field(text = '', overridden = false) {
  return { text, overridden, invalid: false }
}

function keyControl(configured = false) {
  return { draft: field(), configured, writable: true }
}

function state(overrides: Partial<CreativeProduceCardState> = {}): CreativeProduceCardState {
  return {
    available: true,
    writable: true,
    dirty: false,
    invalid: false,
    saving: false,
    failed: false,
    keys: {
      openaiApiKey: keyControl(),
      arkApiKey: keyControl(true),
      minimaxApiKey: keyControl(),
      mimoApiKey: keyControl(),
      fishApiKey: keyControl(),
      agnesApiKey: keyControl(),
    },
    seedanceModel: field('seedance-2-5'),
    minimaxVideoModel: field(),
    openaiBaseUrl: field(),
    minimaxBaseUrl: field(),
    minimaxVideoBaseUrl: field(),
    seedanceBaseUrl: field(),
    mimoApiUrl: field(),
    ttsProvider: field('auto'),
    mimoModel: field(),
    mimoTtsVoice: field(),
    agnesBaseUrl: field(),
    agnesImageModel: field(),
    agnesVideoModel: field('agnes-video-2.5-flash'),
    ...overrides,
  }
}

function propsFor(
  snapshot: CreativeProduceCardState,
  actions: Record<string, ReturnType<typeof vi.fn>> = {},
): CreativeProduceCardProps {
  const edit = actions.edit ?? vi.fn()
  const resetField = actions.resetField ?? vi.fn()
  const save = actions.save ?? vi.fn()
  const discard = actions.discard ?? vi.fn()
  const saveKeys = actions.saveKeys ?? vi.fn(async () => true)
  return {
    t: (key: string) => key,
    useCreativeProduceCard: (selector: (value: CreativeProduceCardState) => unknown) => selector(snapshot),
    edit,
    resetField,
    save,
    discard,
    saveKeys,
  } as unknown as CreativeProduceCardProps
}

describe('CreativeProduceCard', () => {
  it('says the plugin is not loaded in place of its fields while its namespace is unavailable', () => {
    render(<CreativeProduceCard {...propsFor(state({ available: false }))} />)

    expect(screen.getByRole('status').textContent).toBe('unavailable')
  })

  it('renders its one-liner in the summary view', () => {
    render(<CreativeProduceCard {...propsFor(state())} view="summary" />)

    expect(screen.getByText('description')).toBeTruthy()
    expect(screen.queryByLabelText('openaiKeyLabel')).toBeNull()
  })

  it('shows six key controls and the runtime profile', () => {
    render(<CreativeProduceCard {...propsFor(state())} />)

    expect(screen.getByLabelText('openaiKeyLabel')).toHaveProperty('type', 'password')
    expect(screen.getByLabelText('arkKeyLabel')).toBeTruthy()
    expect(screen.getByLabelText('minimaxKeyLabel')).toBeTruthy()
    expect(screen.getByLabelText('mimoKeyLabel')).toBeTruthy()
    expect(screen.getByLabelText('fishKeyLabel')).toBeTruthy()
    expect(screen.getByLabelText('seedanceModel')).toHaveProperty('value', 'seedance-2-5')
    expect(screen.getByLabelText('ttsProvider')).toHaveProperty('value', 'auto')
    expect(screen.getByLabelText('agnesVideoModel')).toHaveProperty('value', 'agnes-video-2.5-flash')
    // A configured key reports its state; an unconfigured one reports the lack.
    expect(screen.getAllByText('keySet')).toHaveLength(1)
    expect(screen.getAllByText('keyUnset')).toHaveLength(5)
  })

  it('stages edits without writing', () => {
    const edit = vi.fn()
    render(<CreativeProduceCard {...propsFor(state(), { edit })} />)

    fireEvent.change(screen.getByLabelText('minimaxVideoModel'), { target: { value: 'MiniMax-H3' } })
    fireEvent.change(screen.getByLabelText('mimoKeyLabel'), { target: { value: 'mimo-secret' } })

    expect(edit).toHaveBeenCalledWith('minimaxVideoModel', 'MiniMax-H3')
    expect(edit).toHaveBeenCalledWith('mimoApiKey', 'mimo-secret')
  })

  it('saves through the form action and discards when the page leaves', () => {
    const save = vi.fn()
    const discard = vi.fn()
    const view = render(<CreativeProduceCard {...propsFor(state({ dirty: true }), { save, discard })} />)

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(save).toHaveBeenCalledOnce()
    // The form writes only on save; leaving the page drops every staged edit.
    expect(discard).not.toHaveBeenCalled()

    view.unmount()
    expect(discard).toHaveBeenCalledOnce()
  })

  it('resets an overridden profile field', () => {
    const resetField = vi.fn()
    render(
      <CreativeProduceCard
        {...propsFor(state({ seedanceModel: field('custom', true) }), { resetField })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'reset' }))

    expect(resetField).toHaveBeenCalledWith('seedanceModel')
  })

  it('groups one provider key with its endpoint and model', () => {
    render(<CreativeProduceCard {...propsFor(state())} />)

    const groups = screen.getAllByRole('group')
    expect(groups.map(group => group.querySelector('h3')?.textContent)).toEqual([
      'groupOpenai',
      'groupSeedance',
      'groupMinimax',
      'groupMimo',
      'groupFish',
      'groupAgnes',
      'groupVoice',
    ])
    // Key, endpoint, and model share the provider group.
    const seedance = screen.getByRole('group', { name: 'groupSeedance' })
    expect(seedance.contains(screen.getByLabelText('arkKeyLabel'))).toBe(true)
    expect(seedance.contains(screen.getByLabelText('seedanceBaseUrl'))).toBe(true)
    expect(seedance.contains(screen.getByLabelText('seedanceModel'))).toBe(true)
    const minimax = screen.getByRole('group', { name: 'groupMinimax' })
    expect(minimax.contains(screen.getByLabelText('minimaxVideoBaseUrl'))).toBe(true)
    expect(minimax.contains(screen.getByLabelText('minimaxVideoModel'))).toBe(true)
    const agnes = screen.getByRole('group', { name: 'groupAgnes' })
    expect(agnes.contains(screen.getByLabelText('agnesKeyLabel'))).toBe(true)
    expect(agnes.contains(screen.getByLabelText('agnesBaseUrl'))).toBe(true)
    expect(agnes.contains(screen.getByLabelText('agnesImageModel'))).toBe(true)
    expect(agnes.contains(screen.getByLabelText('agnesVideoModel'))).toBe(true)
  })

  it('opens one bulk dialog per provider group', () => {
    render(<CreativeProduceCard {...propsFor(state())} />)

    for (
      const [group, label] of [
        ['groupOpenai', 'openaiKeyLabel'],
        ['groupSeedance', 'arkKeyLabel'],
        ['groupMinimax', 'minimaxKeyLabel'],
        ['groupMimo', 'mimoKeyLabel'],
        ['groupFish', 'fishKeyLabel'],
        ['groupAgnes', 'agnesKeyLabel'],
      ] as const
    ) {
      const section = screen.getByRole('group', { name: group })
      fireEvent.click(within(section).getByRole('button', { name: 'manageKeys' }))
      const dialog = screen.getByRole('dialog', { name: group })
      expect(within(dialog).getByLabelText(label)).toBeTruthy()
      fireEvent.click(within(dialog).getByRole('button', { name: 'discard' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('counts valid lines and saves the whole pool through saveKeys', async () => {
    const saveKeys = vi.fn(async () => true)
    render(<CreativeProduceCard {...propsFor(state(), { saveKeys })} />)
    fireEvent.click(
      within(screen.getByRole('group', { name: 'groupAgnes' }))
        .getByRole('button', { name: 'manageKeys' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'groupAgnes' })
    const area = within(dialog).getByLabelText('agnesKeyLabel')
    expect(within(dialog).getByRole('button', { name: 'save' })).toHaveProperty('disabled', true)

    fireEvent.change(area, { target: { value: '  sk-a\n\nsk-b\n' } })
    expect(within(dialog).getByText('keysCount2')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'save' }))
    await vi.waitFor(() => { expect(saveKeys).toHaveBeenCalledWith('agnesApiKey', '  sk-a\n\nsk-b\n') })
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('keeps a rejected pool open for correction', async () => {
    const saveKeys = vi.fn(async () => false)
    render(<CreativeProduceCard {...propsFor(state(), { saveKeys })} />)
    fireEvent.click(
      within(screen.getByRole('group', { name: 'groupAgnes' }))
        .getByRole('button', { name: 'manageKeys' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'groupAgnes' })
    fireEvent.change(within(dialog).getByLabelText('agnesKeyLabel'), { target: { value: 'sk-a' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'save' }))

    await vi.waitFor(() => { expect(within(dialog).getByRole('status')).toHaveProperty('textContent', 'saveFailed') })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('clears the local text without writing', () => {
    const saveKeys = vi.fn()
    render(<CreativeProduceCard {...propsFor(state(), { saveKeys })} />)
    fireEvent.click(
      within(screen.getByRole('group', { name: 'groupAgnes' }))
        .getByRole('button', { name: 'manageKeys' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'groupAgnes' })
    const area = within(dialog).getByLabelText('agnesKeyLabel') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'sk-a\nsk-b' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'keysClear' }))

    expect(area.value).toBe('')
    expect(saveKeys).not.toHaveBeenCalled()
  })

  it('disables the dialog write while the credentials domain refuses it', () => {
    render(<CreativeProduceCard {...propsFor(state({
      keys: {
        openaiApiKey: keyControl(),
        arkApiKey: keyControl(),
        minimaxApiKey: keyControl(),
        mimoApiKey: keyControl(),
        fishApiKey: keyControl(),
        agnesApiKey: { draft: field(), configured: false, writable: false },
      },
    }))} />)
    const section = screen.getByRole('group', { name: 'groupAgnes' })
    expect(within(section).getByRole('button', { name: 'manageKeys' }))
      .toHaveProperty('disabled', true)
  })

  it('disables the dialog save while a write is crossing the wire', async () => {
    let release!: (landed: boolean) => void
    const saveKeys = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve }))
    render(<CreativeProduceCard {...propsFor(state(), { saveKeys })} />)
    fireEvent.click(
      within(screen.getByRole('group', { name: 'groupAgnes' }))
        .getByRole('button', { name: 'manageKeys' }),
    )
    const dialog = screen.getByRole('dialog', { name: 'groupAgnes' })
    fireEvent.change(within(dialog).getByLabelText('agnesKeyLabel'), { target: { value: 'sk-a' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'save' }))

    expect(within(dialog).getByRole('button', { name: 'save' })).toHaveProperty('disabled', true)
    release(true)
    await vi.waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})
