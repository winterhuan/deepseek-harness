// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { NovelView } from '../src/client/NovelView.tsx'
import { en, zh } from '../src/client/locale.ts'
import { apply, inject } from '../src/client/index.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** Compose the browser half against a real Context with the view slot declared. */
async function mounted() {
  ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { slots, fiber }
}

describe('ui-novel client plugin', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('seats the novel view and dictionaries while the slot exists, and removes them with the fiber', async () => {
    const { slots, fiber } = await mounted()
    const entries = slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.component).toBe(NovelView)
    // The lazy label resolves through the bound dictionaries at read time.
    const label = resolveSlotLabel((entries[0]!.options as { label?: Parameters<typeof resolveSlotLabel>[0] }).label)
    expect([zh['view.novel'], en['view.novel']]).toContain(label)
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })
})
