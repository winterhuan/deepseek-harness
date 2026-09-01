import { describe, expect, it } from 'vitest'
import { WorkspaceVerificationTracker } from '../src/verification-tracker.js'

describe('WorkspaceVerificationTracker', () => {
  it('returns UNBOUND on first observation', () => {
    const tracker = new WorkspaceVerificationTracker()
    expect(tracker.observe('key', undefined, 'v1')).toEqual({ binding: 'UNBOUND' })
  })

  it('binds when a verification version appears', () => {
    const tracker = new WorkspaceVerificationTracker()
    tracker.observe('key', undefined, 'v1')
    expect(tracker.observe('key', 'rev1', 'v1')).toEqual({ binding: 'CURRENT', verifiedPreviewVersion: 'v1' })
  })

  it('returns UNBOUND when verification version is missing after binding', () => {
    const tracker = new WorkspaceVerificationTracker()
    tracker.observe('key', 'rev1', 'v1')
    expect(tracker.observe('key', undefined, 'v2')).toEqual({ binding: 'UNBOUND' })
  })

  it('marks STALE when preview changes but verification does not', () => {
    const tracker = new WorkspaceVerificationTracker()
    tracker.observe('key', 'rev1', 'v1')
    expect(tracker.observe('key', 'rev1', 'v2')).toEqual({ binding: 'STALE', verifiedPreviewVersion: 'v1' })
  })

  it('remains CURRENT when both versions stay the same', () => {
    const tracker = new WorkspaceVerificationTracker()
    tracker.observe('key', 'rev1', 'v1')
    expect(tracker.observe('key', 'rev1', 'v1')).toEqual({ binding: 'CURRENT', verifiedPreviewVersion: 'v1' })
  })
})
