/** Package stylesheet discovery includes product source, not isolated examples or artifacts. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageStylesheets } from './stylesheet-scan.ts'

describe('package stylesheet discovery', () => {
  it('includes source styles across package groups and excludes non-source CSS', () => {
    const packagesDir = mkdtempSync(join(tmpdir(), 'dsh-stylesheet-scan-'))
    const sourcePaths = ['client/theme/src/styles/theme.css', 'creative/workbench/src/client/panel.css']
    const excludedPaths = [
      'creative/workbench/knowledge/game/examples/style.css',
      'client/theme/lib/theme.css',
      'client/theme/dist/theme.css',
      'client/theme/node_modules/dependency/style.css',
      'client/theme/tests/fixtures/example.css',
      'client/theme/style.css',
    ]
    try {
      for (const path of [...sourcePaths, ...excludedPaths]) {
        const absolutePath = join(packagesDir, path)
        mkdirSync(dirname(absolutePath), { recursive: true })
        writeFileSync(absolutePath, '.pill { border-radius: 999px; }\n')
      }
      expect(packageStylesheets(packagesDir).sort()).toEqual(sourcePaths.map(path => join(packagesDir, path)).sort())
    } finally {
      rmSync(packagesDir, { recursive: true, force: true })
    }
  })

  it('keeps the repository theme source in the scanned corpus', () => {
    expect(packageStylesheets()).toContain(fileURLToPath(new URL('../src/styles/corner-shape.css', import.meta.url)))
  })
})
