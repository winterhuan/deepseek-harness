/**
 * Bundled novel-to-game skill provider for the game-studio host plugin.
 * @module @deepseek-ai/dsh-host-game-studio/skill-provider
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const GAME_PROVIDER_NAME = 'novel-to-game'
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

const DSH_GAME_BRIDGE = [
  '<novel-to-game-dsh-integration>',
  'This Skill is a native contribution to the current DeepSeek Harness session.',
  'DSH owns the workspace, model, preset, permissions, Session Log, tools, approvals, cancellation, resume, Todo, and Chat UI.',
  'The 游戏 tab is the playable Game Studio. Never start a second Agent runtime, dashboard, session transport, or model configuration.',
  'Keep the complete upstream seven-Skill pipeline and write adaptation artifacts under game-adaptations/<project>/ exactly as the upstream contracts specify.',
  'For a web target, keep the authoritative playable entry at build/app/index.html so Game Studio can preview it. Do not silently replace a requested non-web runtime with a web build.',
  'Use only DSH-visible tools and approvals. qa/verification.json remains the sole machine QA truth and must cover launch, render, input, coreLoop, outcome, and restart with real execution evidence.',
  'The bundled example project is a read-only reference, not a template to copy mechanically and not proof that another adaptation passed QA.',
  '</novel-to-game-dsh-integration>',
].join('\n')

interface ParsedSkill {
  readonly name: string
  readonly description: string
  readonly content: string
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(frontmatter)
  const raw = match?.[1]?.trim()
  if (raw === undefined) return undefined
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw.replace(/^['"]|['"]$/gu, '')
}

export function parseBundledSkill(source: string): ParsedSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source)
  if (match?.[1] === undefined) throw new Error('Bundled skill is missing YAML frontmatter.')
  const name = frontmatterValue(match[1], 'name')
  const description = frontmatterValue(match[1], 'description')
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    throw new Error('Bundled skill has an invalid name.')
  }
  if (!description) throw new Error(`Bundled skill "${name}" has no description.`)
  return { name, description, content: source.slice(match[0].length) }
}

export function defaultNovelToGameSkillRoot(): string {
  const current = dirname(fileURLToPath(import.meta.url))
  return resolve(current, '../knowledge/novel-to-game/skills')
}

export function dshNovelToGameSkillContent(_name: string, content: string): string {
  return `${DSH_GAME_BRIDGE}\n\n${content}`
}

/**
 * Create a skill provider that serves the bundled novel-to-game skills.
 * @param skillRoot - optional override for the bundled skill root.
 * @returns a SkillProvider for the registry.
 */
export function createNovelToGameSkillProvider(skillRoot = defaultNovelToGameSkillRoot()): SkillProvider {
  const root = resolve(skillRoot)
  return {
    name: GAME_PROVIDER_NAME,
    async list(): Promise<readonly SkillCandidate[]> {
      const directories = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
      return Promise.all(
        directories.map(async (directory): Promise<SkillCandidate> => {
          const path = join(root, directory, 'SKILL.md')
          const parsed = parseBundledSkill(await readFile(path, 'utf8'))
          if (parsed.name !== directory) {
            throw new Error(`Bundled skill directory "${directory}" does not match name "${parsed.name}".`)
          }
          return {
            name: parsed.name,
            description: parsed.description,
            invocation: INVOCATION,
            provider: GAME_PROVIDER_NAME,
            source: 'bundled' as const,
            resourceBase: { kind: 'directory', path: join(root, directory) },
            rank: BUNDLED_SKILL_RANK,
            locator: pathToFileURL(path),
            path,
          }
        }),
      )
    },
    async get(candidate): Promise<SkillDefinition | undefined> {
      if (candidate.provider !== GAME_PROVIDER_NAME || typeof candidate.path !== 'string') return undefined
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
        invocation: INVOCATION,
        provider: GAME_PROVIDER_NAME,
        source: 'bundled' as const,
        resourceBase: { kind: 'directory', path: join(root, parsed.name) },
        path,
        content: dshNovelToGameSkillContent(parsed.name, parsed.content),
      }
    },
  }
}
