import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const STORY_PROVIDER_NAME = 'creative'
const DRAMA_PROVIDER_NAME = 'short-drama'
const GAME_PROVIDER_NAME = 'novel-to-game'
const VIDEO_PROVIDER_NAME = 'video-recap'
const DSH_SKILL_ROUTING = [
  'Workflow stages are Skills: load each one with the skill tool and its exact catalog name in the name argument. For a $name or /name reference, omit the prefix. Loading supplies instructions to the current Agent.',
  'creative_role accepts only the novel specialist names in its role enum; never pass a Skill name as role. If delegation is needed and subagent is visible, send a self-contained task that tells the child to load the named Skill with skill before working.',
]
const DSH_SKILL_BRIDGE = [
  '<creative-dsh-integration>',
  'This Skill is a native contribution to the current DeepSeek Harness session.',
  'DSH owns the workspace, model, preset, permissions, Session Log, tools, subagents, cancellation, resume, and Agent UI.',
  'Never start another Agent runtime, session transport, Dashboard, SSE stream, polling loop, or model configuration.',
  ...DSH_SKILL_ROUTING,
  'Roles do not require project-local platform files or deployment markers.',
  'Use only DSH-visible tools. DSH sandbox and permission policy remain authoritative.',
  '</creative-dsh-integration>',
].join('\n')
const DSH_DRAMA_BRIDGE = [
  '<short-drama-dsh-integration>',
  'This Skill is a native contribution to the current DeepSeek Harness session.',
  'DSH owns the workspace, model, preset, permissions, Session Log, tools, approvals, cancellation, resume, and Agent UI.',
  ...DSH_SKILL_ROUTING,
  'The 短剧 tab is the creator workspace. Never start dashboard_server.py, another web server, Dashboard, Agent runtime, session transport, or model configuration.',
  'Drama Skills v0.6 uses a creator-first contract: each episode keeps only the requested documents, up to five creator-facing sources at 剧集/<EP>/剧本.md, 视觉设定.md, 分镜.md, 图片提示词.md, and 视频提示词.md. Never precreate empty documents, backfill nominal stages, or start work the creator did not request. Persisted reviews use creator-readable Markdown under 审查/; an oral review writes nothing.',
  'For a v0.6 project, never create a parallel JSON/JSONL lifecycle truth, indexes, fingerprints, coverage tables, or QA records merely because legacy maintenance scripts and templates remain bundled.',
  'Never upgrade a v0.5 structured project in place or mix both contracts in one project root. Keep legacy production/audit artifacts read-only and pinned to v0.5; migrate only into a new creator-first root with manual per-episode creator confirmation.',
  'Use only tools visible in the current DSH preset and preserve project ownership, freshness, review, and explicit production-confirmation contracts.',
  'Use creative_production only for semantic production-view intents (open/focus, explicit shot order, or tracking a job that this Agent is actually executing). Cosmetic canvas layout remains creator-controlled. The tool changes only the Session projection: it does not edit creator documents, generate media, or authorize production.',
  'Production credentials remain outside project files. Never treat a prior acceptance, preview, continuation request, or budget discussion as confirmation for a paid production run.',
  'Use creative_produce_status to check configured production adapters when that tool is visible. Ordinary bash os.environ checks do not inspect the DSH credential store. For Agnes images use creative_produce_run with entry drama and adapter agnes-image after job confirmation. Never request API keys in chat or read credential files; missing credentials are configured in Settings > Plugins > Creative production.',
  '</short-drama-dsh-integration>',
].join('\n')
const DSH_GAME_BRIDGE = [
  '<novel-to-game-dsh-integration>',
  'This Skill is a native contribution to the current DeepSeek Harness session.',
  'DSH owns the workspace, model, preset, permissions, Session Log, tools, approvals, cancellation, resume, Todo, and Chat UI.',
  ...DSH_SKILL_ROUTING,
  'The 游戏 tab is the playable Game Studio. Never start a second Agent runtime, dashboard, session transport, or model configuration.',
  'Write game adaptation artifacts under game-adaptations/<project>/ using the seven bundled Skills and their artifact requirements.',
  'For a web target, keep the authoritative playable entry at build/app/index.html so Game Studio can preview it. Do not silently replace a requested non-web runtime with a web build.',
  'Use only DSH-visible tools and approvals. qa/verification.json remains the sole machine QA truth and must cover launch, render, input, coreLoop, outcome, and restart with real execution evidence.',
  'The bundled Jin Ping Mei project is a read-only example, not a template to copy mechanically and not proof that another adaptation passed QA.',
  'Adapt games from the novel (a story workspace or novel text), never from short-drama documents: screenplay density cannot support system design, and same-IP dual adaptation shares the novel upstream, not the drama. Record the adaptation edge with story-import record_lineage.py when intaking from a novel workspace or export package.',
  '</novel-to-game-dsh-integration>',
].join('\n')
const DSH_VIDEO_BRIDGE = [
  '<video-recap-dsh-integration>',
  'This Skill is a native contribution to the current DeepSeek Harness session.',
  'DSH owns the workspace, model, preset, permissions, Session Log, tools, approvals, cancellation, resume, Todo, Chat, and the 视频 preview Studio.',
  ...DSH_SKILL_ROUTING,
  'Never start a second Agent runtime, dashboard, session transport, web server, polling loop, or model configuration.',
  'Use the six bundled Skills. Put each project under video-recaps/<project>/, source media under sources/, and use work/ as work_dir so the Studio can discover authoritative manifests and outputs.',
  'Short-drama production outputs are ready recap sources: copy files from 剧集/<EP>/制作成果/ into the recap project sources/ preserving filenames (SHOT-/VISUAL- ids are the provenance), then run the normal pipeline. Record drama-to-recap deliveries the same way with story-import record_lineage.py; the ledger edge is the delivery handshake.',
  'The Video Studio is a preview and artifact surface, not a nonlinear editor. Do not invent a second project-state format, timeline truth, or render queue; recap_run_manifest.json, recap_phase.json, timeline.json, assembly_manifest.json, and the documented pipeline artifacts remain authoritative.',
  'MIMO_API_KEY, FISH_API_KEY, and voice credentials resolve from the creative-produce profile and the credential store. Never write secrets into project files, tool arguments shown to the browser, or chat output. Run credentialed production only through creative_produce_run (entries video-voiceover, video-recap, video-doctor): subprocess children start credential-scrubbed, so invoking them through bash never receives the configured keys.',
  'When creative_produce_status is visible, use it to inspect credential presence before reporting a missing key. An ordinary shell environment is not a view of the DSH credential store; never ask the creator to paste keys into chat.',
  'Use only DSH-visible tools and approvals. Run Python and ffmpeg through the current DSH execution world, preserve cancellation, and do not install or upgrade system dependencies without explicit user approval.',
  'When a new edited or final video is ready, tell the user that Video Studio can load it; never interrupt playback by replacing the currently loaded video silently.',
  '</video-recap-dsh-integration>',
].join('\n')

interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly userInvocable: boolean
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split(/\r?\n/u)
  const index = lines.findIndex(line => new RegExp(`^${key}:\\s*`, 'u').test(line))
  if (index < 0) return undefined
  const raw = lines[index]?.replace(new RegExp(`^${key}:\\s*`, 'u'), '').trim()
  if (raw === undefined) return undefined
  if (raw === '>' || raw === '|' || raw === '>-' || raw === '|-') {
    const values: string[] = []
    for (const line of lines.slice(index + 1)) {
      if (/^\S/u.test(line)) break
      values.push(line.trim())
    }
    return (raw.startsWith('>') ? values.join(' ') : values.join('\n')).trim()
  }
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { return JSON.parse(raw) as string }
    catch { return raw.slice(1, -1) }
  }
  return raw.replace(/^['"]|['"]$/gu, '')
}

/**
 * Parse one bundled `SKILL.md` into its frontmatter identity and body.
 * @param source - the raw skill file content.
 * @returns the parsed name, description, body, and user-invocation metadata.
 * @throws Error when frontmatter is missing, the name is not a slug, or the
 * description is empty.
 */
export function parseBundledSkill(source: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source)
  if (match?.[1] === undefined) throw new Error('Bundled skill is missing YAML frontmatter.')
  const name = frontmatterValue(match[1], 'name')
  const description = frontmatterValue(match[1], 'description')
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) throw new Error('Bundled skill has an invalid name.')
  if (!description) throw new Error(`Bundled skill "${name}" has no description.`)
  return {
    name,
    description,
    content: source.slice(match[0].length),
    userInvocable: frontmatterValue(match[1], 'user-invocable') !== 'false',
  }
}

