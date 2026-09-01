/**
 * Preset-relative plugin for the `novelist` agent preset: the novel-project
 * scaffold tool, the board state tools, the tracking-protocol tools, and the
 * author-memory tool.
 *
 * Zero npm imports by design — the file loads from the preset directory, where
 * no node_modules exists, so every Node builtin arrives through
 * `process.getBuiltinModule` and the only services are the injected `tools`
 * registry and the `ctx.fs` backend.
 *
 * Paths resolve against the calling agent's session workspace
 * (`exec.agent?.session.header.cwd`, mirroring `dsh-tool-fs/session-cwd.ts`),
 * never `process.cwd()`. File operations go through `ctx.fs`, so a sandboxed
 * backend keeps enforcing its policy; every `.novel/board.json` mutation is
 * version-guarded so a stale concurrent update fails instead of clobbering.
 *
 * The tracking protocol (single authoritative state, transactional commits,
 * tool-owned derived views) is a JS port of the oh-story writing-toolchain
 * contract, adapted to this preset's directory layout: the board carries the
 * full semantic state, `novel_track` commits per-chapter transactions with a
 * revision check, and every Markdown view under `.novel/` is regenerated from
 * the state — hand edits to those views are repairable through `novel_track`
 * `check`, never authoritative.
 * @module novelist-plugins/novel-tools
 */

const BOARD_FILE = '.novel/board.json'
const MEMORY_FILE = '.story/author-memory.json'
const CHAPTERS_DIR = 'chapters'
const BOARD_FORMAT_VERSION = 2
const CHAPTER_STATUSES = ['draft', 'revised', 'final']
const FORESHADOW_STATUSES = ['已埋', '已推进', '已回收']
const IMPORTANCE_LEVELS = ['高', '中', '低']
const WORDCOUNT_METRIC = 'visible_chars_v1'
const WORDCOUNT_RESOLUTIONS = ['within_user_band', 'accepted_current_length']
const SNAPSHOT_TARGET_BYTES = 4096
const SNAPSHOT_HARD_BYTES = 8192
const MAX_ACTIVE_CHARACTERS = 6
const MAX_CONTEXT_LIST = 6
const MAX_ACTIVE_FORESHADOWS = 8
const MAX_RECENT_CHAPTERS = 3

/** TextContent-style block the registry materializes for the model. */
function textBlock(value) {
  return [{ type: 'text', text: value }]
}

/** Whitespace run excluded from the visible-character count (portable set). */
const WHITE_SPACE = /[\t\n\u000b\u000c\r \u0085\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000]/gu
const LEADING_BLANK = /^[\t \u3000]*$/
const ATX_HEADING = /^[\t ]{0,3}#{1,6}[\t ]+\S/
const FRONTMATTER_KEY = /^[A-Za-z_\u3400-\u9fff][^:\n]{0,80}:[ \t]*/

/**
 * Non-whitespace character count over the visible body — the CJK manuscript
 * convention shared with the reading panel. The visible body drops a
 * recognizable frontmatter block, leading blank lines, and the first ATX
 * heading.
 * @param text - the chapter document text.
 * @returns the number of visible characters.
 */
function countWords(text) {
  let body = text.replace(/\r\n?/g, '\n')
  if (body.startsWith('\ufeff')) body = body.slice(1)
  let lines = body.split('\n')
  if (lines[0] === '---') {
    const closing = lines.slice(1, 201).findIndex(line => line === '---' || line === '...')
    if (closing >= 1 && lines.slice(1, closing + 1).every(line => FRONTMATTER_KEY.test(line))) {
      lines = lines.slice(closing + 2)
    }
  }
  while (lines.length > 0 && LEADING_BLANK.test(lines[0])) lines.shift()
  if (lines.length > 0 && ATX_HEADING.test(lines[0])) lines.shift()
  return lines.join('\n').replace(WHITE_SPACE, '').length
}

/** Title from a chapter file name: `01-雪夜` → `01-雪夜`. */
function chapterFileTitle(file) {
  return file.replace(/\.md$/, '')
}

/**
 * The session workspace cwd for this call.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the absolute session cwd.
 */
function requireSessionCwd(exec) {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) {
    throw new Error('novel tools require a session workspace, but this execution carries no session cwd')
  }
  return cwd
}

/** Wordcount band over one target: internal ±12%, user band ±15%. */
function wordcountBands(target) {
  return {
    internal: { min: Math.ceil((target * 88) / 100), max: Math.floor((target * 112) / 100) },
    user: { min: Math.ceil((target * 85) / 100), max: Math.floor((target * 115) / 100) },
  }
}

/**
 * Evaluate one measured chapter against its target with the shared band
 * semantics: `internal_pass` commits without ceremony, `borderline` stays in
 * the user band, `under`/`over` need an explicit accept-current-length.
 */
function evaluateWordcount(actual, target) {
  const bands = wordcountBands(target)
  const internalPass = actual >= bands.internal.min && actual <= bands.internal.max
  const userPass = actual >= bands.user.min && actual <= bands.user.max
  return {
    metric: WORDCOUNT_METRIC,
    target,
    actual,
    internalBand: { ...bands.internal, pass: internalPass },
    userBand: { ...bands.user, pass: userPass },
    status: internalPass ? 'internal_pass' : userPass ? 'borderline' : actual < bands.user.min ? 'under' : 'over',
  }
}

const CHAPTER_FILE_NUMBER = /^(\d+)-/
const CHAPTER_FILE_REST = /^\d+-[\s\S]*\.md$/

/** Chapter number from a `NN-章名.md` file name, or undefined. */
function chapterNumberFromFile(file) {
  const match = CHAPTER_FILE_NUMBER.exec(file)
  return match === null ? undefined : Number(match[1])
}

