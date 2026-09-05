// The workbench stays out of the conversation until creative work arrives in
// the same session, then collapses back to the native layout on demand — and
// a reload keeps the creator's choice.
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFinalWorkspaceSnapshot, fixtureUserPrompts,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/workbench-presence', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const OVERLAY = fileURLToPath(new URL('./workbench-presence.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

const PROMPT = 'Use the write tool (NOT bash) to create a file named 正文/第001章.md in the current directory containing exactly the single line: 春天来了。Then reply with exactly the single word DONE.'

describe('web e2e: workbench presence follows creative work', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionWorkspace: string | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE,
      paceMs: 15,
      compareReplaySession: true,
      extraOverlayPath: OVERLAY,
    })
    scaffold.ctx.on('session/event', (session) => {
      sessionWorkspace = session.header.cwd
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the native conversation until the first creative file, then collapses back', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-presence'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }

    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.waitFor({ timeout: 10_000 })
    const scroller = page.locator('[data-conversation-scroll]').first()

    // Empty workspace: no workbench DOM at all, native layout untouched.
    await expect.poll(() => page.locator('.creative-split-surface').count()).toBe(0)
    const nativeDisplay = await scroller.evaluate(el => getComputedStyle(el).display)

    // The replayed Agent writes its first creative file in this session.
    const settled = scaffold.whenTurnSettled()
    await writeComposerDraft(page, input, PROMPT)
    await input.press('Enter')
    await settled
    await input.waitFor({ timeout: 10_000 })

    // Takeover inside the same session: the surface opens on the new file.
    await expect.poll(() => page.locator('[data-open="true"]').count(), { timeout: 15_000 }).toBe(1)
    await expect.poll(() => page.getByText('第001章.md').count()).toBeGreaterThan(0)
    if (sessionWorkspace === undefined) throw new Error('workbench-presence scenario observed no session workspace')
    const written = join(sessionWorkspace, '正文/第001章.md')
    expect(existsSync(written)).toBe(true)
    expect(readFileSync(written, 'utf8')).toBe('春天来了。')

    // Collapse returns the conversation to DSH untouched, launcher included.
    await page.getByRole('button', { name: '收起创作工作台' }).first().click()
    await expect.poll(() => page.locator('[data-open="true"]').count()).toBe(0)
    await page.getByRole('button', { name: '打开创作工作台' }).waitFor({ timeout: 10_000 })
    expect(await scroller.evaluate(el => getComputedStyle(el).display)).toBe(nativeDisplay)

    // A reload keeps the explicit choice; the launcher brings it back.
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await expect.poll(() => page.locator('[data-open="true"]').count()).toBe(0)
    await page.getByRole('button', { name: '打开创作工作台' }).click()
    await expect.poll(() => page.locator('[data-open="true"]').count(), { timeout: 15_000 }).toBe(1)

    if (sessionWorkspace === undefined) throw new Error('workbench-presence scenario observed no session workspace')
    await assertFinalWorkspaceSnapshot(SNAPSHOT_DIR, sessionWorkspace)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
