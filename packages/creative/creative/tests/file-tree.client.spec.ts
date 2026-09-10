import { describe, expect, it } from 'vitest'
import { buildFileTree } from '../src/client/file-tree.js'

describe('file tree', () => {
  it('preserves arbitrarily deep project directories', () => {
    const tree = buildFileTree([
      { path: '剧集/EP001/screenplay.md', bytes: 120 },
      { path: '剧集/EP001/分镜/shots.jsonl', bytes: 240 },
      { path: '剧集/EP002/screenplay.md', bytes: 100 },
    ], '剧集')

    expect(tree).toEqual([
      {
        kind: 'directory',
        name: 'EP001',
        path: '剧集/EP001',
        fileCount: 2,
        children: [
          {
            kind: 'directory',
            name: '分镜',
            path: '剧集/EP001/分镜',
            fileCount: 1,
            children: [{ kind: 'file', name: 'shots.jsonl', path: '剧集/EP001/分镜/shots.jsonl', bytes: 240 }],
          },
          { kind: 'file', name: 'screenplay.md', path: '剧集/EP001/screenplay.md', bytes: 120 },
        ],
      },
      {
        kind: 'directory',
        name: 'EP002',
        path: '剧集/EP002',
        fileCount: 1,
        children: [{ kind: 'file', name: 'screenplay.md', path: '剧集/EP002/screenplay.md', bytes: 100 }],
      },
    ])
  })

  it('keeps group-level files such as short-drama.json', () => {
    expect(buildFileTree([{ path: 'short-drama.json', bytes: 42 }], '项目')).toEqual([
      { kind: 'file', name: 'short-drama.json', path: 'short-drama.json', bytes: 42 },
    ])
  })
})
