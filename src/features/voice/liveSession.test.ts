import { beforeEach, describe, expect, it } from 'vitest'
import { createLiveSession, resetLiveSessionForTests } from './liveSession'

const speech = (length = 1600) => new Float32Array(length).fill(0.04)

describe('live voice session', () => {
  beforeEach(resetLiveSessionForTests)

  it('commits after a pause and returns the utterance audio', () => {
    const session = createLiveSession('Plan')
    session.pushAudio(speech(), 16000, 0.02, 10)
    const action = session.nextAction(610, false)
    expect(action.type).toBe('commit')
    if (action.type === 'commit') expect(action.audio).toHaveLength(1600)
  })

  it('commits at the maximum utterance length', () => {
    const session = createLiveSession('')
    session.pushAudio(speech(), 16000, 0.02, 0)
    expect(session.nextAction(8000, false).type).toBe('commit')
  })

  it('discards empty utterances', () => {
    const session = createLiveSession('')
    session.pushAudio(new Float32Array(16000), 16000, 0, 0)
    expect(session.nextAction(8000, false).type).toBe('none')
    expect(session.finish(9000)).toEqual([])
  })

  it('ignores a draft after its utterance was committed', () => {
    const session = createLiveSession('')
    session.pushAudio(speech(14400), 16000, 0.02, 0)
    const draft = session.nextAction(0, false)
    expect(draft.type).toBe('draft')
    session.pushAudio(speech(1), 16000, 0.02, 100)
    const commit = session.nextAction(700, false)
    expect(commit.type).toBe('commit')
    if (draft.type === 'draft') session.onDraftResult(draft.utteranceId, draft.seq, 'stale', 20)
    expect(session.getText()).toBe('')
  })

  it('ignores older draft sequences', () => {
    const session = createLiveSession('')
    session.pushAudio(speech(14400), 16000, 0.02, 0)
    const oldDraft = session.nextAction(0, false)
    session.pushAudio(speech(14400), 16000, 0.02, 600)
    const newDraft = session.nextAction(600, false)
    if (oldDraft.type !== 'draft' || newDraft.type !== 'draft') throw new Error('expected draft actions')
    session.onDraftResult(oldDraft.utteranceId, oldDraft.seq, 'old text', 10)
    expect(session.getText()).toBe('')
    session.onDraftResult(newDraft.utteranceId, newDraft.seq, 'new text', 10)
    expect(session.getText()).toBe('new text')
  })

  it('assembles base, committed, and draft text without duplicate spaces', () => {
    const session = createLiveSession('  existing task  ')
    session.pushAudio(speech(), 16000, 0.02, 0)
    const final = session.finish(100)
    expect(final).toHaveLength(1)
    session.onFinalResult(final[0].utteranceId, '  call the dentist  ')
    expect(session.getText()).toBe('existing task call the dentist')
    session.pushAudio(speech(14400), 16000, 0.02, 1000)
    const draft = session.nextAction(1000, false)
    if (draft.type === 'draft') session.onDraftResult(draft.utteranceId, draft.seq, 'tomorrow', 50)
    expect(session.getText()).toBe('existing task call the dentist tomorrow')
  })

  it('caps the assembled title at 500 characters', () => {
    const session = createLiveSession('x'.repeat(498))
    session.pushAudio(speech(14400), 16000, 0.02, 0)
    const draft = session.nextAction(0, false)
    if (draft.type === 'draft') session.onDraftResult(draft.utteranceId, draft.seq, 'long text', 10)
    expect(session.getText()).toHaveLength(500)
  })

  it('disables drafts after three consecutive slow inferences', () => {
    const session = createLiveSession('')
    for (let index = 0; index < 3; index++) {
      const now = index * 700
      session.pushAudio(speech(14400), 16000, 0.02, now)
      const action = session.nextAction(now, false)
      if (action.type === 'draft') session.onDraftResult(action.utteranceId, action.seq, 'draft', 901)
    }
    expect(session.draftsEnabled()).toBe(false)
  })

  it('does not draft while another inference is active', () => {
    const session = createLiveSession('')
    session.pushAudio(speech(14400), 16000, 0.02, 0)
    expect(session.nextAction(0, true).type).toBe('none')
  })

  it('waits for enough speech before creating an early draft', () => {
    const session = createLiveSession('')
    session.pushAudio(speech(6400), 16000, 0.02, 0)
    expect(session.nextAction(500, false).type).toBe('none')
    session.pushAudio(speech(8000), 16000, 0.02, 500)
    expect(session.nextAction(500, false).type).toBe('draft')
  })

  it('reveals only words repeated by consecutive draft transcriptions', () => {
    const session = createLiveSession('')
    session.pushAudio(speech(14400), 16000, 0.02, 0)
    const first = session.nextAction(0, false)
    if (first.type !== 'draft') throw new Error('expected first draft')
    session.onDraftResult(first.utteranceId, first.seq, 'call the dentist tomorrow', 50)
    expect(session.getStableText()).toBe('')

    session.pushAudio(speech(6400), 16000, 0.02, 600)
    const second = session.nextAction(600, false)
    if (second.type !== 'draft') throw new Error('expected second draft')
    session.onDraftResult(second.utteranceId, second.seq, 'call the dentist tomorrow morning', 50)
    expect(session.getStableText()).toBe('call the dentist tomorrow')
  })
})