/** Shape a parsed board document into the canonical v2 in-memory form. */
function normalizeBoard(parsed) {
  const board = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const chapters = board.chapters !== null && typeof board.chapters === 'object' && !Array.isArray(board.chapters)
    ? board.chapters
    : {}
  const context = board.context !== null && typeof board.context === 'object' ? board.context : {}
  const position = context.position !== null && typeof context.position === 'object' ? context.position : {}
  const characters = board.characters !== null && typeof board.characters === 'object' && !Array.isArray(board.characters)
    ? board.characters
    : {}
  const timeline = board.timeline !== null && typeof board.timeline === 'object' && !Array.isArray(board.timeline)
    ? board.timeline
    : {}
  const records = board.chapterRecords !== null && typeof board.chapterRecords === 'object' && !Array.isArray(board.chapterRecords)
    ? board.chapterRecords
    : {}
  return {
    formatVersion: BOARD_FORMAT_VERSION,
    stateRevision: typeof board.stateRevision === 'number' ? board.stateRevision : 0,
    trackingInitialized: board.trackingInitialized === true,
    bookTitle: typeof board.bookTitle === 'string' ? board.bookTitle : undefined,
    importedThroughChapter: typeof board.importedThroughChapter === 'number' ? board.importedThroughChapter : null,
    context: {
      position: {
        volume: typeof position.volume === 'string' ? position.volume : undefined,
        volumeStartChapter: typeof position.volumeStartChapter === 'number' ? position.volumeStartChapter : null,
        storyTime: typeof position.storyTime === 'string' ? position.storyTime : undefined,
        scene: typeof position.scene === 'string' ? position.scene : undefined,
      },
      longTermConstraints: stringList(context.longTermConstraints),
      activeCharacters: stringList(context.activeCharacters),
      continuityRisks: stringList(context.continuityRisks),
      recentChapters: (Array.isArray(context.recentChapters) ? context.recentChapters : []).slice(-MAX_RECENT_CHAPTERS)
        .map(entry => ({
          chapter: typeof entry?.chapter === 'number' ? entry.chapter : undefined,
          summary: typeof entry?.summary === 'string' ? entry.summary : '',
        })),
      nextChapterCommitments: stringList(context.nextChapterCommitments),
    },
    chapters: Object.fromEntries(Object.entries(chapters).map(([file, entry]) => [file, {
      status: CHAPTER_STATUSES.includes(entry?.status) ? entry.status : 'draft',
      title: typeof entry?.title === 'string' ? entry.title : undefined,
      target: typeof entry?.target === 'number' ? entry.target : undefined,
    }])),
    foreshadows: (Array.isArray(board.foreshadows) ? board.foreshadows : []).map((entry, index) => ({
      id: typeof entry?.id === 'string' ? entry.id : `F${String(index + 1).padStart(2, '0')}`,
      summary: typeof entry?.summary === 'string' ? entry.summary : '',
      plantedIn: typeof entry?.plantedIn === 'string' ? entry.plantedIn : undefined,
      plannedPayoffIn: typeof entry?.plannedPayoffIn === 'number' ? entry.plannedPayoffIn : null,
      paidoffIn: typeof entry?.paidoffIn === 'string' ? entry.paidoffIn : undefined,
      status: FORESHADOW_STATUSES.includes(entry?.status)
        ? entry.status
        : entry?.paidoffIn !== undefined ? '已回收' : '已埋',
      importance: IMPORTANCE_LEVELS.includes(entry?.importance) ? entry.importance : undefined,
      updatedIn: typeof entry?.updatedIn === 'number' ? entry.updatedIn : undefined,
    })),
    characters: Object.fromEntries(Object.entries(characters).map(([name, entry]) => [name, {
      identity: typeof entry?.identity === 'string' ? entry.identity : undefined,
      location: typeof entry?.location === 'string' ? entry.location : undefined,
      goal: typeof entry?.goal === 'string' ? entry.goal : undefined,
      state: typeof entry?.state === 'string' ? entry.state : undefined,
      abilities: stringList(entry?.abilities),
      relationships: stringList(entry?.relationships),
      knowledge: stringList(entry?.knowledge),
      openThreads: stringList(entry?.openThreads),
    }])),
    timeline: Object.fromEntries(Object.entries(timeline).map(([id, entry]) => [id, {
      id: typeof entry?.id === 'string' ? entry.id : id,
      storyTime: typeof entry?.storyTime === 'string' ? entry.storyTime : undefined,
      objectiveFact: typeof entry?.objectiveFact === 'string' ? entry.objectiveFact : '',
      readerKnowledge: typeof entry?.readerKnowledge === 'string' ? entry.readerKnowledge : '',
      revealStatus: entry?.revealStatus === '已揭示' ? '已揭示' : '未揭示',
      revealChapter: entry?.revealStatus === '已揭示' && typeof entry?.revealChapter === 'number' ? entry.revealChapter : null,
      characters: stringList(entry?.characters),
      firstRecordedIn: typeof entry?.firstRecordedIn === 'number' ? entry.firstRecordedIn : undefined,
      updatedIn: typeof entry?.updatedIn === 'number' ? entry.updatedIn : undefined,
    }])),
    chapterRecords: Object.fromEntries(Object.entries(records).map(([key, entry]) => [key, {
      chapter: typeof entry?.chapter === 'number' ? entry.chapter : Number(key),
      title: typeof entry?.title === 'string' ? entry.title : undefined,
      result: typeof entry?.result === 'string' ? entry.result : '',
      characterChanges: (Array.isArray(entry?.characterChanges) ? entry.characterChanges : []).map(change => ({
        name: typeof change?.name === 'string' ? change.name : '',
        change: typeof change?.change === 'string' ? change.change : '',
      })),
      retiredCharacters: stringList(entry?.retiredCharacters),
      retiredContextItems: stringList(entry?.retiredContextItems),
      words: entry?.words !== null && typeof entry?.words === 'object' ? {
        metric: WORDCOUNT_METRIC,
        target: typeof entry.words.target === 'number' ? entry.words.target : undefined,
        actual: typeof entry.words.actual === 'number' ? entry.words.actual : undefined,
        status: entry.words.status,
        resolution: WORDCOUNT_RESOLUTIONS.includes(entry.words.resolution) ? entry.words.resolution : undefined,
      } : undefined,
    }])),
  }
}

/** String list narrowing: keep non-empty strings, drop everything else. */
function stringList(value) {
  return Array.isArray(value) ? value.filter(entry => typeof entry === 'string' && entry.length > 0) : []
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

/** Read every chapter file under `chapters/` and derive its word count. */
async function scanChapters(fs, cwd) {
  const dir = await fs.resolve(CHAPTERS_DIR, { cwd })
  if (await fs.stat(dir) === undefined) return []
  const names = await fs.listDir(dir)
  const files = names
    .map(entry => typeof entry === 'string' ? entry : entry.name)
    .filter(name => CHAPTER_FILE_REST.test(name))
    .sort()
  const chapters = []
  for (const file of files) {
    const target = await fs.resolve(`${CHAPTERS_DIR}/${file}`, { cwd })
    const content = await fs.readText(target)
    chapters.push({ file: chapterFileTitle(file), number: chapterNumberFromFile(file), words: countWords(content) })
  }
  return chapters
}

/** The highest committed chapter number: records, else the import boundary, else 0. */
function lastChapterOf(board) {
  const recordNumbers = Object.keys(board.chapterRecords).map(Number).filter(Number.isFinite)
  if (recordNumbers.length > 0) return Math.max(...recordNumbers)
  return board.importedThroughChapter ?? 0
}

const OUTLINE_TEMPLATE = (title, genre, pov, targetLength) => `# ${title || '未命名作品'} · 故事大纲

## 故事前提

<!-- 一段话说清：主角是谁、世界是什么、核心冲突是什么、结局走向。 -->

## 基本设定

- 题材：${genre || '（待定）'}
- 叙事视角与人称：${pov || '（待定）'}
- 目标篇幅：${targetLength || '（待定）'}

## 卷章结构

<!-- 按卷组织；每章一行：\`- [ ] NN-章名 — 本章目标（enter/exit）\`，完成后把 [ ] 改为 [x]。 -->

## 伏笔登记

<!-- 重大伏笔在此登记；逐条明细用 novel_board_update 记入状态板。 -->

## 各章状态

<!-- 章节状态的事实来源是 .novel/board.json（novel_board_read / novel_board_update）。 -->
`

const AGENTS_TEMPLATE = `# 工作区写作规范

本文件由小说创作模式读取。把对整部作品长期有效的约束写在这里，例如：

- 文风与语言指纹（句长、白描 or 浓墨、对话占比）
- 命名表：人名、地名、组织名、专有名词的写法
- 视角纪律：什么可以进入叙述者的感知范围
- 禁区：不出现的题材元素、不使用的表达

## 文件约定

- \`outline.md\` — 故事大纲与卷章结构（状态板之外的人读的版本）
- \`characters/\` — 每个重要人物一个小传文件（欲望、恐惧、弧光、语言指纹）
- \`chapters/\` — 正文，按 \`NN-章名.md\` 命名
- \`.novel/board.json\` — 项目状态板（工具读写，不要手改）
- \`.novel/上下文.md\`、\`.novel/角色状态/\`、\`.novel/伏笔.md\`、\`.novel/时间线/\`、\`.novel/逐章记录/\` — 追踪派生视图（novel_track 生成，不要手改）
`

function scaffoldTool(fs) {
  return {
    name: 'novel_scaffold',
    description: '为长篇小说项目创建工作区骨架：outline.md（大纲）、AGENTS.md（写作规范）、.novel/board.json（状态板）。已存在的文件不会被覆盖。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '作品标题（可后补）' },
        genre: { type: 'string', description: '题材，如 科幻 / 悬疑 / 都市' },
        pov: { type: 'string', description: '叙事视角与人称，如 第三人称限制视角' },
        targetLength: { type: 'string', description: '目标篇幅，如 30 万字' },
      },
      required: [],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => textBlock(value),
    },
    async execute(args, exec) {
      const cwd = requireSessionCwd(exec)
      // Create-if-absent per file: an existing project gets its missing
      // companions filled in instead of an early return, and nothing existing
      // is ever overwritten.
      const files = [
        { path: 'outline.md', template: OUTLINE_TEMPLATE(args.title, args.genre, args.pov, args.targetLength), label: '故事大纲模板（前提/设定/卷章结构/伏笔登记）' },
        { path: 'AGENTS.md', template: AGENTS_TEMPLATE, label: '工作区写作规范模板（风格、命名表、禁区）' },
        { path: BOARD_FILE, template: `${JSON.stringify(normalizeBoard(null), null, 2)}\n`, label: '项目状态板（后续用 novel_board_update / novel_track 维护）' },
      ]
      const created = []
      const existing = []
      for (const file of files) {
        const target = await fs.resolve(file.path, { cwd })
        if (await fs.stat(target) !== undefined) {
          existing.push(file.path)
          continue
        }
        await fs.writeText(target, file.template)
        created.push(`- ${file.path} — ${file.label}`)
      }
      if (created.length === 0) {
        return '项目骨架已完整（outline.md、AGENTS.md、.novel/board.json 均在），未做任何改动。用 novel_board_read 恢复项目上下文。'
      }
      return [
        '项目骨架已就绪：',
        ...created,
        ...existing.length > 0 ? [`已存在、保持不动：${existing.join('、')}`] : [],
        '下一步：与作者确认题材、视角与人称、目标篇幅，然后填 outline.md 并建立第一部的人物小传。',
      ].join('\n')
    },
  }
}

