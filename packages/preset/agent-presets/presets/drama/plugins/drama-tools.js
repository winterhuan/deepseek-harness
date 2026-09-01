/**
 * Preset-relative plugin for the `drama` agent preset: the short-drama project
 * scaffold tool, the board state tools, and the per-episode tracking/transaction
 * tools.
 *
 * Zero npm imports by design — the file loads from the preset directory, where
 * no node_modules exists, so every Node builtin arrives through
 * `process.getBuiltinModule` and the only services are the injected `tools`
 * registry and the `ctx.fs` backend.
 *
 * Paths resolve against the calling agent's session workspace
 * (`exec.agent?.session.header.cwd`, mirroring `dsh-tool-fs/session-cwd.ts`),
 * never `process.cwd()`. File operations go through `ctx.fs`, so a sandboxed
 * backend keeps enforcing its policy; every `.drama/board.json` mutation is
 * version-guarded so a stale concurrent update fails instead of clobbering.
 *
 * The tracking protocol mirrors the `novelist` preset: a single authoritative
 * board, transactional per-episode commits with a state-revision check, and
 * tool-owned derived views under `.drama/` that are regenerated from the board —
 * hand edits to those views are repairable through `drama_board` `check`, never
 * authoritative. The short-drama browser workbench is a separate read-only
 * projection (see `dsh-client-ui-drama`); this plugin owns no media-facing
 * production authority. Media production follows the four-step hard gate in the
 * `short-drama-produce` skill.
 * @module drama-plugins/drama-tools
 */

const BOARD_FILE = '.drama/board.json'
const MEMORY_FILE = '.drama/author-memory.json'
const EPISODES_DIR = '剧集'
const BOARD_FORMAT_VERSION = 1
const EPISODE_STAGES = ['develop', 'screenplay', 'assets', 'storyboard', 'image-prompts', 'video-prompts', 'produce', 'review']
const CREATOR_DOCUMENTS = {
  '剧本.md': 'screenplay',
  '视觉设定.md': 'assets',
  '分镜.md': 'storyboard',
  '图片提示词.md': 'image-prompts',
  '视频提示词.md': 'video-prompts',
}
const MAX_CONTEXT_ENTRIES = 12

/** TextContent-style block the registry materializes for the model. */
function textBlock(value) {
  return [{ type: 'text', text: value }]
}

/** String list narrowing: keep non-empty strings, drop everything else. */
function stringList(value) {
  return Array.isArray(value) ? value.filter(entry => typeof entry === 'string' && entry.length > 0) : []
}

/**
 * The session workspace cwd for this call.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the absolute session cwd.
 */
function requireSessionCwd(exec) {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) {
    throw new Error('drama tools require a session workspace, but this execution carries no session cwd')
  }
  return cwd
}

/** Shape a parsed board document into the canonical in-memory form. */
function normalizeBoard(parsed) {
  const board = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const episodes = board.episodes !== null && typeof board.episodes === 'object' && !Array.isArray(board.episodes)
    ? board.episodes
    : {}
  const assets = board.assets !== null && typeof board.assets === 'object' && !Array.isArray(board.assets)
    ? board.assets
    : {}
  return {
    formatVersion: BOARD_FORMAT_VERSION,
    stateRevision: typeof board.stateRevision === 'number' ? board.stateRevision : 0,
    projectTitle: typeof board.projectTitle === 'string' ? board.projectTitle : undefined,
    productionForm: typeof board.productionForm === 'string' ? board.productionForm : undefined,
    lookDirection: typeof board.lookDirection === 'string' ? board.lookDirection : undefined,
    episodes: Object.fromEntries(Object.entries(episodes).map(([dir, entry]) => [dir, {
      title: typeof entry?.title === 'string' ? entry.title : undefined,
      stage: EPISODE_STAGES.includes(entry?.stage) ? entry.stage : 'develop',
      summary: typeof entry?.summary === 'string' ? entry.summary : '',
      positions: stringList(entry?.positions),
      commitments: stringList(entry?.commitments),
      pendingProduction: stringList(entry?.pendingProduction),
      updatedIn: typeof entry?.updatedIn === 'number' ? entry.updatedIn : undefined,
    }])),
    // Flag/ledger maps keep identity stable across episodes: a person/location/prop
    // stays the same asset until the creator re-identifies it.
    assets: Object.fromEntries(Object.entries(assets).map(([id, entry]) => [id, {
      id: typeof entry?.id === 'string' ? entry.id : id,
      kind: ['character', 'scene', 'prop', 'state'].includes(entry?.kind) ? entry.kind : 'character',
      name: typeof entry?.name === 'string' ? entry.name : '',
      anchor: typeof entry?.anchor === 'string' ? entry.anchor : '',
      variants: stringList(entry?.variants),
      firstSeenIn: typeof entry?.firstSeenIn === 'string' ? entry.firstSeenIn : undefined,
      updatedIn: typeof entry?.updatedIn === 'string' ? entry.updatedIn : undefined,
    }])),
  }
}

