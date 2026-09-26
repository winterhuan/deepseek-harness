/** Headless composition for bundled skill text and the real offline production entry. */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createCreativeProduceRunTool, createCreativeProduceStatusTool } from '../../src/produce-tool.ts'
import type { ProduceConfig } from '../../src/produce-settings.ts'
import {
  createCreativeSkillProvider,
  createDramaSkillProvider,
  createNovelToGameSkillProvider,
  createVideoRecapSkillProvider,
} from '../../src/skill-provider.ts'

export const name = 'creative-skill-snapshot'
export const inject = ['skills', 'tools', 'credentials']

/**
 * Stage packaged entry files in the scenario-owned runtime directory for portable resource paths.
 * @param context - the real profile registries receiving the bundled providers and production tool.
 */
export async function apply(context: Context): Promise<void> {
  for (const create of [
    createCreativeSkillProvider,
    createDramaSkillProvider,
    createNovelToGameSkillProvider,
    createVideoRecapSkillProvider,
  ]) {
    const bundled = create()
    const candidates = await bundled.list({})
    if (!Array.isArray(candidates)) throw new Error('Expected a complete bundled catalog.')
    const root = resolve(process.cwd(), '.snapshot-patches', 'creative-skills', bundled.name)
    for (const candidate of candidates) {
      if (typeof candidate.path !== 'string') throw new Error('Bundled skill requires a file path.')
      const directory = resolve(root, candidate.name)
      await mkdir(directory, { recursive: true })
      await copyFile(candidate.path, resolve(directory, 'SKILL.md'))
    }
    context.effect(() => context.skills.registerProvider(() => create(root)))
  }
  const prefix = `CREATIVE_SNAPSHOT_${randomUUID().replaceAll('-', '_')}_`
  const profile: ProduceConfig = {
    openaiApiKeyEnv: `${prefix}OPENAI`,
    arkApiKeyEnv: `${prefix}ARK`,
    minimaxApiKeyEnv: `${prefix}MINIMAX`,
    mimoApiKeyEnv: `${prefix}MIMO`,
    fishApiKeyEnv: `${prefix}FISH`,
    agnesApiKeyEnv: `${prefix}AGNES`,
    agnesBaseUrl: 'https://provider.invalid/v1',
    agnesVideoModel: 'agnes-video-2.5-flash',
  }
  await context.credentials.set(credentialRef(profile.agnesApiKeyEnv!), 'snapshot-agnes-placeholder')
  const project = resolve(process.cwd(), '.snapshot-patches', 'creative-preflight')
  await mkdir(project, { recursive: true })
  await writeFile(resolve(project, 'short-drama.json'), '{}\n')
  await writeFile(resolve(project, 'job.json'), JSON.stringify({
    job_id: 'PREFLIGHT-001', adapter: 'agnes-video', modality: 'video',
    prompt: 'Offline validation fixture.', references: [],
    outputs: ['production/preview.mp4'], parameters: { duration: 13 }, overwrite: false,
  }))
  await promisify(execFile)('python3', ['-B', '-c', [
    'import sys',
    'from pathlib import Path',
    'sys.path.insert(0, sys.argv[1])',
    'from production_tool import prepare_job, confirm_job',
    'root = Path(sys.argv[2])',
    'preview = prepare_job(root, root / "job.json")',
    'confirm_job(root, job_id="PREFLIGHT-001", confirmation=preview["confirmation"])',
  ].join('\n'), resolve(import.meta.dirname, '../../knowledge/drama/skills/short-drama-produce/scripts'), project], { timeout: 30_000 })
  context.effect(() => context.tools.register(createCreativeProduceRunTool({ entry: profile })))
  context.effect(() => context.tools.register(createCreativeProduceStatusTool({ entry: profile })))
}
