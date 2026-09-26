import type { DramaEpisodeProduction } from './drama-production.js'
import type { ProductionRequest, ProductionMediaVersion } from './production-runtime.js'

const authorityBoundary = '只使用当前 DSH Preset 可见的工具；所有文件、网络、生成和命令操作继续遵守 DSH 权限与审批。'

function productionContext(request: ProductionRequest): string {
  return JSON.stringify({
    requestId: request.id, episode: request.episode, targetId: request.targetId,
    kind: request.kind, expectedOutputs: request.expectedOutputs,
  })
}

/**
 * The chat prompt that prepares one confirmed production task through the
 * `/short-drama-produce` skill without running a Provider.
 * @param production - the parsed episode projection the job belongs to.
 * @param job - the prepared job awaiting creator confirmation.
 * @param references - the resolved reference media versions to hand the skill.
 * @returns the prompt sent through the conversation.
 */
export function nativeProductionPrompt(
  production: DramaEpisodeProduction,
  job: ProductionRequest,
  references: readonly ProductionMediaVersion[],
): string {
  // Prompt-protocol text (zh-first), not UI copy; the name avoids the copy-helper heuristic.
  const referenceLines = references.length === 0
    ? '无'
    : references.map(item => `${item.targetId}: ${item.path ?? item.url}`).join('\n')
  return `/short-drama-produce

只准备当前单项生产任务，不运行 Provider。
- 生产请求 ID：${job.id}
- 任务类型：${job.kind === 'image' ? '图片/关键帧' : '镜头视频'}
- 建议 adapter 契约：${job.kind === 'image' ? 'gpt-image-2' : 'seedance'}（实际配置与模型以当前 DSH 运行环境为准）
- 投产对象：${job.targetId}
- 创作文档目录：${production.episodeDirectory}
- 参考素材：
${referenceLines}
- 输出目录：${production.episodeDirectory}/制作成果/${job.targetId}
- 输出文件名包含投产对象 ID；文件出现不代表作业成功。

待预检提示词：
${job.prompt}

按 short-drama-produce 的硬闸门建立临时 job 并执行 prepare，在 Chat 中完整展示 adapter、模型/profile、数量、参数、references、outputs 与 overwrite。此按钮只表达“准备预览”，不构成看到预览后的生产确认；不得 confirm 或 run。用户在后续消息明确确认这份预览后，先对该 job 执行 confirm，再使用 creative_produce_run 执行，传入 prepare 返回的 job_id、已确认 adapter 和项目 workdir，明确设置 run_in_background: true 和 production: ${productionContext(job)}；不得通过 stdin 替换已确认规格。返回的实际 JobId 才是执行作业，不得用生产请求 ID 冒充 JobId。${authorityBoundary}`
}

/**
 * The chat prompt that prepares one batch production task; per-item prompts
 * ride as headings so the skill can enumerate outputs and cost boundaries.
 * @param production - the parsed episode projection the job belongs to.
 * @param job - the prepared batch job awaiting creator confirmation.
 * @param candidates - one prompt per output item, keyed by target id.
 * @returns the prompt sent through the conversation.
 */
export function nativeBatchPrompt(
  production: DramaEpisodeProduction,
  job: ProductionRequest,
  candidates: readonly { readonly id: string; readonly prompt: string }[],
): string {
  return `/short-drama-produce

只准备当前批量生产任务，不运行 Provider。
- 批次生产请求 ID：${job.id}
- 任务类型：${job.kind === 'image' ? '批量关键帧' : '批量镜头视频'}
- 建议 adapter 契约：${job.kind === 'image' ? 'gpt-image-2' : 'seedance'}（实际配置与模型以当前 DSH 运行环境为准）
- 创作文档目录：${production.episodeDirectory}
- 输出根目录：${production.episodeDirectory}/制作成果
- 每个输出文件名包含对应镜头 ID；文件出现不代表作业成功。

${candidates.map(item => `## ${item.id}\n${item.prompt}`).join('\n\n')}

把数量、逐项输出和成本边界完整展示给创作者。此按钮只表达“准备预览”，不构成看到预览后的生产确认；不得 confirm 或 run。用户在后续消息明确确认这份预览后，对各自准备好的 job 执行 confirm。每次 creative_produce_run 传入对应的 job_id、已确认 adapter 和项目 workdir，必须设置 run_in_background: true，携带 production: ${productionContext(job)}；不得通过 stdin 替换已确认规格。逐项执行时把 targetId 改为该项镜头 ID，保持同一个 requestId。每次返回独立的实际 JobId，计划产量不作为作业进度。${authorityBoundary}`
}

/**
 * The chat prompt that executes an explicitly confirmed final composition in
 * the fixed creator-approved order.
 * @param production - the parsed episode projection the job belongs to.
 * @param job - the confirmed composition job.
 * @param orderedPaths - the segment media paths in composition order.
 * @returns the prompt sent through the conversation.
 */
export function nativeCompositionPrompt(
  production: DramaEpisodeProduction,
  job: ProductionRequest,
  orderedPaths: readonly string[],
): string {
  return `/short-drama-produce

执行创作者已明确确认的成片合成任务。
- 生产请求 ID：${job.id}
- 剧集：${production.episodeDirectory}
- 按以下顺序合成，不得自行换序：
${orderedPaths.map((path, index) => `${String(index + 1)}. ${path}`).join('\n')}
- 输出：${production.episodeDirectory}/制作成果/成片-${job.id}.mp4

先验证输入均存在且可读，再使用当前 DSH Preset 可见的命令工具启动后台合成。获得实际 JobId 后才调用 creative_production：action 为 track_job，requestId 为 ${job.id}，episode 为 ${production.episodeDirectory}，targetId 为 ${job.targetId}，jobKind 为 composition，jobId 为刚返回的实际 JobId。音视频参数不兼容时做明确、可审计的标准化。进程结束不等于素材验证成功；所有命令和写入继续遵守 DSH 权限与审批，不得伪造成功。`
}
