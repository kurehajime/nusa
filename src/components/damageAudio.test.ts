import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_DECK_IDS } from '../game/themeDecks'
import { createDamageAudio } from './damageAudio'

const setup = () => {
  const source = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  const context = {
    state: 'running', currentTime: 10, destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    decodeAudioData: vi.fn(async () => ({})),
    createGain: vi.fn(() => ({
      gain: { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(),
    })),
    createBufferSource: vi.fn(() => ({ ...source })),
  }
  vi.stubGlobal('AudioContext', vi.fn(function () { return context }))
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })))
  return { context, source }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('damage audio playback', () => {
  it.each(Object.values(THEME_DECK_IDS))('loops the deck track (%s) and fades it out without muting result effects', async (deckId) => {
    const { context } = setup()
    const audio = createDamageAudio(deckId)
    audio.setMusicPlaying(true, 800)
    await vi.waitFor(() => expect(context.createBufferSource).toHaveBeenCalledOnce())
    const music = context.createBufferSource.mock.results[0].value
    const musicOutput = context.createGain.mock.results[1].value
    expect(fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}${deckId}.mp3`, expect.anything())
    expect(music).toMatchObject({ loop: true })
    expect(music.connect).toHaveBeenCalledWith(musicOutput)
    expect(musicOutput.gain.setValueAtTime).toHaveBeenCalledWith(0.02, 10)
    audio.setMusicPlaying(true, 800)
    expect(context.createBufferSource).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(4)
    audio.setMusicPlaying(false, 800)
    expect(musicOutput.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.8)
    expect(music.stop).toHaveBeenCalledWith(10.8)
    audio.play('result', 0)
    await vi.waitFor(() => expect(context.createBufferSource).toHaveBeenCalledTimes(2))
    expect(context.createGain.mock.results[0].value.gain.value).toBe(0.5)
    audio.dispose()
  })

  it('does not start late-loading music after the result or unmount', async () => {
    for (const dispose of [false, true]) {
      const { context } = setup()
      const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
      audio.setMusicPlaying(true, 800)
      if (dispose) audio.dispose()
      else audio.setMusicPlaying(false, 800)
      await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(4))
      expect(context.createBufferSource).not.toHaveBeenCalled()
      if (!dispose) audio.dispose()
    }
  })

  it('retries music after a user gesture unlocks audio', async () => {
    const { context } = setup()
    context.state = 'suspended'
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    audio.setMusicPlaying(true, 800)
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(4))
    expect(context.createBufferSource).not.toHaveBeenCalled()
    context.state = 'running'
    const resume = vi.mocked(document.addEventListener).mock.calls.find(([type]) => type === 'pointerdown')![1] as () => void
    resume()
    await vi.waitFor(() => expect(context.createBufferSource).toHaveBeenCalledOnce())
    audio.dispose()
  })

  it('stops music and releases its output when leaving a battle', async () => {
    const { context, source } = setup()
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    audio.setMusicPlaying(true, 800)
    await vi.waitFor(() => expect(context.createBufferSource).toHaveBeenCalledOnce())
    audio.dispose()
    expect(source.stop).toHaveBeenCalledOnce()
    expect(context.createGain.mock.results[1].value.disconnect).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('loads and plays the placement clip through the same quiet output', async () => {
    const { context, source } = setup()
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    audio.play('put', 0)
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10))
    expect(fetch).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}put.mp3`, expect.anything())
    expect(context.createGain.mock.results[0].value.gain.value).toBe(0.5)
    audio.dispose()
  })

  it('waits for the first user gesture to finish resuming audio', async () => {
    const { context, source } = setup()
    context.state = 'suspended'
    let finishResume!: () => void
    context.resume.mockImplementation(() => new Promise<void>(resolve => { finishResume = resolve }))
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    audio.play('player', 250)
    expect(source.start).not.toHaveBeenCalled()
    context.state = 'running'
    finishResume()
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10.25))
    audio.dispose()
  })

  it('cancels a delayed impact when combat disappears before playback', async () => {
    const { source } = setup()
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    const cancel = audio.play('player', 250)
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10.25))
    cancel()
    expect(source.stop).toHaveBeenCalledOnce()
    audio.dispose()
  })

  it('lets a playing clip finish at combat resolution and stops it on unmount', async () => {
    const { source } = setup()
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    const cancel = audio.play('normal', 0)
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledWith(10))
    cancel()
    expect(source.stop).not.toHaveBeenCalled()
    audio.dispose()
    expect(source.stop).toHaveBeenCalledOnce()
  })

  it('does not replay a cancelled impact after audio decoding finishes', async () => {
    const { context, source } = setup()
    const audio = createDamageAudio(THEME_DECK_IDS.RED_BLUE_SKIRMISH)
    audio.play('normal', 0)()
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledTimes(3))
    expect(source.start).not.toHaveBeenCalled()
    audio.dispose()
  })
})
