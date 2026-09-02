import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  bundledReferenceGuard,
  createCreativeReferenceTool,
  CREATIVE_REFERENCE_TOOL_NAME,
} from './reference-tool.js'
import { CREATIVE_ROLE_NAMES, loadBundledRole, type CreativeRoleName } from './role-provider.js'

export const CREATIVE_ROLE_TOOL_NAME = 'creative_role'
export type CreativeRoleSubagents = Pick<SubagentRuntime, 'start'>

const roleTools: Readonly<Record<CreativeRoleName, readonly string[]>> = {
  'chapter-extractor': ['read', 'glob', 'grep'],
  'character-designer': [CREATIVE_REFERENCE_TOOL_NAME, 'read', 'glob', 'grep', 'write', 'edit'],
  'consistency-checker': [CREATIVE_REFERENCE_TOOL_NAME, 'read', 'glob', 'grep'],
  'narrative-writer': [CREATIVE_REFERENCE_TOOL_NAME, 'read', 'glob', 'grep', 'write', 'edit', 'bash'],
  'story-architect': [CREATIVE_REFERENCE_TOOL_NAME, 'read', 'glob', 'grep', 'write', 'edit'],
  'story-explorer': ['read', 'glob', 'grep'],
  'story-researcher': ['read', 'glob', 'grep', 'bash', 'write', 'web_search', 'web_fetch'],
}

export function roleToolFilter(role: CreativeRoleName): { readonly allow: readonly string[] } {
  return { allow: roleTools[role] }
}

function resultText(output: readonly ContentBlock[]): string {
  return output.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('\n')
}

export async function createCreativeRoleTool(subagents?: CreativeRoleSubagents): Promise<ToolDefinition> {
  const personas = new Map<CreativeRoleName, string>()
  await Promise.all(CREATIVE_ROLE_NAMES.map(async (role) => {
    personas.set(role, await loadBundledRole(role, undefined, 'native-tools'))
  }))
  return defineTool({
    name: CREATIVE_ROLE_TOOL_NAME,
    description: 'Run one focused Creative specialist as a child of the current DSH Agent. The child inherits DSH model, workspace, permissions, lifecycle, and UI.',
    parameters: {
      role: {
        type: 'string',
        required: true,
        enum: CREATIVE_ROLE_NAMES,
        description: 'The exact Creative Role to run.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'A self-contained task. The child inherits the current DSH workspace but not the current in-flight turn.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', required: true, enum: CREATIVE_ROLE_NAMES },
          runId: { type: 'string', required: true },
          content: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: resultText(value.content as unknown as ContentBlock[]) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('creative_role requires a calling DSH Agent.')
      const persona = personas.get(args.role)
      if (persona === undefined) throw new Error(`Creative Role ${args.role} is not bundled.`)
      const allowed = roleToolFilter(args.role).allow.filter(name =>
        exec.agent?.ctx.tools.get(name, exec.agent) !== undefined)
      const runtime = subagents ?? exec.agent.ctx.get('subagents')
      if (runtime === undefined) throw new Error('creative_role requires the DSH subagent runtime.')
      const run = await runtime.start('spawn', {
        label: `creative:${args.role}`,
        prompt: [{ type: 'text', text: args.prompt }],
        parent: exec.agent,
        persona,
        toolFilter: { allow: allowed },
        maxDepth: 1,
        signal: exec.signal,
      })
      try {
        const result = await run.result
        if (result.stopReason !== 'completed') {
          throw new Error(`Creative Role ${args.role} ended with ${result.stopReason}${result.diagnostic === undefined ? '' : `: ${result.diagnostic}`}`)
        }
        return {
          role: args.role,
          runId: run.id,
          content: result.output as unknown as JsonValue[],
        }
      } finally {
        await run.dispose()
      }
    },
  })
}

export async function registerCreativeRoleTool(context: Context): Promise<void> {
  const [definition, referenceDefinition] = await Promise.all([
    createCreativeRoleTool(context.subagents),
    createCreativeReferenceTool(),
  ])
  context.tools.register(referenceDefinition)
  context.tools.guard(bundledReferenceGuard(referenceDefinition, context.tools))
  let dispose: (() => void) | undefined
  const mount = (): void => { dispose ??= context.tools.register(definition) }
  const unmount = (): void => { dispose?.(); dispose = undefined }
  context.on('subagent/provider-added', (provider) => { if (provider.name === 'spawn') mount() })
  context.on('subagent/provider-removed', (name) => { if (name === 'spawn') unmount() })
  if (context.subagents.getProvider('spawn') !== undefined) mount()
}
