/** Real job bindings, targeted stop and restart recovery through the Web profile. */
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { latestPersistedSessionPaths } from '@deepseek-ai/dsh-session-snapshot'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@deepseek-ai/dsh-tools/types'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFinalWorkspaceSnapshot, captureStableAria,
  compareOrRefreshGolden, fixtureUserPrompts, selectedSessionFixture, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, newChinesePage, saveFailureShot, writeComposerDraft } from './support.ts'
import { compareWebProfileSession, launchWebProfile, type WebProfileProcess } from './profile-scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/creative-production', import.meta.url))
const EXPECTED_DIR = fileURLToPath(new URL('./expected/creative-production', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./workbench-presence.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record' || process.platform === 'win32')('web profile: Creative process jobs', () => {
  let world: string
  let fixture: string
  let origin: string
  let prompts: string[]
  let host: WebProfileProcess | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  const launch = (): Promise<WebProfileProcess> => launchWebProfile({
    world, fixture, overlay: OVERLAY, mode: MODE,
    env: { DSH_TOOLS_MODE: 'both', DSH_SNAPSHOT_OVERRIDE: join(SNAPSHOT_DIR, 'replay.override.json') },
  })

  async function openEpisode(book: string): Promise<void> {
    if (await page.locator('.creative-workspace').count() === 0) {
      await page.locator('[data-sidebar-right-expand]').click()
      await page.locator('[data-sidebar-right-guide-entry="creative"]').click()
    }
    const group = page.locator('.creative-file-group').filter({ hasText: book }).first()
    if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click()
    for (const path of [`${book}/剧集`, `${book}/剧集/EP001`]) {
      const summary = page.locator(`.creative-file-folder > summary[title="${path}"]`)
      if (await summary.locator('..').getAttribute('open') === null) await summary.click()
    }
    await page.getByRole('button', { name: `${book}/剧集/EP001/分镜.md`, exact: true }).click()
    await page.getByRole('tab', { name: '生产', exact: true }).click()
    await page.getByRole('tab', { name: '任务', exact: true }).click()
  }

  async function turnCount(): Promise<number> {
    const root = join(world, 'sessions')
    const paths = latestPersistedSessionPaths(await readdir(root, { recursive: true }))
    const logs = await Promise.all(paths.map(path => readFile(join(root, path), 'utf8')))
    return logs.reduce((count, log) => count + (log.match(/"type":"turn\/end"/gu)?.length ?? 0), 0)
  }

  beforeAll(async () => {
    fixture = await selectedSessionFixture(join(SNAPSHOT_DIR, 'session.v2.jsonl'))
    prompts = fixtureUserPrompts(await readFile(fixture, 'utf8'))
    expect(prompts).toHaveLength(3)
    world = await realpath(await mkdtemp(join(tmpdir(), 'dsh-creative-jobs-')))
    await mkdir(join(world, 'sessions'))
    await cp(join(SNAPSHOT_DIR, 'workspace'), join(world, 'workspace'), { recursive: true })
    host = await launch()
    origin = new URL(host.url).origin
    browser = await chromium.launch()
    page = await newChinesePage(browser)
    tripwire = watchConsole(page)
    await page.goto(host.url, { waitUntil: 'load' })
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await connectFreshWorkspaceZh(page, world)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await host?.close().catch((error: unknown) => failures.push(error))
    if (world !== undefined) await rm(world, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Creative job scenario cleanup failed')
  })

  it('restores Native/PTC batches without consuming output or cancelling unrelated work', async () => {
    onTestFailed(async () => {
      if (page !== undefined) await saveFailureShot(page, 'web-e2e-creative-production')
      console.error(host?.output())
    })
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await writeComposerDraft(page, input, prompts[0]!)
    await input.press('Enter')
    await page.getByText('PRODUCTION_READY', { exact: true }).waitFor({ timeout: 60_000 })
    await expect.poll(turnCount, { timeout: 15_000 }).toBe(1)
    await openEpisode('书甲')
    const native = page.locator('[data-job-id="bash-1"]')
    const ptc = page.locator('[data-job-id="bash-2"]')
    await expect.poll(() => native.getAttribute('data-status')).toBe('running')
    await expect.poll(() => ptc.getAttribute('data-status')).toBe('running')
    expect(await page.locator('[data-request-id="web-production-main"]').count()).toBe(1)
    expect(await page.locator('[data-job-id="bash-3"]').count()).toBe(0)
    expect(await page.locator('.creative-task-board').innerText()).toContain('0/2 个已登记作业结束')
    expect(await page.locator('.creative-task-board progress, .creative-task-board [role="progressbar"]').count()).toBe(0)
    await mkdir(EXPECTED_DIR, { recursive: true })
    await compareOrRefreshGolden(join(EXPECTED_DIR, 'running.aria.txt'), await captureStableAria(page, '.creative-task-board', join(world, 'workspace')), MODE)

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await openEpisode('书甲')
    await expect.poll(() => native.getAttribute('data-status'), { timeout: 15_000 }).toBe('running')
    await expect.poll(() => ptc.getAttribute('data-status')).toBe('running')
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await expect.poll(() => readFile(join(world, 'workspace/native-ready.txt'), 'utf8')).toBe('ready\n')
    await writeComposerDraft(page, input, prompts[1]!)
    await input.press('Enter')
    await page.getByText('OUTPUT_CHECKED', { exact: true }).waitFor({ timeout: 30_000 })
    await expect.poll(turnCount).toBe(2)
    await writeComposerDraft(page, input, prompts[2]!)
    await input.press('Enter')
    await page.getByText('UNRELATED_DONE', { exact: true }).waitFor({ timeout: 30_000 })
    await expect.poll(turnCount).toBe(3)
    expect(await native.getAttribute('data-status')).toBe('running')
    expect(await ptc.getAttribute('data-status')).toBe('running')

    await native.getByRole('button', { name: '停止该作业', exact: true }).click()
    await expect.poll(() => native.getAttribute('data-status')).toBe('killed')
    expect(await ptc.getAttribute('data-status')).toBe('running')
    await compareOrRefreshGolden(join(EXPECTED_DIR, 'stopped.aria.txt'), await captureStableAria(page, '.creative-task-board', join(world, 'workspace')), MODE)
    await openEpisode('书乙')
    await expect.poll(() => page.locator('[data-job-id="bash-3"]').getAttribute('data-status')).toBe('running')
    expect(await page.locator('[data-job-id="bash-1"], [data-job-id="bash-2"]').count()).toBe(0)
    await assertFinalWorkspaceSnapshot(SNAPSHOT_DIR, join(world, 'workspace'))
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])

    await page.close()
    await host?.close()
    host = await launch()
    page = await newChinesePage(browser!)
    tripwire = watchConsole(page)
    await page.goto(host.url, { waitUntil: 'load' })
    const workspace = page.getByRole('treeitem').first()
    await workspace.waitFor()
    if (await workspace.getAttribute('aria-expanded') !== 'true') await workspace.click()
    await page.getByRole('treeitem').nth(1).click()
    await openEpisode('书甲')
    await expect.poll(() => page.locator('[data-job-id="bash-1"]').getAttribute('data-status')).toBe('unavailable')
    await expect.poll(() => page.locator('[data-job-id="bash-2"]').getAttribute('data-status')).toBe('unavailable')
    expect(await page.locator('.creative-task-board').getByRole('button', { name: '停止该作业', exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(join(EXPECTED_DIR, 'unavailable.aria.txt'), await captureStableAria(page, '.creative-task-board', join(world, 'workspace')), MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await page.close()
    await host.close()
    const raw = await compareWebProfileSession({ world, fixture, mode: MODE, origin })
    const events = parseSessionLog(raw)
    expect(events.some(event => event.type === 'tool/ptc-dispatch' && event.data.name === 'creative_production')).toBe(true)
    const results = events.filter(event => event.type === 'tool/result')
    expect(JSON.stringify(results.find(event => event.data.message.source.callId === 'read-native'))).toContain('NATIVE_OUTPUT')
    expect(results.some(event => event.data.meta !== undefined && JSON.stringify(event.data.meta).includes('web-production-main'))).toBe(true)
  })
})