function boardReadTool(fs) {
  return {
    name: 'novel_board_read',
    description: '读取小说项目状态板：各章状态与字数、追踪上下文（当前位置、长期约束、下一章承诺、连贯性风险）、角色快照数、伏笔登记（含未回收清单）、时间线概览与项目汇总。进入已有项目或每次动笔前先调用它恢复上下文。',
    parameters: { type: 'object', properties: {}, required: [] },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    async execute(_args, exec) {
      const cwd = requireSessionCwd(exec)
      const { board } = await readBoard(fs, cwd)
      const chapters = await scanChapters(fs, cwd)
      const statusOf = file => board.chapters[file]?.status ?? 'draft'
      const rows = chapters.map(chapter => ({
        chapter: chapter.file,
        title: board.chapters[chapter.file]?.title,
        status: statusOf(chapter.file),
        words: chapter.words,
      }))
      const openForeshadows = board.foreshadows.filter(entry => entry.status !== '已回收')
      return {
        formatVersion: board.formatVersion,
        stateRevision: board.stateRevision,
        lastChapter: lastChapterOf(board),
        context: {
          position: board.context.position,
          longTermConstraints: board.context.longTermConstraints,
          activeCharacters: board.context.activeCharacters,
          continuityRisks: board.context.continuityRisks,
          recentChapters: board.context.recentChapters,
          nextChapterCommitments: board.context.nextChapterCommitments,
        },
        chapters: rows,
        foreshadows: board.foreshadows,
        characterCount: Object.keys(board.characters).length,
        characterNames: Object.keys(board.characters),
        timelineCount: Object.keys(board.timeline).length,
        summary: {
          totalWords: rows.reduce((sum, row) => sum + row.words, 0),
          chapterCount: rows.length,
          byStatus: Object.fromEntries(CHAPTER_STATUSES.map(status => [
            status,
            rows.filter(row => row.status === status).length,
          ])),
          openForeshadowCount: openForeshadows.length,
        },
      }
    },
  }
}

function boardUpdateTool(fs) {
  return {
    name: 'novel_board_update',
    description: '轻量更新小说项目状态板：登记章节状态（draft/revised/final）与目标字数、登记伏笔（plant，可带重要度与计划回收章）、标记伏笔回收。逐章的完整追踪事务（角色/时间线/上下文）用 novel_track。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set_chapter_status', 'record_foreshadow', 'pay_foreshadow'], description: '要执行的更新' },
        chapter: { type: 'string', description: '章节文件名（NN-章名.md）；set_chapter_status 必填' },
        status: { type: 'string', enum: CHAPTER_STATUSES, description: 'set_chapter_status 必填' },
        target: { type: 'number', description: '目标字数（正整数）；set_chapter_status 可选' },
        summary: { type: 'string', description: '伏笔内容一句话；record_foreshadow 必填' },
        plantedIn: { type: 'string', description: '埋设伏笔的章节（NN-章名.md）；record_foreshadow 必填' },
        importance: { type: 'string', enum: IMPORTANCE_LEVELS, description: 'record_foreshadow 可选，默认 中' },
        plannedPayoffIn: { type: 'number', description: '计划回收章号；record_foreshadow 可选' },
        id: { type: 'string', description: '伏笔编号（如 F01）；pay_foreshadow 必填' },
        paidoffIn: { type: 'string', description: '回收伏笔的章节；pay_foreshadow 必填' },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
    },
    async execute(args, exec) {
      const cwd = requireSessionCwd(exec)
      const { board, version } = await readBoard(fs, cwd)
      let message
      if (args.action === 'set_chapter_status') {
        if (typeof args.chapter !== 'string' || !CHAPTER_STATUSES.includes(args.status)) {
          throw new Error('set_chapter_status 需要 chapter（章节文件名）与 status（draft/revised/final）')
        }
        const entry = board.chapters[args.chapter] ?? { status: 'draft' }
        entry.status = args.status
        if (typeof args.target === 'number' && Number.isInteger(args.target) && args.target > 0) entry.target = args.target
        board.chapters[args.chapter] = entry
        message = `章节 ${args.chapter} 状态 → ${args.status}`
      } else if (args.action === 'record_foreshadow') {
        if (typeof args.summary !== 'string' || typeof args.plantedIn !== 'string') {
          throw new Error('record_foreshadow 需要 summary（伏笔内容）与 plantedIn（埋设章节）')
        }
        const id = `F${String(board.foreshadows.length + 1).padStart(2, '0')}`
        board.foreshadows.push({
          id,
          summary: args.summary,
          plantedIn: args.plantedIn,
          plannedPayoffIn: typeof args.plannedPayoffIn === 'number' ? args.plannedPayoffIn : null,
          status: '已埋',
          importance: IMPORTANCE_LEVELS.includes(args.importance) ? args.importance : '中',
          updatedIn: chapterNumberFromFile(args.plantedIn),
        })
        message = `伏笔 ${id} 已登记（埋设于 ${args.plantedIn}，重要度 ${IMPORTANCE_LEVELS.includes(args.importance) ? args.importance : '中'}）：${args.summary}`
      } else if (args.action === 'pay_foreshadow') {
        const entry = board.foreshadows.find(candidate => candidate.id === args.id)
        if (entry === undefined || typeof args.paidoffIn !== 'string') {
          throw new Error('pay_foreshadow 需要已存在的 id 与 paidoffIn（回收章节）')
        }
        entry.paidoffIn = args.paidoffIn
        entry.status = '已回收'
        entry.updatedIn = chapterNumberFromFile(args.paidoffIn)
        message = `伏笔 ${entry.id} 已于 ${args.paidoffIn} 回收`
      } else {
        throw new Error(`未知 action "${String(args.action)}"`)
      }
      const target = await fs.resolve(BOARD_FILE, { cwd })
      try {
        await fs.writeText(target, `${JSON.stringify(board, null, 2)}\n`, version !== undefined
          ? { kind: 'replaceIfVersion', version }
          : { kind: 'createIfAbsent' })
      } catch (error) {
        if (error?.code === 'FS_STALE_VERSION') {
          throw new Error('状态板已被其他修改更新过（FS_STALE_VERSION）——先 novel_board_read 重新读取再重试')
        }
        throw error
      }
      return { message, openForeshadows: board.foreshadows.filter(entry => entry.status !== '已回收').length }
    },
  }
}