/**
 * The packaged story-skill root backing the `creative` provider.
 * @returns the default root derived from this module's location.
 */
export function defaultBundledSkillRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge/creative/skills')
}

/**
 * The packaged drama-skill root backing the `short-drama` provider and produce entries.
 * @returns the default root derived from this module's location.
 */
export function defaultDramaSkillRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge/drama/skills')
}

/**
 * The packaged novel-to-game skill root backing the game provider and preview examples.
 * @returns the default root derived from this module's location.
 */
export function defaultNovelToGameSkillRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge/novel-to-game/skills')
}

function createBundledSkillProvider(
  providerName: string,
  skillRoot: string,
  bridge: string,
): SkillProvider {
  const root = resolve(skillRoot)
  return {
    name: providerName,
    async list(): Promise<readonly SkillCandidate[]> {
      const directories = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
      return Promise.all(directories.map(async (directory): Promise<SkillCandidate> => {
        const path = join(root, directory, 'SKILL.md')
        const parsed = parseBundledSkill(await readFile(path, 'utf8'))
        if (parsed.name !== directory) throw new Error(`Bundled skill directory "${directory}" does not match name "${parsed.name}".`)
        return {
          name: parsed.name,
          description: parsed.description,
          invocation: { modelInvocable: true, userInvocable: parsed.userInvocable },
          provider: providerName,
          source: 'bundled',
          resourceBase: { kind: 'directory', path: join(root, directory) },
          rank: BUNDLED_SKILL_RANK,
          locator: pathToFileURL(path),
          path,
        }
      }))
    },
    async get(candidate): Promise<SkillDefinition | undefined> {
      if (candidate.provider !== providerName || typeof candidate.path !== 'string') return undefined
      const path = resolve(candidate.path)
      const relativePath = relative(root, path)
      if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('Bundled skill locator escaped the packaged skill root.')
      }
      const parsed = parseBundledSkill(await readFile(path, 'utf8'))
      if (parsed.name !== candidate.name) return undefined
      return {
        name: parsed.name,
        description: parsed.description,
        invocation: { modelInvocable: true, userInvocable: parsed.userInvocable },
        provider: providerName,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: join(root, parsed.name) },
        path,
        content: `${bridge}\n\n${parsed.content}`,
      }
    },
  }
}

/**
 * Build the `creative` provider serving SKILL.md bodies with shared DSH context.
 * @param skillRoot - packaged skill root override.
 * @returns the provider registered with the skills service.
 */
export function createCreativeSkillProvider(skillRoot = defaultBundledSkillRoot()): SkillProvider {
  return createBundledSkillProvider(STORY_PROVIDER_NAME, skillRoot, DSH_SKILL_BRIDGE)
}

/**
 * Build the `short-drama` provider serving the bundled drama skills under the
 * DSH drama bridge.
 * @param skillRoot - packaged skill root override.
 * @returns the provider registered with the skills service.
 */
export function createDramaSkillProvider(skillRoot = defaultDramaSkillRoot()): SkillProvider {
  return createBundledSkillProvider(DRAMA_PROVIDER_NAME, skillRoot, DSH_DRAMA_BRIDGE)
}

/**
 * Build the `novel-to-game` provider serving the bundled game skills under the
 * DSH game bridge.
 * @param skillRoot - packaged skill root override.
 * @returns the provider registered with the skills service.
 */
export function createNovelToGameSkillProvider(skillRoot = defaultNovelToGameSkillRoot()): SkillProvider {
  return createBundledSkillProvider(GAME_PROVIDER_NAME, skillRoot, DSH_GAME_BRIDGE)
}

/**
 * The packaged video-recap skill root backing the video provider and produce entries.
 * @returns the default root derived from this module's location.
 */
export function defaultVideoRecapSkillRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge/video-recap/skills')
}

/**
 * Build the `video-recap` provider serving the bundled video skills under the
 * DSH video bridge.
 * @param skillRoot - packaged skill root override.
 * @returns the provider registered with the skills service.
 */
export function createVideoRecapSkillProvider(skillRoot = defaultVideoRecapSkillRoot()): SkillProvider {
  return createBundledSkillProvider(VIDEO_PROVIDER_NAME, skillRoot, DSH_VIDEO_BRIDGE)
}
