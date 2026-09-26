import { describe, expect, it } from 'vitest'
import { runVideoPreflight, videoPreflight, type PreflightCommandRunner } from '../src/workspace-route.js'

const PROBE_OUTPUTS = {
  'python3 --version': 'Python 3.11.4',
  'ffmpeg -version': 'ffmpeg version 6.0 Copyright',
  'ffmpeg -hide_banner -filters': ' ... subtitles ... ',
  'ffprobe -version': 'ffprobe version 6.0',
} as const

function runner(outputs: Partial<Record<string, string>>): { readonly run: PreflightCommandRunner; readonly calls: string[] } {
  const calls: string[] = []
  const run: PreflightCommandRunner = async (command, args) => {
    const key = [command, ...args].join(' ')
    calls.push(key)
    return outputs[key]
  }
  return { run, calls }
}

describe('video preflight probe', () => {
  it('maps successful probes and producer credentials into the summary', async () => {
    const probe = runner(PROBE_OUTPUTS)
    const summary = await runVideoPreflight(probe.run, { MIMO_API_KEY: 'present', TTS_PROVIDER: 'fish' })
    expect(summary.python).toEqual({ ok: true, version: '3.11.4' })
    expect(summary.ffmpeg).toEqual({ ok: true, subtitles: true })
    expect(summary.ffprobe).toEqual({ ok: true })
    expect(summary.credentials).toEqual({ mimo: true, fish: false, ttsProvider: 'fish' })
  })

  it('falls back from python3 to python and reports absent tools as not ok', async () => {
    const probe = runner({
      'python --version': 'Python 3.9.7',
      'ffmpeg -version': 'ffmpeg version 6.0',
      'ffmpeg -hide_banner -filters': ' ... atrim ... ',
    })
    const summary = await runVideoPreflight(probe.run, {})
    expect(probe.calls[0]).toBe('python3 --version')
    expect(probe.calls[1]).toBe('python --version')
    expect(summary.python).toEqual({ ok: false, version: '3.9.7' })
    expect(summary.ffmpeg).toEqual({ ok: true, subtitles: false })
    expect(summary.ffprobe).toEqual({ ok: false })
    expect(summary.credentials).toEqual({ mimo: false, fish: false, ttsProvider: 'mimo' })
  })
})

describe('video preflight cache', () => {
  it('serves repeated requests within 30 seconds and re-probes after expiry', async () => {
    let clock = 1_000
    const now = () => clock
    const probe = runner(PROBE_OUTPUTS)
    const first = await videoPreflight(probe.run, now)
    const second = await videoPreflight(probe.run, now)
    expect(second).toBe(first)
    expect(probe.calls).toHaveLength(4)
    clock = 31_500
    const third = await videoPreflight(probe.run, now)
    expect(third).not.toBe(first)
    expect(probe.calls).toHaveLength(8)
  })
})
