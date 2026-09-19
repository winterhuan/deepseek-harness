import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createDramaSkillProvider, createNovelToGameSkillProvider, createCreativeSkillProvider, createVideoRecapSkillProvider, parseBundledSkill } from '../src/skill-provider.ts'

const skillRoot = resolve(import.meta.dirname, '../knowledge/creative/skills')
const dramaRoot = resolve(import.meta.dirname, '../knowledge/drama/skills')
const gameRoot = resolve(import.meta.dirname, '../knowledge/novel-to-game/skills')
const videoRoot = resolve(import.meta.dirname, '../knowledge/video-recap/skills')

describe.each([
  { name: 'creative', create: createCreativeSkillProvider, root: skillRoot, skillName: 'story', count: 13 },
  { name: 'short-drama', create: createDramaSkillProvider, root: dramaRoot, skillName: 'short-drama', count: 10 },
  { name: 'novel-to-game', create: createNovelToGameSkillProvider, root: gameRoot, skillName: 'novel-to-game', count: 7 },
  { name: 'video-recap', create: createVideoRecapSkillProvider, root: videoRoot, skillName: 'video-recap', count: 6 },
])('$name skill source', ({ create, root, skillName, count }) => {
  it('serves every file body unchanged after shared integration context', async () => {
    const provider = create(root)
    const candidates = await provider.list({})
    if (!Array.isArray(candidates)) throw new Error('Expected a complete bundled catalog.')
    expect(candidates).toHaveLength(count)
    for (const candidate of candidates) {
      const source = parseBundledSkill(await readFile(resolve(root, candidate.name, 'SKILL.md'), 'utf8'))
      const skill = await provider.get(candidate, {})
      expect(skill?.description).toBe(source.description)
      expect(skill?.content).toContain('load each one with the skill tool')
      expect(skill?.content).toContain('creative_role accepts only the novel specialist names in its role enum')
      expect(candidate.description.length).toBeLessThanOrEqual(500)
      expect(skill?.content.replace(/^<[\w-]+-dsh-integration>[\s\S]*?<\/[\w-]+-dsh-integration>\n\n/u, ''))
        .toBe(source.content)
    }
  })

  it('reads edits to a named skill instead of substituting a runtime body', async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'dsh-creative-skills-'))
    onTestFinished(() => rm(temporaryRoot, { recursive: true, force: true }))
    const directory = resolve(temporaryRoot, skillName)
    await mkdir(directory)
    const path = resolve(directory, 'SKILL.md')
    await writeFile(path, `---\nname: ${skillName}\ndescription: original description\n---\n# Original instructions\n`)
    const provider = create(temporaryRoot)
    const candidates = await provider.list({})
    if (!Array.isArray(candidates)) throw new Error('Expected a complete bundled catalog.')
    expect(candidates).toHaveLength(1)
    const original = await provider.get(candidates[0]!, {})
    expect(original?.content).toContain('# Original instructions\n')
    await writeFile(path, `---\nname: ${skillName}\ndescription: updated description\n---\n# Updated instructions\n`)
    const updated = await provider.get(candidates[0]!, {})
    expect(updated?.description).toBe('updated description')
    expect(updated?.content).toBe(original?.content.replace('# Original instructions\n', '# Updated instructions\n'))
    expect(updated?.resourceBase).toEqual({ kind: 'directory', path: directory })
  })
})

