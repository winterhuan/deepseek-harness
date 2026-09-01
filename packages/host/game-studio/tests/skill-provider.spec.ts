import { describe, expect, it } from 'vitest'
import { createNovelToGameSkillProvider, parseBundledSkill } from '../src/skill-provider.js'

describe('parseBundledSkill', () => {
  it('parses frontmatter name and description', () => {
    const source = '---\nname: test-skill\ndescription: A test skill.\n---\n# Body\n'
    const skill = parseBundledSkill(source)
    expect(skill.name).toBe('test-skill')
    expect(skill.description).toBe('A test skill.')
    expect(skill.content).toContain('# Body')
  })

  it('rejects missing frontmatter', () => {
    expect(() => parseBundledSkill('# Body\n')).toThrow('missing YAML frontmatter')
  })

  it('rejects invalid name', () => {
    expect(() => parseBundledSkill('---\nname: Test Skill\n---\n')).toThrow('invalid name')
  })
})

describe('createNovelToGameSkillProvider', () => {
  it('lists bundled skills', async () => {
    const provider = createNovelToGameSkillProvider()
    const observation = await provider.list({})
    const list = 'candidates' in observation ? observation.candidates : observation
    expect(list.map(skill => skill.name)).toContain('novel-to-game')
    expect(list.map(skill => skill.name)).toContain('game-build')
  })

  it('loads a bundled skill with DSH bridge', async () => {
    const provider = createNovelToGameSkillProvider()
    const observation = await provider.list({})
    const list = 'candidates' in observation ? observation.candidates : observation
    const novelToGame = list.find(skill => skill.name === 'novel-to-game')
    expect(novelToGame).toBeDefined()
    const definition = await provider.get(novelToGame!, {})
    expect(definition).toBeDefined()
    expect(definition!.content).toContain('<novel-to-game-dsh-integration>')
  })
})