/** Episode directory from `剧集/EP001` form, or undefined when not canonical. */
function normalizeEpisodeId(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replaceAll('\\', '/').replace(/\/$/u, '')
  return /^剧集\/EP\d{3,}$/u.test(cleaned) ? cleaned : undefined
}

/** Read the board, returning the empty canonical form when absent. */
async function readBoard(fs, cwd) {
  const target = await fs.resolve(BOARD_FILE, { cwd })
  if (await fs.stat(target) === undefined) {
    return { board: normalizeBoard(null), version: undefined }
  }
  const version = (await fs.stat(target)).version
  return { board: normalizeBoard(JSON.parse(await fs.readText(target))), version }
}

/** Write the board with a version guard; surface stale-version collisions. */
async function writeBoard(fs, cwd, board, version) {
  const target = await fs.resolve(BOARD_FILE, { cwd })
  try {
    await fs.writeText(target, `${JSON.stringify(board, null, 2)}\n`, version !== undefined
      ? { kind: 'replaceIfVersion', version }
      : { kind: 'createIfAbsent' })
  } catch (error) {
    if (error?.code === 'FS_STALE_VERSION') {
      throw new Error('短剧状态板已被其他修改更新过（FS_STALE_VERSION）——先 drama_board 重新读取再重试')
    }
    throw error
  }
}

/** List episode workspace directories under `剧集/`, sorted deterministically. */
async function scanEpisodes(fs, cwd) {
  const dir = await fs.resolve(EPISODES_DIR, { cwd })
  if (await fs.stat(dir) === undefined) return []
  const names = await fs.listDir(dir)
  return names
    .map(entry => typeof entry === 'string' ? entry : entry.name)
    .map(name => name.replace(/\/+$/, ''))
    .filter(name => /^EP\d{3,}$/u.test(name))
    .sort()
    .map(name => `剧集/${name}`)
}

/** Which creator documents exist for one episode directory, ordered. */
async function scanEpisodeDocuments(fs, cwd, episodeDirectory) {
  const dir = await fs.resolve(episodeDirectory, { cwd })
  if (await fs.stat(dir) === undefined) return []
  const names = await fs.listDir(dir)
  const present = new Set(names.map(entry => typeof entry === 'string' ? entry : entry.name))
  return Object.keys(CREATOR_DOCUMENTS)
    .filter(name => present.has(name))
    .sort()
}

/** A per-episode read row: which creator documents exist and the stage. */
async function episodeReadRow(fs, cwd, board, dir) {
  const entry = board.episodes[dir]
  const documents = await scanEpisodeDocuments(fs, cwd, dir)
  return {
    episode: dir,
    title: entry?.title,
    stage: entry?.stage ?? 'develop',
    documents,
    positions: entry?.positions ?? [],
    commitments: entry?.commitments ?? [],
    pendingProduction: entry?.pendingProduction ?? [],
  }
}

