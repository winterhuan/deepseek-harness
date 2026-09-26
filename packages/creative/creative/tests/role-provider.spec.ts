import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CREATIVE_ROLE_NAMES, loadBundledRole } from '../src/role-provider.js'

describe('bundled Creative roles', () => {
  it('loads all seven upstream role definitions as DSH personas', async () => {
    expect(CREATIVE_ROLE_NAMES).toHaveLength(7)
    const root = resolve(import.meta.dirname, '../knowledge/creative/roles')
    for (const name of CREATIVE_ROLE_NAMES) {
      const source = await readFile(resolve(root, `${name}.md`), 'utf8')
      const persona = await loadBundledRole(name, root)
      expect(persona).toContain(`CREATIVE_DSH_ROLE:${name}`)
      expect(persona).toContain('Do not read or write project files')
      expect(persona).toContain(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '').trim())
      expect(persona).not.toMatch(/Agent\(subagent_type|\.claude\/skills/u)
    }
  })

  it('adapts the same exact role body for native DSH tool execution', async () => {
    const persona = await loadBundledRole('narrative-writer', resolve(import.meta.dirname, '../knowledge/creative/roles'), 'native-tools')
    expect(persona).toContain('current DSH workspace and visible tool set')
    expect(persona).toContain('call creative_bundled_reference with the exact story-setup/references/agent-references path')
    expect(persona).toContain('Never call the generic skill tool')
    expect(persona).toContain('fall back to a legacy platform path')
    expect(persona).not.toContain('do not call tools')
  })

  it('keeps the updated benchmark-book failure distinction', async () => {
    const persona = await loadBundledRole('story-explorer', resolve(import.meta.dirname, '../knowledge/creative/roles'), 'native-tools')
    expect(persona).toContain('benchmark_book_missing: true')
    expect(persona).toContain('profile_missing: true')
    expect(persona).toContain('expected_path')
  })

  it('routes external research through native web tools without a preset browser port', async () => {
    const persona = await loadBundledRole('story-researcher', undefined, 'native-tools')
    expect(persona).toContain('`web_search`')
    expect(persona).toContain('`web_fetch`')
    expect(persona).not.toMatch(/WebSearch|webReader|9222|--cdp/u)
  })

  it('keeps chapter retries within the inherited DSH model', async () => {
    const persona = await loadBundledRole('chapter-extractor', undefined, 'native-tools')
    expect(persona).not.toMatch(/\b(?:sonnet|haiku|opus)\b/u)
  })
})