describe('Creative bundled skill provider', () => {
  it('publishes the complete capability catalog with shared DSH context', async () => {
    const provider = createCreativeSkillProvider(skillRoot)
    const listed = await provider.list({})
    if (!Array.isArray(listed)) throw new Error('Expected a complete bundled catalog.')
    const candidates = listed
    expect(candidates).toHaveLength(13)
    expect(candidates.map(candidate => candidate.name)).toContain('story-long-write')
    expect(candidates.every(candidate => candidate.source === 'bundled' && candidate.invocation.modelInvocable)).toBe(true)
    const selected = candidates.find(candidate => candidate.name === 'story-long-write')
    expect(selected).toBeDefined()
    const skill = await provider.get(selected!, {})
    expect(skill?.content).toContain('# story-long-write')
    expect(skill?.content).toContain('creative_role')
    expect(skill?.content).toContain('DSH owns the workspace, model, preset, permissions, Session Log')
    for (const platformPath of ['.claude/agents', '.codex/agents', '.opencode/agents', '.agents/agents', 'invoke_subagent']) {
      expect(skill?.content).not.toContain(platformPath)
    }
    expect(skill?.content).toContain('章节 Reference Gate')
    const workflowSetup = await readFile(resolve(skillRoot, 'story-long-write/references/workflow-setup.md'), 'utf8')
    expect(workflowSetup).toContain('| # | 情节点（谁做了什么） | 功能标签 | 执行边界 |')
    expect(skill?.content.startsWith('---')).toBe(false)
    const setupCandidate = candidates.find(candidate => candidate.name === 'story-setup')
    const setup = await provider.get(setupCandidate!, {})
    expect(setup?.content).toContain('只初始化或校验当前 DSH workspace')
    expect(setup?.content).not.toContain('merge-codex-hooks.py')
    expect(setup?.resourceBase).toEqual({ kind: 'directory', path: resolve(skillRoot, 'story-setup') })
    for (const reference of ['character-basics.md', 'long-quality.md', 'short-quality.md', 'writing-craft.md', 'outline-methods.md']) {
      await expect(readFile(resolve(skillRoot, 'story-setup/references/agent-references', reference), 'utf8'))
        .resolves.toMatch(/\S/u)
    }
    const renderedSetup = renderSkillContent(setup!)
    expect(renderedSetup).toContain('<skill_resources>')
    expect(renderedSetup).toContain(`Base directory for this skill: ${resolve(skillRoot, 'story-setup')}`)
    const routeCandidate = candidates.find(candidate => candidate.name === 'story')
    const route = await provider.get(routeCandidate!, {})
    expect(route?.content).toContain('小说文件通过"小说"视图查看')
    expect(route?.content).toContain('跨域改编')
    const importCandidate = candidates.find(candidate => candidate.name === 'story-import')
    const imported = await provider.get(importCandidate!, {})
    expect(imported?.content).toContain('export_novel_txt.py')
    expect(imported?.content).toContain('record_lineage.py')
    expect(routeCandidate?.description).toContain('记住我的写作习惯')
    expect(route?.content).toContain('scripts/author_memory_commit.py')
    await expect(readFile(resolve(skillRoot, 'story/scripts/author_memory_commit.py'), 'utf8')).resolves.toMatch(/\S/u)
    expect(route?.content).not.toContain('dashboard-server.mjs')
    const browserCandidate = candidates.find(candidate => candidate.name === 'browser-cdp')
    const browser = await provider.get(browserCandidate!, {})
    expect(browser?.description).toContain('Lightpanda')
    expect(browser?.content).toContain('--engine lightpanda')
    expect(browser?.content).toContain('--session "$BROWSER_SESSION"')
    expect(browser?.content).not.toContain('setup-cdp-chrome.js')
    for (const name of ['story-long-scan', 'story-short-scan']) {
      const candidate = candidates.find(value => value.name === name)
      const scan = await provider.get(candidate!, {})
      expect(scan?.content).toContain('browser-cdp')
      expect(scan?.content).toContain('当前 DSH Preset 可见的网页工具')
      expect(scan?.content).not.toContain('rank-scraper.js')
      expect(scan?.content).not.toContain('WebFetch')
      expect(scan?.content).not.toContain('Bearer token')
    }
  })

  it('rejects missing frontmatter', () => {
    expect(() => parseBundledSkill('# no metadata')).toThrow(/frontmatter/u)
  })

  it('parses folded YAML descriptions and user invocation metadata', () => {
    const parsed = parseBundledSkill('---\nname: folded-skill\nuser-invocable: false\ndescription: >\n first line\n second line\n---\n# Body\n')
    expect(parsed.description).toBe('first line second line')
    expect(parsed.userInvocable).toBe(false)
  })

  it('rejects candidate paths outside the packaged skill root', async () => {
    const provider = createCreativeSkillProvider(skillRoot)
    await expect(provider.get({
      name: 'story-long-write',
      description: 'invalid external candidate',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'creative',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resolve(skillRoot, '..') },
      rank: 0,
      locator: new URL('file:///tmp/SKILL.md'),
      path: resolve(skillRoot, '../SKILL.md'),
    }, {})).rejects.toThrow(/escaped/u)
  })
})

