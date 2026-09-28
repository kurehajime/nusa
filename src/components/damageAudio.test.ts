import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDamageAudio } from './damageAudio'

const setup = () => {
  const source = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  const context = {
    state: 'running', currentTime: 10, destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    decodeAudioData: vi.fn(async () => ({})),
    createBufferSource: vi.fn(() => ({ ...source })),
  }
  vi.stubGlobal('AudioContext', vi.fn(function () { return context }))
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
  return { context, source }
}

afterEach(() => vi.unstubAllGlobals())

describe('damage audio playback', () => {
  it('waits for the first user gesture to finish resuming audio', async () => {
    const { context, source } = setup()
    context.state = 'suspended'
    let finishResume!: () => void
    context.resume.mockImplementation(() => new Promise<void>(resolve => { finishResume = resolve }))
    const audio = createDamageAudio()
    audio.play('player', 250)
    expect(source.start).not.toHaveBeenCalled()
    context.state = 'running'
    finishResume()
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10.25))
    audio.dispose()
  })

  it('cancels a delayed impact when combat disappears before playback', async () => {
    const { source } = setup()
    const audio = createDamageAudio()
    const cancel = audio.play('player', 250)
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10.25))
    cancel()
    expect(source.stop).toHaveBeenCalledOnce()
    audio.dispose()
  })

  it('lets a playing clip finish at combat resolution and stops it on unmount', async () => {
    const { source } = setup()
    const audio = createDamageAudio()
    const cancel = audio.play('normal', 0)
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10))
    cancel()
    expect(source.stop).not.toHaveBeenCalled()
    audio.dispose()
    expect(source.stop).toHaveBeenCalledOnce()
  })

  it('does not replay a cancelled impact after audio decoding finishes', async () => {
    const { context, source } = setup()
    const audio = createDamageAudio()
    audio.play('normal', 0)()
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce())
    expect(source.start).not.toHaveBeenCalled()
    audio.dispose()
  })
})