function scaffoldTool(fs) {
  return {
    name: 'drama_scaffold',
    description: '为短剧/漫剧项目创建 .drama 状态板与《项目开发.md》分集规划模板。只创建不存在的文件，绝不覆盖；不预建任何创作文档（五份 Markdown 在有创作需求时才按集创建）。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '项目标题（可后补）' },
        productionForm: { type: 'string', description: '制作形态，如实拍 / 二维 / 三维 / 水墨 / Q 版 / 国漫' },
      },
      required: [],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => textBlock(value),
    },
    async execute(args, exec) {
      const cwd = requireSessionCwd(exec)
      const { board } = await readBoard(fs, cwd)
      if (typeof args.title === 'string' && args.title.trim() !== '') board.projectTitle = args.title.trim()
      if (typeof args.productionForm === 'string' && args.productionForm.trim() !== '') board.productionForm = args.productionForm.trim()
      const created = []
      const existing = []
      const boardTarget = await fs.resolve(BOARD_FILE, { cwd })
      if (await fs.stat(boardTarget) === undefined) {
        await fs.writeText(boardTarget, `${JSON.stringify(board, null, 2)}\n`)
        created.push('- .drama/board.json — 项目状态板（drama_board / drama_track 维护）')
      } else {
        existing.push('.drama/board.json')
      }
      const episodesTarget = await fs.resolve(EPISODES_DIR, { cwd })
      if (await fs.stat(episodesTarget) === undefined) {
        await fs.makeDir(episodesTarget, { cwd })
        created.push('- 剧集/ — 分集目录（按需写入创作文档，不预建）')
      } else {
        existing.push('剧集/')
      }
      if (created.length === 0) {
        return '短剧项目骨架已完整，未做改动。用 drama_board 恢复项目上下文。'
      }
      return [
        '短剧项目骨架已就绪：',
        ...created,
        ...existing.length > 0 ? [`已存在、保持不动：${existing.join('、')}`] : [],
        '下一步：与创作者确认题材、结局与尺度，然后进入 short-drama-develop（立开发契约）或按需直接写作单集。不预建空创作文档。',
      ].join('\n')
    },
  }
}

function boardReadTool(fs) {
  return {
    name: 'drama_board',
    description: '读取短剧项目状态板：项目标题、制作形态/视觉方向、每集阶段与已有创作文档、人物/场景/道具台账与跨集连续、待确认生产。进入已有项目或每阶段动笔前先调用它。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    async execute(_args, exec) {
      const cwd = requireSessionCwd(exec)
      const { board } = await readBoard(fs, cwd)
      const dirs = await scanEpisodes(fs, cwd)
      const episodes = []
      for (const dir of dirs) {
        episodes.push(await episodeReadRow(fs, cwd, board, dir))
      }
      return {
        formatVersion: board.formatVersion,
        stateRevision: board.stateRevision,
        projectTitle: board.projectTitle,
        productionForm: board.productionForm,
        lookDirection: board.lookDirection,
        episodeDirectories: dirs,
        episodes,
        assets: Object.values(board.assets),
        summary: {
          episodeCount: episodes.length,
          characterCount: Object.values(board.assets).filter(asset => asset.kind === 'character').length,
          sceneCount: Object.values(board.assets).filter(asset => asset.kind === 'scene').length,
          pendingProductionCount: episodes.reduce((sum, row) => sum + row.pendingProduction.length, 0),
          continuityRisks: episodes.flatMap(row => row.positions),
        },
      }
    },
  }
}

