/** Incremental projection of existing native and PTC results into production requests. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ConversationNodeContext, ConversationNodeDefinition, ConversationViewDefinition,
  ConversationViewNode, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-tools/types'
import { CREATIVE_PRODUCTION_TOOL_NAME } from '../production-intent.ts'
import { settledProductionIntent, type SettledProductionIntent } from './production-intents.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /**
     * Successful production requests and real job bindings in durable Session
     * order; each entry carries its own result sequence so consumers apply a
     * result once instead of tracking every consumed call id.
     */
    'creative-production': readonly SettledProductionIntent[]
  }
}

interface ProductionNode extends ConversationViewNode {
  readonly data: { readonly intent: SettledProductionIntent }
}

function decode(event: SessionEventLike, call: ToolResultNode['call'] = null, callTime: number | null = null): SettledProductionIntent | undefined {
  let result: ToolResultNode
  if (event.type === 'tool/result') {
    const content = event.data.message.content[0]
    result = {
      kind: 'tool-result', seq: event.seq, time: event.time,
      callId: String(event.data.message.source.callId),
      call, callTime, content: content.content,
      isError: content.isError === true, meta: event.data.meta, subCalls: [],
    }
  } else if (event.type === 'tool/ptc-dispatch') {
    result = {
      kind: 'tool-result', seq: event.seq, time: event.time, callId: String(event.data.subCallId),
      call: { name: event.data.name, argsRaw: JSON.stringify(event.data.arguments) },
      callTime: null, content: event.data.content, isError: event.data.isError, subCalls: [],
    }
  } else return undefined
  return settledProductionIntent(result)
}

function node(context: ConversationNodeContext, intent: SettledProductionIntent): ProductionNode {
  return {
    key: context.key, kind: context.kind, id: context.id, target: 'creative-production',
    data: { intent },
  }
}

/** Self-contained native bindings and PTC intents restore without a loaded parent call. */
export const productionDefinition: ConversationNodeDefinition<{
  /** Session sequence of the decoded result; absent while no intent was published. */
  readonly intent: SettledProductionIntent | undefined
}> = {
  kind: 'creative-production-result',
  target: 'creative-production',
  match: (event) => {
    const intent = decode(event)
    return intent === undefined ? null : { id: intent.callId, role: 'start' }
  },
  start: (_context, match) => ({ intent: decode(match.event) }),
  update: context => context.state,
  buildViewNode: context => context.state?.intent === undefined ? null : node(context, context.state.intent),
}

interface NativeIntentState {
  readonly call: NonNullable<ToolResultNode['call']>
  readonly callTime: number
  readonly intent: SettledProductionIntent | undefined
}

/** Legacy and navigation intents need their original native arguments and successful result. */
export const productionCallDefinition: ConversationNodeDefinition<NativeIntentState> = {
  kind: 'creative-production-call',
  target: 'creative-production',
  match: (event) => {
    if (event.type === 'tool/call' && event.data.name === CREATIVE_PRODUCTION_TOOL_NAME) return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result') return { id: String(event.data.message.source.callId), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') throw new Error('production intent requires tool/call')
    return {
      call: { name: match.event.data.name, argsRaw: match.event.data.arguments },
      callTime: match.event.time, intent: undefined,
    }
  },
  update: (context, match) => {
    const intent = decode(match.event, context.state.call, context.state.callTime)
    return { ...context.state, intent: intent?.binding === undefined ? intent : undefined }
  },
  buildViewNode: context => context.state?.intent === undefined ? null : node(context, context.state.intent),
}

/** Production-only target; unrelated Conversation publications preserve snapshot identity. */
export const productionView: ConversationViewDefinition<ProductionNode, readonly SettledProductionIntent[]> = {
  target: 'creative-production',
  isActive: () => false,
  create: () => {
    const nodes = new Map<string, ProductionNode>()
    let current: readonly SettledProductionIntent[] = []
    const project = (): readonly SettledProductionIntent[] => {
      current = [...nodes.values()]
        .sort((left, right) => left.data.intent.seq - right.data.intent.seq)
        .map(node => node.data.intent)
      return current
    }
    return {
      empty: current,
      replace: (input) => {
        nodes.clear()
        for (const node of input.nodes) nodes.set(node.key, node)
        return project()
      },
      apply: (input) => {
        if (input.upserts.length === 0) return current
        for (const node of input.upserts) nodes.set(node.key, node)
        return project()
      },
    }
  },
}

/**
 * Register production projection for the plugin's lifetime.
 * @param context - Client context owning the Conversation contributions.
 */
export function registerProductionProjection(context: Context): void {
  context.uiConversation.events.register(productionDefinition)
  context.uiConversation.events.register(productionCallDefinition)
  context.uiConversation.views.register(productionView)
}