// ── tracking protocol: derived views ───────────────────────────────────────

/**
 * Render the continuation context card: seven fixed sections regenerated
 * from the state, at most 12 KiB when checked.
 */
function renderContextCard(board) {
  const { position } = board.context
  const activeNames = board.context.activeCharacters
    .filter(name => board.characters[name] !== undefined)
  const activeForeshadows = board.foreshadows
    .filter(entry => entry.status !== '已回收')
    .sort((left, right) => rank(right) - rank(left) || String(left.id).localeCompare(String(right.id)))
    .slice(0, MAX_ACTIVE_FORESHADOWS)
  const lines = [
    `# 续写状态卡${board.bookTitle !== undefined ? ` — ${board.bookTitle}` : ''}`,
    '',
    `> 状态修订：${board.stateRevision}。截至当前章的续写状态卡，只放下一章真正需要的连续性状态。工具生成，不要手改。`,
    '',
    '## 当前位置',
    `- 当前章：第 ${lastChapterOf(board)} 章`,
    position.volume !== undefined ? `- 卷：${position.volume}${position.volumeStartChapter !== null ? `（始于第 ${position.volumeStartChapter} 章）` : ''}` : undefined,
    position.storyTime !== undefined ? `- 故事时间：${position.storyTime}` : undefined,
    position.scene !== undefined ? `- 场景：${position.scene}` : undefined,
    '',
    '## 长期约束',
    ...board.context.longTermConstraints.map(entry => `- ${entry}`),
    '',
    '## 核心角色状态',
    ...activeNames.map(name => {
      const snapshot = board.characters[name]
      const head = [snapshot.identity, snapshot.state].filter(part => part !== undefined).join('｜')
      return `- ${name}${head !== '' ? `｜${head}` : ''}${snapshot.goal !== undefined ? `｜目标：${snapshot.goal}` : ''}`
    }),
    '',
    '## 活跃伏笔',
    ...activeForeshadows.map(entry => `- ${entry.id}｜${entry.summary}｜埋${entry.plantedIn ?? '？'}｜${entry.status}${entry.importance !== undefined ? `｜${entry.importance}` : ''}`),
    '',
    '## 近三章速记',
    ...board.context.recentChapters.map(entry => `- 第 ${entry.chapter} 章｜${entry.summary}`),
    '',
    '## 下一章承诺',
    ...board.context.nextChapterCommitments.map(entry => `- ${entry}`),
    '',
    '## 连贯性风险',
    ...board.context.continuityRisks.map(entry => `- ${entry}`),
    '',
  ]
  return lines.filter(part => part !== undefined).join('\n')
}

/** Importance rank for the foreshadow selection: 高 first, then id order. */
function rank(entry) {
  return entry.importance === '高' ? 2 : entry.importance === '中' ? 1 : 0
}

/** Render one character snapshot file. */
function renderCharacterSnapshot(name, snapshot, revision, lastChapter) {
  return [
    `# ${name}｜当前状态`,
    '',
    `- 状态修订：${revision}`,
    `- 截至章节：第 ${lastChapter} 章`,
    snapshot.identity !== undefined ? `- 身份：${snapshot.identity}` : undefined,
    snapshot.location !== undefined ? `- 位置：${snapshot.location}` : undefined,
    snapshot.goal !== undefined ? `- 当前目标：${snapshot.goal}` : undefined,
    snapshot.state !== undefined ? `- 身心状态：${snapshot.state}` : undefined,
    '',
    '## 能力与资源',
    ...snapshot.abilities.map(entry => `- ${entry}`),
    '',
    '## 关键关系',
    ...snapshot.relationships.map(entry => `- ${entry}`),
    '',
    '## 已知信息',
    ...snapshot.knowledge.map(entry => `- ${entry}`),
    '',
    '## 未结事项',
    ...snapshot.openThreads.map(entry => `- ${entry}`),
    '',
  ].filter(part => part !== undefined).join('\n')
}

