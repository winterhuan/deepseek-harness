import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CREATIVE_ROLE_NAMES = [
  'chapter-extractor',
  'character-designer',
  'consistency-checker',
  'narrative-writer',
  'story-architect',
  'story-explorer',
  'story-researcher',
] as const

export type CreativeRoleName = typeof CREATIVE_ROLE_NAMES[number]
export type CreativeRoleExecution = 'tool-free' | 'native-tools'

function roleBody(source: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(source)
  return source.slice(frontmatter?.[0].length ?? 0).trim()
}

export function defaultBundledRoleRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge/creative/roles')
}

export async function loadBundledRole(
  name: CreativeRoleName,
  roleRoot = defaultBundledRoleRoot(),
  execution: CreativeRoleExecution = 'tool-free',
): Promise<string> {
  const body = roleBody(await readFile(join(resolve(roleRoot), `${name}.md`), 'utf8'))
  if (body.length === 0) throw new Error(`Bundled role "${name}" is empty.`)
  const integration = execution === 'tool-free'
    ? [
      'You are running inside an Creative review-required DSH collaboration. The caller supplies every permitted input in the prompt.',
      'Do not read or write project files, do not call tools, and do not follow legacy .claude/.codex path or deployment instructions in the upstream role text.',
      'Return only the output contract requested by the caller; never claim to have changed the project.',
    ]
    : [
      'You are running as a native creative-dsh specialist. The current DSH workspace and visible tool set are your complete authority boundary.',
      'Never inspect or require legacy .claude/.opencode/.codex agent deployment files; this exact pinned Role is already active.',
      'Bundled story-setup references are pinned plugin resources, not project files or project Skills. When the upstream Role marks one mandatory, call creative_bundled_reference with the exact story-setup/references/agent-references path, then use only the returned content.',
      'If creative_bundled_reference or a required bundled reference is unavailable, report the missing reference to the caller. Never call the generic skill tool, fall back to a legacy platform path, or claim that an unread reference was used.',
      'Use only the tools actually visible to you. Mutate files only when the caller explicitly requests it and your visible DSH tools permit it; otherwise return findings to the caller.',
    ]
  return [
    `CREATIVE_DSH_ROLE:${name}`,
    ...integration,
    '',
    body,
  ].join('\n')
}