function boardUpdateTool(fs) {
  return {
    name: 'drama_episode',
    description: '登记/更新一集短剧的状态与连续性：阶段（develop/screenplay/assets/storyboard/image-prompts/video-prompts/produce/review）、一句话摘要、关键位置/承诺、待确认生产。只写状态板；真创作仍写五个 Markdown 文档。',
    parameters: {
      type: 'object',
      properties: {
        episode: { type: 'string', description: '剧集目录，如 剧集/EP001' },
        title: { type: 'string', description: '集名' },
        stage: { type: 'string', enum: EPISODE_STAGES, description: '当前创作阶段' },
        summary: { type: 'string', description: '本集一句话目标/进展' },
        positions: { type: 'array', items: { type: 'string' }, description: '贯穿的跨集赋值（谁在何处/状态）' },
        commitments: { type: 'array', items: { type: 'string' }, description: '本集向后续集作出的承诺（钩子/伏笔）' },
        pendingProduction: { type: 'array', items: { type: 'string' }, description: '待确认/执行的生产目标（如 SHOT-001 关键帧）' },
      },
      required: ['episode'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    async execute(args, exec) {
      const cwd = requireSessionCwd(exec)
      const dir = normalizeEpisodeId(args.episode)
      if (dir === undefined) throw new Error('drama_episode 的 episode 必须是 剧集/EP001 形式')
      const { board, version } = await readBoard(fs, cwd)
      // Ensure the episode directory exists so the docs have a home.
      const target = await fs.resolve(dir, { cwd })
      if (await fs.stat(target) === undefined) await fs.makeDir(target, { cwd })
      if (board.episodes[dir] === undefined) board.episodes[dir] = { stage: 'develop' }
      const entry = board.episodes[dir]
      if (typeof args.title === 'string' && args.title.trim() !== '') entry.title = args.title.trim()
      if (EPISODE_STAGES.includes(args.stage)) entry.stage = args.stage
      if (typeof args.summary === 'string' && args.summary.trim() !== '') entry.summary = args.summary.trim()
      if (args.positions !== undefined) entry.positions = stringList(args.positions)
      if (args.commitments !== undefined) entry.commitments = stringList(args.commitments)
      if (args.pendingProduction !== undefined) entry.pendingProduction = stringList(args.pendingProduction)
      board.stateRevision += 1
      entry.updatedIn = board.stateRevision
      await writeBoard(fs, cwd, board, version)
      const row = await episodeReadRow(fs, cwd, board, dir)
      return { message: `已更新 ${dir}：${row.title ?? '未命名'}（阶段：${row.stage}）`, episode: row }
    },
  }
}

function trackingTool(fs) {
  return {
    name: 'drama_track',
    description: '短剧追踪事务：把一集登记/阶段更新 + 人物/地点/道具台账变更一并提交，并把派生视图（剧集/规划.md、.drama/连续性.md）整份重建。check 模式只核对派生视图与板的差异，不写盘。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['commit', 'check'], description: 'commit 提交一集变更；check 比对派生视图' },
        episode: { type: 'string', description: '剧集目录，如 剧集/EP001（commit 必填）' },
        stage: { type: 'string', enum: EPISODE_STAGES, description: '本集当前阶段' },
        summary: { type: 'string', description: '一句目标/进展' },
        registerAsset: { type: 'object', description: '登记一人/地/物：{ id?, kind, name, anchor?, variants?: string[] }' },
      },
      required: ['mode'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    async execute(args, exec) {
      const cwd = requireSessionCwd(exec)
      const { board, version } = await readBoard(fs, cwd)
      if (args.mode === 'check') {
        const diffs = await diffViews(fs, cwd, board)
        return { mode: 'check', stateRevision: board.stateRevision, viewsToRewrite: diffs }
      }
      const dir = normalizeEpisodeId(args.episode)
      if (dir === undefined) throw new Error('drama_track commit 需要 episode（剧集/EP001 形式）')
      if (board.episodes[dir] === undefined) board.episodes[dir] = { stage: 'develop' }
      const entry = board.episodes[dir]
      const episodeTarget = await fs.resolve(dir, { cwd })
      if (await fs.stat(episodeTarget) === undefined) await fs.makeDir(episodeTarget, { cwd })
      if (EPISODE_STAGES.includes(args.stage)) entry.stage = args.stage
      if (typeof args.summary === 'string' && args.summary.trim() !== '') entry.summary = args.summary.trim()
      if (args.registerAsset !== undefined && args.registerAsset !== null) {
        registerLedgerEntry(board, args.registerAsset, dir)
      }
      board.stateRevision += 1
      entry.updatedIn = board.stateRevision
      await writeBoard(fs, cwd, board, version)
      const changed = await writeDerived(fs, cwd, board)
      return {
        mode: 'commit',
        message: `已提交 ${dir}（阶段：${entry.stage}）`,
        stateRevision: board.stateRevision,
        registeredAssets: Object.values(board.assets).filter(asset => asset.firstSeenIn === dir).map(asset => asset.id),
        derived: changed,
      }
    },
  }
}

/** Register or update one asset in the ledger, keeping identity stable. */
function registerLedgerEntry(board, input, episodeDir) {
  if (typeof input?.name !== 'string' || input.name.trim() === '') {
    throw new Error('drama_track registerAsset 需要 name（资产名）')
  }
  const kind = ['character', 'scene', 'prop', 'state'].includes(input.kind) ? input.kind : 'character'
  let id = input.id
  if (typeof id === 'string' && id.trim() !== '') {
    id = id.trim()
    if (board.assets[id] === undefined) {
      board.assets[id] = { id, kind, name: input.name.trim(), anchor: '', variants: [], firstSeenIn: episodeDir }
    }
  } else {
    id = `${kind.toUpperCase()}-${String(Object.keys(board.assets).length + 1).padStart(3, '0')}`
    board.assets[id] = { id, kind, name: input.name.trim(), anchor: '', variants: [], firstSeenIn: episodeDir }
  }
  const asset = board.assets[id]
  asset.kind = kind
  asset.name = input.name.trim()
  if (typeof input.anchor === 'string' && input.anchor.trim() !== '') asset.anchor = input.anchor.trim()
  if (Array.isArray(input.variants)) asset.variants = stringList(input.variants)
  asset.updatedIn = episodeDir
}

/** Derived-view paths (tool-owned, regenerated, never hand-edited truth). */
const PLAN_FILE = '剧集/规划.md'
const CONTINUITY_FILE = '.drama/连续性.md'

/** Render the two derived views from the board truth. */
async function renderDerived(fs, cwd, board) {
  const episodes = await scanEpisodes(fs, cwd)
  const planLines = ['# 分集规划（派生）', '', `> 状态修订 ${board.stateRevision}。由 .drama/board.json 生成，不要手改。`, '']
  for (const dir of episodes) {
    const row = await episodeReadRow(fs, cwd, board, dir)
    const pending = (board.episodes[dir]?.pendingProduction ?? []).length > 0
      ? ' · 待生产：' + board.episodes[dir].pendingProduction.join('、')
      : ''
    planLines.push(`- [${row.stage === 'review' ? 'x' : ' '}] ${dir} — ${row.title ?? '未命名'}（${row.stage}）${row.documents.map(d => ` ${d}`).join('')}${pending}`)
  }
  const planText = `${planLines.join('\n')}\n`
  const continuityLines = ['# 连续台账（派生）', '', '人物 / 地点 / 道具（.drama/board.json 生成，工具重写时以板为准）：', '']
  for (const asset of Object.values(board.assets)) {
    const anchor = asset.anchor !== '' ? `（锚：${asset.anchor}）` : ''
    const first = asset.firstSeenIn ? ` · 首见于 ${asset.firstSeenIn}` : ''
    const variants = asset.variants.length > 0 ? ` · 变体：${asset.variants.join('、')}` : ''
    continuityLines.push(`- ${asset.kind} ${asset.name}${anchor}${first}${variants}`)
  }
  const continuityText = `${continuityLines.join('\n')}\n`
  return [{ path: PLAN_FILE, text: planText }, { path: CONTINUITY_FILE, text: continuityText }]
}

/** Current derived file text if present, else undefined. */
async function currentFileText(fs, cwd, path) {
  const target = await fs.resolve(path, { cwd })
  return await fs.stat(target) === undefined ? undefined : await fs.readText(target)
}

/** Which derived views differ from the board truth (check mode). */
async function diffViews(fs, cwd, board) {
  const rendered = await renderDerived(fs, cwd, board)
  const out = []
  for (const item of rendered) {
    const current = await currentFileText(fs, cwd, item.path)
    if (current !== item.text) out.push({ path: item.path, stale: current !== null })
  }
  return out
}

/** Rewrite every derived view that differs from the board truth. */
async function writeDerived(fs, cwd, board) {
  const rendered = await renderDerived(fs, cwd, board)
  const changed = []
  for (const item of rendered) {
    const target = await derivedFileTarget(fs, cwd, item.path)
    if (await fs.stat(target) === undefined) {
      await fs.writeText(target, item.text)
      changed.push(item.path)
    } else {
      const current = await fs.readText(target)
      if (current !== item.text) {
        await fs.writeText(target, item.text)
        changed.push(item.path)
      }
    }
  }
  return changed
}

/** Resolve one derived target, creating its parent directory if missing. */
async function derivedFileTarget(fs, cwd, path) {
  const dir = path.split('/').slice(0, -1).join('/')
  if (dir !== '') {
    const dirTarget = await fs.resolve(dir, { cwd })
    if (await fs.stat(dirTarget) === undefined) await fs.makeDir(dirTarget, { cwd })
  }
  return fs.resolve(path, { cwd })
}

function memoryTool(fs) {
  return {
    name: 'drama_memory',
    description: '记录创作者明确声明的长期创作习惯/纪律（拿到回执才算记住），供之后写作/生产时取回。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['record', 'forget', 'query'], description: '执行的操作' },
        statement: { type: 'string', description: '要记住或忘掉的创作习惯（record/forget 用）' },
      },
      required: ['action'],
    },
    output: { schema: { type: 'object' }, render: (_args, value) => textBlock(JSON.stringify(value, null, 2)) },
    async execute(args, exec) {
      const cwd = requireSessionCwd(exec)
      const target = await fs.resolve(MEMORY_FILE, { cwd })
      const stat = await fs.stat(target)
      const state = stat === undefined
        ? { entries: [] }
        : { entries: Array.isArray(JSON.parse(await fs.readText(target)).entries) ? JSON.parse(await fs.readText(target)).entries : [] }
      if (args.action === 'record') {
        const statements = args.statement.split('\n').map(line => line.trim()).filter(Boolean)
        const added = []
        for (const statement of statements) {
          if (state.entries.some(e => e.statement === statement)) continue
          state.entries.push({ id: `M${String(state.entries.length + 1).padStart(2, '0')}`, statement })
          added.push(statement)
        }
        await commitMemory(fs, cwd, state, target, stat?.version)
        return { receipt: 'Author Memory Receipt', added, total: state.entries.length, message: added.length > 0 ? `已记住 ${added.length} 条创作纪律。` : '无新纪律（均已记住）。' }
      }
      if (args.action === 'forget') {
        const entry = state.entries.find(e => e.id === args.statement || e.statement === args.statement)
        if (entry === undefined) return { ok: false, message: `未找到 "${args.statement}"` }
        state.entries = state.entries.filter(e => e.id !== entry.id)
        await commitMemory(fs, cwd, state, target, stat?.version)
        return { ok: true, message: `已忘掉 ${entry.id}：${entry.statement}` }
      }
      return { ok: true, message: '此前记录的创作纪律：', entries: state.entries }
    },
  }
}

/** Unused helper removed to keep surface minimal. */
async function commitMemory(fs, cwd, state, target, version) {
  try {
    await fs.writeText(target, `${JSON.stringify(state, null, 2)}\n`, version !== undefined
      ? { kind: 'replaceIfVersion', version }
      : { kind: 'createIfAbsent' })
  } catch (error) {
    if (error?.code === 'FS_STALE_VERSION') {
      throw new Error('作者记忆已被其他修改更新过（FS_STALE_VERSION）——重试一次即可')
    }
    throw error
  }
}

export const name = 'drama-tools'

export const inject = ['tools', 'fs']

/**
 * Register the drama tools into this preset's scoped tools layer.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const tools = ctx.tools
  if (tools === undefined) {
    throw new Error('drama-tools: the tools registry is required')
  }
  const fs = ctx.fs
  ctx.effect(() => {
    const definitions = [
      scaffoldTool(fs),
      boardReadTool(fs),
      boardUpdateTool(fs),
      trackingTool(fs),
      memoryTool(fs),
    ]
    const disposers = definitions.map(definition => tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'drama-tools: scaffold / board / episode / track / memory')
}