/** Render the current-foreshadow table. */
function renderForeshadowView(board) {
  const rows = board.foreshadows.map(entry => `| ${entry.id} | ${entry.summary} | ${entry.plantedIn ?? '—'} | ${entry.plannedPayoffIn !== null && entry.plannedPayoffIn !== undefined ? `第 ${entry.plannedPayoffIn} 章` : '—'} | ${entry.status} | ${entry.importance ?? '—'} | ${entry.updatedIn !== undefined ? `第 ${entry.updatedIn} 章` : '—'} |`)
  return [
    '# 伏笔当前状态',
    '',
    `> 状态修订：${board.stateRevision}。每个 ID 只保留一行当前状态；历史变化见 \`逐章记录/\`。工具生成，不要手改。`,
    '',
    '| ID | 内容 | 埋设章 | 计划回收章 | 状态 | 重要度 | 最近变更章 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

/** Render the dual-layer timeline views. */
function renderTimelineViews(board) {
  const entries = Object.values(board.timeline)
    .sort((left, right) => String(left.firstRecordedIn ?? 0) - String(right.firstRecordedIn ?? 0) || String(left.id ?? '').localeCompare(String(right.id ?? '')))
  const author = [
    '# 作者真相时间线',
    '',
    `> 状态修订：${board.stateRevision}。客观事实与读者认知的权威对照；未来揭示计划仍留在大纲。工具生成，不要手改。`,
    '',
    '| ID | 首次登记章 | 故事时间 | 客观事实 | 读者当前认知 | 揭示状态 | 实际揭示章 |',
    '|---|---|---|---|---|---|---|',
    ...entries.map(entry => `| ${entry.id} | ${entry.firstRecordedIn !== undefined ? `第 ${entry.firstRecordedIn} 章` : '—'} | ${entry.storyTime ?? '—'} | ${entry.objectiveFact}${entry.characters.length > 0 ? `（涉及：${entry.characters.join('、')}）` : ''} | ${entry.readerKnowledge || '—'} | ${entry.revealStatus} | ${entry.revealChapter !== null && entry.revealChapter !== undefined ? `第 ${entry.revealChapter} 章` : '—'} |`),
    '',
  ].join('\n')
  const reader = [
    '# 读者已知时间线',
    '',
    `> 状态修订：${board.stateRevision}。只呈现读者截至当前章节已经知道或相信的内容，不泄露作者侧客观真相。工具生成，不要手改。`,
    '',
    '| ID | 读者当前认知 | 认知截至章 |',
    '|---|---|---|',
    ...entries.filter(entry => entry.revealStatus === '已揭示').map(entry => `| ${entry.id} | ${entry.readerKnowledge || '（未登记读者认知）'} | 第 ${lastChapterOf(board)} 章 |`),
    '',
  ].join('\n')
  return { author, reader }
}

/** Render one per-chapter delta record. */
function renderChapterRecord(record) {
  const number = String(record.chapter).padStart(3, '0')
  const words = record.words !== undefined
    ? `- 字数：目标 ${record.words.target}，实际 ${record.words.actual}（${record.words.status}，${record.words.resolution === 'accepted_current_length' ? '作者接受当前长度' : '带内提交'}）`
    : undefined
  return [
    `# 第 ${record.chapter} 章${record.title !== undefined ? ` · ${record.title}` : ''}`,
    '',
    `> 工具生成的本章增量记录，只记对未来连续性有用的变化。`,
    '',
    '## 本章结果',
    `- ${record.result}`,
    '',
    '## 角色变化',
    ...record.characterChanges.map(change => `- ${change.name}：${change.change}`),
    '',
    ...(record.retiredCharacters.length > 0 ? ['## 本章退役角色', ...record.retiredCharacters.map(name => `- ${name}`), ''] : []),
    ...(record.retiredContextItems.length > 0 ? ['## 本章退役登记', ...record.retiredContextItems.map(entry => `- ${entry}`), ''] : []),
    ...(words !== undefined ? [words, ''] : []),
  ].filter(part => part !== undefined).join('\n')
}

/** Every derived view the tracking protocol owns, keyed by workspace path. */
function deriveViews(board) {
  const views = { '.novel/上下文.md': renderContextCard(board), '.novel/伏笔.md': renderForeshadowView(board) }
  const timeline = renderTimelineViews(board)
  views['.novel/时间线/作者真相.md'] = timeline.author
  views['.novel/时间线/读者已知.md'] = timeline.reader
  for (const [name, snapshot] of Object.entries(board.characters)) {
    views[`.novel/角色状态/${name}.md`] = renderCharacterSnapshot(name, snapshot, board.stateRevision, lastChapterOf(board))
  }
  for (const record of Object.values(board.chapterRecords)) {
    views[`.novel/逐章记录/第${String(record.chapter).padStart(3, '0')}章.md`] = renderChapterRecord(record)
  }
  return views
}

/**
 * Regenerate every derived view on disk. The state document is already
 * committed when this runs; a failed view write leaves the state authoritative
 * and `novel_track` `check` reports the stale view for a revision re-run.
 */
async function writeDerivedViews(fs, cwd, board) {
  const problems = []
  for (const [path, content] of Object.entries(deriveViews(board))) {
    const target = await fs.resolve(path, { cwd })
    try {
      await fs.writeText(target, content)
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return problems
}

/** Serialize one character snapshot and enforce the byte ceilings. */
function snapshotBytes(snapshot) {
  return process.getBuiltinModule('node:buffer').Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
}

/** Locate the committed chapter file for a chapter number, failing loudly. */
async function chapterFileFor(fs, cwd, board, chapter) {
  const files = (await scanChapters(fs, cwd)).filter(entry => entry.number === chapter)
  if (files.length !== 1) {
    throw new Error(`章节数字 ${chapter} 必须恰有一个正文文件（chapters/NN-章名.md），实际 ${files.length} 个`)
  }
  return files[0]
}

const trackingTool = fs => ({
  name: 'novel_track',
  description: '追踪协议事务工具：init 建立追踪状态（新书或导入项目）；commit 提交逐章事务（mode append/revision，带 expectedRevision 并发检查，重读正文按 visible_chars_v1 计字数并校验字数带，成功后状态修订号 +1 并重建全部派生视图：上下文卡/角色快照/伏笔表/双时间线/逐章记录）；check 校验派生视图与状态一致并报告状态修订号与最后提交章。派生视图只由本工具生成，不手改。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['init', 'commit', 'check'], description: '要执行的事务' },
      bookTitle: { type: 'string', description: 'init：书名' },
      position: {
        type: 'object',
        description: '当前位置：commit 必填整份提交',
        properties: {
          volume: { type: 'string', description: '卷名，如 第一卷·风起' },
          volumeStartChapter: { type: 'number', description: '该卷起始章号' },
          storyTime: { type: 'string', description: '故事时间（故事内时间）' },
          scene: { type: 'string', description: '当前场景' },
        },
      },
      longTermConstraints: { type: 'array', items: { type: 'string' }, description: '长期约束（≤6 条，整份提交；去掉条目需同步列入 retiredContextItems）' },
      activeCharacters: { type: 'array', items: { type: 'string' }, description: '当前活跃核心角色（≤6 人，须已有快照）' },
      continuityRisks: { type: 'array', items: { type: 'string' }, description: '连贯性风险（≤6 条，整份提交）' },
      nextChapterCommitments: { type: 'array', items: { type: 'string' }, description: 'init/commit：下一章必须履行的承诺' },
      characters: { type: 'object', description: 'init：初始角色快照（名字 → 快照对象），另见 characterSnapshots 字段说明' },
      foreshadows: { type: 'array', description: 'init：初始伏笔（id/summary/plantedIn/status/importance/plannedPayoffIn）' },
      timeline: { type: 'object', description: 'init：初始时间线事件（ID → 事件对象）' },
      importedThroughChapter: { type: 'number', description: 'init：导入项目已写到的最后完整章号；新书为 0' },
      mode: { type: 'string', enum: ['append', 'revision'], description: 'commit：append=新章，revision=重算某章' },
      chapter: { type: 'number', description: 'commit：章号（正整数）；append 必须 = 最后提交章 + 1' },
      chapterTitle: { type: 'string', description: 'commit：本章标题（与正文文件名一致）' },
      expectedRevision: { type: 'number', description: 'commit：构造事务前从 novel_track check 取得的状态修订号；不匹配即拒绝' },
      result: { type: 'string', description: 'commit/append：本章结果一句话（对未来连续性有用的变化）' },
      characterChanges: { type: 'array', description: 'commit：角色变化 [{name, change}]', items: { type: 'object' } },
      characterSnapshots: { type: 'object', description: 'commit：变化角色的完整当前快照（名字 → identity/location/goal/state/abilities/relationships/knowledge/openThreads）；有快照的角色必须同时在 characterChanges' },
      foreshadowChanges: { type: 'array', description: 'commit：伏笔变更 [{action: upsert/delete, id, summary, plantedIn, plannedPayoffIn, status, importance}]', items: { type: 'object' } },
      timelineChanges: { type: 'array', description: 'commit：时间线变更 [{action: upsert/delete, id, storyTime, objectiveFact, readerKnowledge, revealStatus, revealChapter, characters}]', items: { type: 'object' } },
      retiredCharacters: { type: 'array', items: { type: 'string' }, description: 'commit/append：本章退役（不再进入热上下文）的角色名' },
      retiredContextItems: { type: 'array', items: { type: 'string' }, description: 'commit/append：本次整份提交中被移除的旧约束/风险条目原文' },
      wordTarget: { type: 'number', description: 'commit：本章目标字数（正整数）' },
      acceptCurrentLength: { type: 'boolean', description: 'commit：字数在用户带外时，作者显式接受当前长度才置 true' },
    },
    required: ['action'],
  },
  output: {
    schema: { type: 'object' },
    render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
  },
  async execute(args, exec) {
    const cwd = requireSessionCwd(exec)
    if (args.action === 'check') return trackCheck(fs, cwd)
    if (args.action === 'init') return trackInit(fs, cwd, args)
    return trackCommit(fs, cwd, args)
  },
})

/** Read-only protocol probe: revision, last chapter, derived-view integrity. */
async function trackCheck(fs, cwd) {
  const { board } = await readBoard(fs, cwd)
  const expected = deriveViews(board)
  const problems = []
  for (const [path, content] of Object.entries(expected)) {
    const target = await fs.resolve(path, { cwd })
    const stat = await fs.stat(target)
    if (stat === undefined) {
      problems.push(`${path}: 派生视图缺失`)
      continue
    }
    if (await fs.readText(target) !== content) {
      problems.push(`${path}: 派生视图与状态不一致（被手改或过期）——用 mode=revision 重建，不要手改`)
    }
  }
  return {
    ok: problems.length === 0,
    formatVersion: board.formatVersion,
    stateRevision: board.stateRevision,
    lastChapter: lastChapterOf(board),
    importedThroughChapter: board.importedThroughChapter,
    problems,
  }
}

/** Initialize the tracking protocol on a fresh (or v1, or imported) project. */
async function trackInit(fs, cwd, args) {
  const { board, version } = await readBoard(fs, cwd)
  if (board.trackingInitialized) {
    throw new Error('追踪状态已初始化，init 绝不覆盖——用 check 查看当前状态，逐章变化用 commit')
  }
  if (args.importedThroughChapter !== undefined && (!Number.isInteger(args.importedThroughChapter) || args.importedThroughChapter < 0)) {
    throw new Error('importedThroughChapter 必须是非负整数（新书为 0）')
  }
  if (args.importedThroughChapter !== undefined) board.importedThroughChapter = args.importedThroughChapter
  if (typeof args.bookTitle === 'string') board.bookTitle = args.bookTitle
  if (args.position !== null && typeof args.position === 'object') {
    board.context.position = {
      volume: typeof args.position.volume === 'string' ? args.position.volume : undefined,
      volumeStartChapter: typeof args.position.volumeStartChapter === 'number' ? args.position.volumeStartChapter : null,
      storyTime: typeof args.position.storyTime === 'string' ? args.position.storyTime : undefined,
      scene: typeof args.position.scene === 'string' ? args.position.scene : undefined,
    }
  }
  board.context.longTermConstraints = boundedList(args.longTermConstraints, '长期约束', 'longTermConstraints')
  board.context.nextChapterCommitments = stringList(args.nextChapterCommitments)
  const seeded = normalizeCharacters(args.characters)
  for (const [name, snapshot] of Object.entries(seeded)) {
    const bytes = snapshotBytes(snapshot)
    if (bytes > SNAPSHOT_HARD_BYTES) {
      throw new Error(`角色快照 ${name} 序列化 ${bytes} 字节，超过硬上限 ${SNAPSHOT_HARD_BYTES}——压缩到要点（目标 ${SNAPSHOT_TARGET_BYTES}）`)
    }
    board.characters[name] = snapshot
  }
  const foreshadows = Array.isArray(args.foreshadows) ? args.foreshadows : []
  board.foreshadows = foreshadows.map((entry, index) => ({
    id: typeof entry?.id === 'string' ? entry.id : `F${String(index + 1).padStart(2, '0')}`,
    summary: typeof entry?.summary === 'string' ? entry.summary : '',
    plantedIn: typeof entry?.plantedIn === 'string' ? entry.plantedIn : undefined,
    plannedPayoffIn: typeof entry?.plannedPayoffIn === 'number' ? entry.plannedPayoffIn : null,
    paidoffIn: undefined,
    status: FORESHADOW_STATUSES.includes(entry?.status) ? entry.status : '已埋',
    importance: IMPORTANCE_LEVELS.includes(entry?.importance) ? entry.importance : '中',
    updatedIn: typeof entry?.updatedIn === 'number' ? entry.updatedIn : undefined,
  }))
  if (args.timeline !== null && typeof args.timeline === 'object' && !Array.isArray(args.timeline)) {
    board.timeline = normalizeBoard({ timeline: args.timeline }).timeline
  }
  board.stateRevision = 0
  board.trackingInitialized = true
  await commitBoard(fs, cwd, board, version)
  const viewProblems = await writeDerivedViews(fs, cwd, board)
  return {
    message: `追踪状态已初始化（状态修订 0${board.importedThroughChapter !== null ? `，导入截止第 ${board.importedThroughChapter} 章` : ''}）；派生视图已生成于 .novel/`,
    stateRevision: board.stateRevision,
    lastChapter: lastChapterOf(board),
    characters: Object.keys(board.characters),
    viewProblems,
  }
}

/** Validate and apply one per-chapter tracking transaction. */
async function trackCommit(fs, cwd, args) {
  const { board, version } = await readBoard(fs, cwd)
  if (board.trackingInitialized !== true) {
    throw new Error('追踪状态未初始化——先 novel_track init（新书）或带 importedThroughChapter 初始化（导入项目）')
  }
  if (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== board.stateRevision) {
    throw new Error(`expectedRevision ${JSON.stringify(args.expectedRevision)} 与当前状态修订号 ${board.stateRevision} 不一致——先 novel_track check 重新读取状态再构造事务`)
  }
  const mode = args.mode === 'revision' ? 'revision' : args.mode === 'append' ? 'append' : undefined
  if (mode === undefined) throw new Error('commit 需要 mode: append 或 revision')
  if (!Number.isInteger(args.chapter) || args.chapter < 1) throw new Error('commit 需要 chapter（正整数章号）')
  const last = lastChapterOf(board)
  if (mode === 'append' && args.chapter !== last + 1) {
    throw new Error(`append 章号必须是 ${last + 1}（最后提交章 ${last} + 1），实际 ${args.chapter}`)
  }
  if (mode === 'revision' && (args.chapter > last || board.chapterRecords[String(args.chapter)] === undefined)) {
    throw new Error(`revision 章号 ${args.chapter} 必须是已提交章节（最后提交章 ${last}）`)
  }
  const target = args.wordTarget
  if (!Number.isInteger(target) || target < 1) throw new Error('commit 需要 wordTarget（正整数目标字数）')
  const chapter = await chapterFileFor(fs, cwd, board, args.chapter)
  const body = await fs.readText(await fs.resolve(`${CHAPTERS_DIR}/${chapter.file}.md`, { cwd }))
  const words = evaluateWordcount(countWords(body), target)
  const inUserBand = words.status === 'internal_pass' || words.status === 'borderline'
  if (inUserBand && args.acceptCurrentLength === true) {
    throw new Error('字数已在用户带内（无需 acceptCurrentLength）——去掉该标记后重试')
  }
  if (!inUserBand && args.acceptCurrentLength !== true) {
    throw new Error(`字数 ${words.actual} 带外（${words.status}，用户带 ${words.userBand.min}-${words.userBand.max}）：under 不自动补写，over 至多净删一次；作者显式接受当前长度则置 acceptCurrentLength=true 后重试`)
  }
  const record = {
    chapter: args.chapter,
    title: typeof args.chapterTitle === 'string' ? args.chapterTitle : undefined,
    result: mode === 'append' ? requireString(args.result, 'result（本章结果）') : typeof args.result === 'string' ? args.result : board.chapterRecords[String(args.chapter)]?.result ?? '',
    characterChanges: (Array.isArray(args.characterChanges) ? args.characterChanges : []).map(change => ({
      name: requireString(change?.name, 'characterChanges[].name'),
      change: requireString(change?.change, 'characterChanges[].change'),
    })),
    retiredCharacters: mode === 'append' ? stringList(args.retiredCharacters) : [],
    retiredContextItems: mode === 'append' ? stringList(args.retiredContextItems) : [],
    words: { metric: WORDCOUNT_METRIC, target, actual: words.actual, status: words.status, resolution: inUserBand ? 'within_user_band' : 'accepted_current_length' },
  }
  applyTransaction(board, args, mode, record)
  const snapshotProblems = validateSnapshots(board, record, args)
  if (snapshotProblems.length > 0) throw new Error(snapshotProblems.join('；'))
  board.stateRevision += 1
  board.chapterRecords[String(args.chapter)] = record
  const chapterEntry = board.chapters[chapter.file] ?? { status: 'draft' }
  if (chapterEntry.target === undefined) chapterEntry.target = target
  board.chapters[chapter.file] = chapterEntry
  await commitBoard(fs, cwd, board, version)
  const viewProblems = await writeDerivedViews(fs, cwd, board)
  return {
    message: `第 ${args.chapter} 章${mode === 'revision' ? '（修订）' : ''} 追踪事务已提交（状态修订 → ${board.stateRevision}）`,
    stateRevision: board.stateRevision,
    lastChapter: lastChapterOf(board),
    words: record.words,
    viewProblems,
  }
}

/** Mutate the board in place from one transaction's delta and context. */
function applyTransaction(board, args, mode, record) {
  for (const change of record.characterChanges) {
    const name = change.name
    if (board.characters[name] === undefined && !record.retiredCharacters.includes(name)) {
      board.characters[name] = normalizeCharacters({ [name]: args.characterSnapshots?.[name] ?? {} })[name]
    }
  }
  if (args.characterSnapshots !== null && typeof args.characterSnapshots === 'object' && !Array.isArray(args.characterSnapshots)) {
    for (const [name, raw] of Object.entries(args.characterSnapshots)) {
      board.characters[name] = normalizeCharacters({ [name]: raw ?? {} })[name]
    }
  }
  for (const change of Array.isArray(args.foreshadowChanges) ? args.foreshadowChanges : []) {
    const index = board.foreshadows.findIndex(entry => entry.id === change?.id)
    if (change?.action === 'delete') {
      if (index >= 0) board.foreshadows.splice(index, 1)
      continue
    }
    const existing = index >= 0 ? board.foreshadows[index] : undefined
    const plantedIn = typeof change?.plantedIn === 'string' ? change.plantedIn : existing?.plantedIn
    const row = {
      id: requireString(change?.id, 'foreshadowChanges[].id'),
      summary: typeof change?.summary === 'string' ? change.summary : existing?.summary ?? '',
      plantedIn,
      plannedPayoffIn: typeof change?.plannedPayoffIn === 'number' ? change.plannedPayoffIn : existing?.plannedPayoffIn ?? null,
      paidoffIn: change?.status === '已回收' ? (typeof change?.paidoffIn === 'string' ? change.paidoffIn : plantedIn) : existing?.paidoffIn,
      status: FORESHADOW_STATUSES.includes(change?.status) ? change.status : existing?.status ?? '已埋',
      importance: IMPORTANCE_LEVELS.includes(change?.importance) ? change.importance : existing?.importance ?? '中',
      updatedIn: record.chapter,
    }
    if (index >= 0) board.foreshadows[index] = row
    else board.foreshadows.push(row)
  }
  for (const change of Array.isArray(args.timelineChanges) ? args.timelineChanges : []) {
    const id = requireString(change?.id, 'timelineChanges[].id')
    if (change?.action === 'delete') {
      delete board.timeline[id]
      continue
    }
    const existing = board.timeline[id]
    const revealStatus = change?.revealStatus === '已揭示' ? '已揭示' : '未揭示'
    const revealChapter = revealStatus === '已揭示'
      ? (typeof change?.revealChapter === 'number' ? change.revealChapter : record.chapter)
      : null
    board.timeline[id] = {
      id,
      storyTime: typeof change?.storyTime === 'string' ? change.storyTime : existing?.storyTime,
      objectiveFact: typeof change?.objectiveFact === 'string' ? change.objectiveFact : existing?.objectiveFact ?? '',
      readerKnowledge: typeof change?.readerKnowledge === 'string' ? change.readerKnowledge : existing?.readerKnowledge ?? '',
      revealStatus,
      revealChapter,
      characters: stringList(change?.characters),
      firstRecordedIn: existing?.firstRecordedIn ?? record.chapter,
      updatedIn: record.chapter,
    }
  }
  if (args.position !== null && typeof args.position === 'object') {
    board.context.position = {
      volume: typeof args.position.volume === 'string' ? args.position.volume : undefined,
      volumeStartChapter: typeof args.position.volumeStartChapter === 'number' ? args.position.volumeStartChapter : null,
      storyTime: typeof args.position.storyTime === 'string' ? args.position.storyTime : undefined,
      scene: typeof args.position.scene === 'string' ? args.position.scene : undefined,
    }
  }
  if (args.longTermConstraints !== undefined || args.continuityRisks !== undefined) {
    const next = [...board.context.longTermConstraints, ...board.context.continuityRisks]
    const nextConstraints = args.longTermConstraints !== undefined
      ? boundedList(args.longTermConstraints, '长期约束', 'longTermConstraints')
      : board.context.longTermConstraints
    const nextRisks = args.continuityRisks !== undefined
      ? boundedList(args.continuityRisks, '连贯性风险', 'continuityRisks')
      : board.context.continuityRisks
    for (const entry of next) {
      if (!nextConstraints.includes(entry) && !nextRisks.includes(entry) && !record.retiredContextItems.includes(entry)) {
        throw new Error(`条目「${entry}」从上下文移除但未列入 retiredContextItems——退役必须显式声明，漏写拒绝提交`)
      }
    }
    board.context.longTermConstraints = nextConstraints
    board.context.continuityRisks = nextRisks
  }
  if (args.activeCharacters !== undefined) {
    const active = boundedList(args.activeCharacters, '活跃角色', 'activeCharacters')
    for (const name of active) {
      if (board.characters[name] === undefined) {
        throw new Error(`活跃角色 ${name} 没有角色快照——先在 characterSnapshots 提交其完整快照`)
      }
    }
    board.context.activeCharacters = active
  }
  if (mode === 'append') {
    if (typeof args.result !== 'string' || args.result.length === 0) {
      board.context.recentChapters = board.context.recentChapters
    }
    board.context.recentChapters = [
      ...board.context.recentChapters.filter(entry => entry.chapter !== record.chapter),
      { chapter: record.chapter, summary: record.result || record.title || `第 ${record.chapter} 章` },
    ].slice(-MAX_RECENT_CHAPTERS)
    for (const name of record.retiredCharacters) {
      if (board.context.activeCharacters.includes(name)) {
        throw new Error(`角色 ${name} 本章退役，不能同时留在 activeCharacters`)
      }
      delete board.characters[name]
    }
  }
  if (mode === 'revision') {
    const prior = board.context.recentChapters.find(entry => entry.chapter === record.chapter)
    if (prior !== undefined) prior.summary = record.result || prior.summary
  }
  if (mode === 'append' && args.nextChapterCommitments !== undefined) {
    board.context.nextChapterCommitments = stringList(args.nextChapterCommitments)
  }
}

/** Validate snapshot/change pairing and byte ceilings after mutation. */
function validateSnapshots(board, record, args) {
  const problems = []
  for (const change of record.characterChanges) {
    if (record.retiredCharacters.includes(change.name)) continue
    if (board.characters[change.name] === undefined) {
      problems.push(`角色 ${change.name} 有变化但无快照`)
    }
  }
  for (const name of Object.keys(board.characters)) {
    const bytes = snapshotBytes(board.characters[name])
    if (bytes > SNAPSHOT_HARD_BYTES) problems.push(`角色快照 ${name} 序列化 ${bytes} 字节超过硬上限 ${SNAPSHOT_HARD_BYTES}`)
  }
  return problems
}

/** Write the guarded board document, mapping stale-version failures to advice. */
async function commitBoard(fs, cwd, board, version) {
  const target = await fs.resolve(BOARD_FILE, { cwd })
  try {
    await fs.writeText(target, `${JSON.stringify(board, null, 2)}\n`, version !== undefined
      ? { kind: 'replaceIfVersion', version }
      : { kind: 'createIfAbsent' })
  } catch (error) {
    if (error?.code === 'FS_STALE_VERSION') {
      throw new Error('状态板已被其他修改更新过（FS_STALE_VERSION）——先 novel_board_read 重新读取再重试')
    }
    throw error
  }
}

/** Bounded string list with the protocol ceiling enforced before any write. */
function boundedList(value, label, field) {
  const list = stringList(value)
  if (list.length > MAX_CONTEXT_LIST) {
    throw new Error(`${label}最多 ${MAX_CONTEXT_LIST} 条（${field}），实际 ${list.length}——合并语义重叠项或请作者取舍`)
  }
  return list
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`缺少 ${label}`)
  return value
}

/** Normalize a raw character-map argument into canonical snapshot objects. */
function normalizeCharacters(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return Object.fromEntries(Object.entries(source).map(([name, entry]) => [name, {
    identity: typeof entry?.identity === 'string' ? entry.identity : undefined,
    location: typeof entry?.location === 'string' ? entry.location : undefined,
    goal: typeof entry?.goal === 'string' ? entry.goal : undefined,
    state: typeof entry?.state === 'string' ? entry.state : undefined,
    abilities: stringList(entry?.abilities),
    relationships: stringList(entry?.relationships),
    knowledge: stringList(entry?.knowledge),
    openThreads: stringList(entry?.openThreads),
  }]))
}

const wordcountTool = fs => ({
  name: 'novel_wordcount',
  description: '字数测量（纯读，不写任何文件）：读 chapters/ 下的章节文件，按 visible_chars_v1 口径（去 frontmatter 与首个标题后的非空白字符数）计算实际字数，对照目标返回内带 ±12%、用户带 ±15% 与剩余用户区间。写前半段后调用一次做 checkpoint，决定后半段篇幅。',
  parameters: {
    type: 'object',
    properties: {
      file: { type: 'string', description: '章节文件名（chapters/NN-章名.md）或临时段落文件路径' },
      target: { type: 'number', description: '目标字数（正整数）' },
    },
    required: ['file', 'target'],
  },
  output: {
    schema: { type: 'object' },
    render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
  },
  async execute(args, exec) {
    const cwd = requireSessionCwd(exec)
    if (!Number.isInteger(args.target) || args.target < 1) throw new Error('target 必须是正整数')
    const path = typeof args.file === 'string' && args.file.includes('/')
      ? args.file
      : `${CHAPTERS_DIR}/${args.file}`
    const target = await fs.resolve(path, { cwd })
    if (await fs.stat(target) === undefined) throw new Error(`文件不存在：${path}`)
    const body = await fs.readText(target)
    const words = evaluateWordcount(countWords(body), args.target)
    return {
      ...words,
      remainingUserRange: {
        min: Math.max(0, words.userBand.min - words.actual),
        max: Math.max(0, words.userBand.max - words.actual),
      },
    }
  },
})

const MEMORY_KINDS = ['prose_style', 'story_design', 'workflow']

function normalizeMemory(parsed) {
  const state = parsed !== null && typeof parsed === 'object' ? parsed : {}
  const entries = Array.isArray(state.entries) ? state.entries : []
  return {
    formatVersion: 1,
    nextId: typeof state.nextId === 'number' ? state.nextId : entries.length + 1,
    entries: entries.map((entry, index) => ({
      id: typeof entry?.id === 'string' ? entry.id : `m${String(index + 1).padStart(2, '0')}`,
      kind: MEMORY_KINDS.includes(entry?.kind) ? entry.kind : 'workflow',
      statement: typeof entry?.statement === 'string' ? entry.statement : '',
      source: typeof entry?.source === 'string' ? entry.source : '',
      scope: typeof entry?.scope === 'string' ? entry.scope : undefined,
      status: entry?.status === 'pending' ? 'pending' : 'active',
      createdAt: typeof entry?.createdAt === 'string' ? entry.createdAt : undefined,
    })),
  }
}

const memoryTool = fs => ({
  name: 'novel_memory',
  description: '作者记忆：跨作品记录作者明确声明的长期写作习惯（文风偏好/故事设计偏好/工作流偏好）。record 登记声明（须保留原话，返回回执才算记住）；query 按 kind 取 active 条目供写作前参考；confirm 确认待定项；forget 忘掉条目；list 全量查看。一次性要求只执行不记录；事实写进作品文件，不进作者记忆。',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['record', 'query', 'confirm', 'forget', 'list'], description: '要执行的记忆操作' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'record/query：记忆类别' },
      statement: { type: 'string', description: 'record：习惯内容（转述）' },
      source: { type: 'string', description: 'record：作者原话' },
      scope: { type: 'string', description: 'record：适用范围（如 本书/全部短篇），可省' },
      pending: { type: 'boolean', description: 'record：true 时登记为待确认（重复修正/推断）；默认 active' },
      id: { type: 'string', description: 'confirm/forget：记忆条目 id' },
      kinds: { type: 'array', items: { type: 'string', enum: MEMORY_KINDS }, description: 'query：按类别过滤' },
    },
    required: ['action'],
  },
  output: {
    schema: { type: 'object' },
    render: (_args, value) => textBlock(JSON.stringify(value, null, 2)),
  },
  async execute(args, exec) {
    const cwd = requireSessionCwd(exec)
    const target = await fs.resolve(MEMORY_FILE, { cwd })
    const stat = await fs.stat(target)
    const state = normalizeMemory(stat === undefined ? null : JSON.parse(await fs.readText(target)))
    if (args.action === 'query' || args.action === 'list') {
      const kinds = args.action === 'query'
        ? (Array.isArray(args.kinds) ? args.kinds.filter(kind => MEMORY_KINDS.includes(kind)) : MEMORY_KINDS)
        : MEMORY_KINDS
      const entries = state.entries.filter(entry => entry.status === 'active' && kinds.includes(entry.kind))
      return {
        entries: entries.map(({ id, kind, statement, scope }) => ({ id, kind, statement, scope })),
        pendingCount: state.entries.filter(entry => entry.status === 'pending').length,
      }
    }
    if (args.action === 'record') {
      const statement = requireString(args.statement, 'statement（习惯内容）')
      const source = requireString(args.source, 'source（作者原话）')
      const kind = MEMORY_KINDS.includes(args.kind) ? args.kind : undefined
      if (kind === undefined) throw new Error('record 需要 kind（prose_style/story_design/workflow）')
      const id = `m${String(state.nextId).padStart(2, '0')}`
      state.nextId += 1
      state.entries.push({
        id,
        kind,
        statement,
        source,
        scope: typeof args.scope === 'string' ? args.scope : undefined,
        status: args.pending === true ? 'pending' : 'active',
        createdAt: new Date().toISOString().slice(0, 10),
      })
      await commitMemory(fs, cwd, state, target, stat?.version)
      return { receipt: `Author Memory Receipt`, id, status: args.pending === true ? 'pending' : 'active', message: `已记录作者习惯 ${id}（${kind}${args.pending === true ? '，待确认' : ''}）：${statement}` }
    }
    const entry = state.entries.find(candidate => candidate.id === args.id)
    if (entry === undefined) throw new Error(`记忆条目 ${String(args.id)} 不存在——先 list 查看`)
    if (args.action === 'confirm') {
      entry.status = 'active'
      await commitMemory(fs, cwd, state, target, stat?.version)
      return { receipt: 'Author Memory Receipt', id: entry.id, status: 'active', message: `已确认 ${entry.id}` }
    }
    state.entries = state.entries.filter(candidate => candidate.id !== entry.id)
    await commitMemory(fs, cwd, state, target, stat?.version)
    return { receipt: 'Author Memory Receipt', id: entry.id, status: 'forgotten', message: `已忘掉 ${entry.id}：${entry.statement}` }
  },
})

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

export const name = 'novelist-tools'

export const inject = ['tools', 'fs']

/**
 * Register the six novel tools into this preset's scoped tools layer.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const tools = ctx.tools
  if (tools === undefined) {
    throw new Error('novelist-tools: the tools registry is required')
  }
  const fs = ctx.fs
  ctx.effect(() => {
    const definitions = [
      scaffoldTool(fs),
      boardReadTool(fs),
      boardUpdateTool(fs),
      trackingTool(fs),
      wordcountTool(fs),
      memoryTool(fs),
    ]
    const disposers = definitions.map(definition => tools.register(definition))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'novelist-tools: scaffold / board / tracking / wordcount / memory')
}
