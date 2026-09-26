import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The seven upstream Creative Roles bundled with the plugin, in load order. */
export const CREATIVE_ROLE_NAMES = [
  'chapter-extractor',
  'character-designer',
  'consistency-checker',
  'narrative-writer',
  'story-architect',
  'story-explorer',
  'story-researcher',
] as const

/** One bundled {@link CREATIVE_ROLE_NAMES} role. */
export type CreativeRoleName = typeof CREATIVE_ROLE_NAMES[number]
/** How the role persona is scoped: no tools at all, or the caller's native DSH tools. */
export type CreativeRoleExecution = 'tool-free' | 'native-tools'

function roleBody(source: string): string {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/u.exec(source)
  return source.slice(frontmatter?.[0].length ?? 0).trim()
}

/**
 * The packaged directory holding the bundled role markdown files.
 * @returns the default role root derived from this module's location.
 */
export function defaultBundledRoleRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../knowledge/creative/roles')
}

/**
 * Load one bundled role as a DSH persona: upstream frontmatter stripped, an
 * execution-scoped DSH integration preamble prepended, and the first line
 * marked `CREATIVE_DSH_ROLE:<name>`.
 * @param name - the bundled role to load.
 * @param roleRoot - directory holding the role markdown files.
 * @param execution - whether the persona runs tool-free or with native tools.
 * @returns the full persona prompt handed to the subagent.
 * @throws Error when the role file is missing or its body is empty.
 */
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