describe('Drama Skills bundled provider', () => {
  it('publishes the complete upstream short-drama workflow through DSH', async () => {
    const provider = createDramaSkillProvider(dramaRoot)
    const listed = await provider.list({})
    if (!Array.isArray(listed)) throw new Error('Expected a complete Drama Skills catalog.')
    expect(listed).toHaveLength(10)
    expect(listed.map(candidate => candidate.name)).toEqual(expect.arrayContaining([
      'short-drama', 'short-drama-develop', 'short-drama-write', 'short-drama-storyboard', 'short-drama-produce',
    ]))
    for (const candidate of listed) {
      const skill = await provider.get(candidate, {})
      expect(skill?.content).toContain('each episode keeps only the requested documents, up to five creator-facing sources')
      expect(skill?.content).toContain('Never precreate empty documents, backfill nominal stages, or start work the creator did not request')
      expect(skill?.content).toContain('an oral review writes nothing')
      expect(skill?.content).toContain('never create a parallel JSON/JSONL lifecycle truth')
      expect(skill?.content).toContain('Never upgrade a v0.5 structured project in place')
    }
    const routeCandidate = listed.find(candidate => candidate.name === 'short-drama')
    const route = await provider.get(routeCandidate!, {})
    expect(route?.content).toContain('使用当前 DSH 会话的「短剧」视图')
    expect(route?.content).toContain('each episode keeps only the requested documents, up to five creator-facing sources')
    expect(route?.content).toContain('剧集/<EP>/剧本.md, 视觉设定.md, 分镜.md, 图片提示词.md, and 视频提示词.md')
    expect(route?.content).toContain('never create a parallel JSON/JSONL lifecycle truth')
    expect(route?.content).toContain('Never upgrade a v0.5 structured project in place')
    expect(route?.content).toContain('新项目只创建当前请求需要的 v0.6 creator-first 文档')
    expect(route?.content).toContain('不建立并行的结构化创作真相')
    const reviewCandidate = listed.find(candidate => candidate.name === 'short-drama-review')
    const review = await provider.get(reviewCandidate!, {})
    expect(review?.content).toContain('审查/EP001-审查.md')
    const productionCandidate = listed.find(candidate => candidate.name === 'short-drama-produce')
    const production = await provider.get(productionCandidate!, {})
    expect(production?.content).toContain('看到这份预览之后')
    expect(production?.content).toContain('`job_id` 来自 `prepare`')
    expect(production?.content).toContain('消费一次确认')
    expect(production?.content).not.toContain('"stdin":')
    for (const provider of ['gpt-image-2', 'minimax-h3-video', 'minimax-music', 'seedance']) {
      const reference = await readFile(resolve(dramaRoot, `short-drama-produce/references/providers/${provider}.md`), 'utf8')
      expect(reference).toContain('"job_id":')
      expect(reference).not.toContain('"stdin":')
    }
    expect(production?.content).toContain('一旦消费，无论成功或失败，再次执行都必须重新确认')
    expect(production?.content).toContain('不调用供应商、不消费确认，也不写入生产尝试')
    expect(production?.content).toContain('必须使用真实 `jobId` 与已确认的 `requestId`')
    expect(production?.content).toContain('当前 Markdown')
    expect(production?.content).toContain('剧集/<EP>/制作成果/')
    const novelCandidate = listed.find(candidate => candidate.name === 'short-drama-novel-analyze')
    const novel = await provider.get(novelCandidate!, {})
    expect(novel?.content).toContain('scripts/export_novel_txt.py')
    expect(novel?.content).toContain('章节映射')
    expect(novel?.content).toContain('record_lineage.py')
    expect(novel?.content).toContain('正文.md')
  })
})

describe('NovelToGame bundled provider', () => {
  it('publishes the complete seven-Skill playable adaptation pipeline through DSH', async () => {
    const provider = createNovelToGameSkillProvider(gameRoot)
    const listed = await provider.list({})
    if (!Array.isArray(listed)) throw new Error('Expected a complete NovelToGame catalog.')
    expect(listed.map(candidate => candidate.name)).toEqual([
      'game-art-direction',
      'game-build',
      'game-concept',
      'game-qa',
      'game-world-design',
      'novel-game-analyze',
      'novel-to-game',
    ])
    for (const candidate of listed) {
      const skill = await provider.get(candidate, {})
      expect(skill?.content).toContain('The 游戏 tab is the playable Game Studio')
      expect(skill?.content).toContain('game-adaptations/<project>/')
      expect(skill?.content).toContain('qa/verification.json remains the sole machine QA truth')
      expect(skill?.content).toContain('Adapt games from the novel')
      expect(skill?.content).toContain('record_lineage.py')
      expect(skill?.resourceBase).toEqual({ kind: 'directory', path: resolve(gameRoot, candidate.name) })
    }
    const route = await provider.get(listed.find(candidate => candidate.name === 'novel-to-game')!, {})
    expect(route?.content).toContain('# NovelToGame 总入口')
    expect(route?.content).toContain('quick')
    expect(route?.content).toContain('director')
    expect(route?.content).toContain('resume')
    const qa = await provider.get(listed.find(candidate => candidate.name === 'game-qa')!, {})
    for (const check of ['launch', 'render', 'input', 'coreLoop', 'outcome', 'restart']) {
      expect(qa?.content).toContain(check)
    }
  })
})

describe('video-recap bundled provider', () => {
  it('publishes the complete six-Skill pipeline with native DSH boundaries', async () => {
    const provider = createVideoRecapSkillProvider(videoRoot)
    const listed = await provider.list({})
    if (!Array.isArray(listed)) throw new Error('Expected a complete video-recap catalog.')
    expect(listed.map(candidate => candidate.name)).toEqual([
      'video-assemble',
      'video-cut',
      'video-recap',
      'video-script',
      'video-understanding',
      'video-voiceover',
    ])
    expect(listed.find(candidate => candidate.name === 'video-recap')?.invocation.userInvocable).toBe(true)
    expect(listed.find(candidate => candidate.name === 'video-cut')?.invocation.userInvocable).toBe(false)
    expect(listed.find(candidate => candidate.name === 'video-understanding')?.description).toContain('结构化理解索引')
    for (const candidate of listed) {
      const skill = await provider.get(candidate, {})
      expect(skill?.content).toContain('The Video Studio is a preview and artifact surface')
      expect(skill?.content).toContain('video-recaps/<project>/')
      expect(skill?.content).toContain('MIMO_API_KEY, FISH_API_KEY')
      expect(skill?.content).toContain('Short-drama production outputs are ready recap sources')
      expect(skill?.content).toContain('record_lineage.py')
      expect(skill?.resourceBase).toEqual({ kind: 'directory', path: resolve(videoRoot, candidate.name) })
    }
  })
})
