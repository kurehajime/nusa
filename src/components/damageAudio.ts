import type { DamageSound } from './combatPresentation'

export const createDamageAudio = () => {
  const context = new AudioContext()
  const abort = new AbortController()
  const sources = new Set<AudioBufferSourceNode>()
  let disposed = false

  const load = async (sound: DamageSound): Promise<AudioBuffer | null> => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}damage_${sound}.mp3`, {
        signal: abort.signal,
      })
      if (!response.ok) return null
      return await context.decodeAudioData(await response.arrayBuffer())
    } catch {
      return null
    }
  }
  const normalBuffer = load('normal')
  const buffers = { normal: normalBuffer, player: normalBuffer }

  // Mobile browsers need a user gesture before sound can start, including COM attacks.
  const resume = () => {
    if (!disposed && context.state === 'suspended') {
      void context.resume().catch(() => {})
    }
  }
  document.addEventListener('pointerdown', resume, true)
  document.addEventListener('keydown', resume, true)
  resume()

  return {
    play(sound: DamageSound, delayMs: number): () => void {
      const startAt = context.currentTime + delayMs / 1000
      let cancelled = false
      let source: AudioBufferSourceNode | null = null
      let scheduledAt = startAt

      // A first attack can arrive while the gesture's resume is still completing.
      const resumed = context.state === 'running'
        ? Promise.resolve()
        : context.resume().catch(() => {})
      void Promise.all([buffers[sound], resumed]).then(([buffer]) => {
        // Do not queue old impacts for a later user gesture or a hidden tab.
        if (cancelled || disposed || !buffer || context.state !== 'running' || document.hidden) return
        source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        sources.add(source)
        const playingSource = source
        source.onended = () => {
          sources.delete(playingSource)
          playingSource.disconnect()
        }
        scheduledAt = Math.max(startAt, context.currentTime)
        source.start(scheduledAt)
      })

      return () => {
        cancelled = true
        // Let an impact already playing finish naturally after combat resolution.
        if (source && !disposed && context.currentTime < scheduledAt) source.stop()
      }
    },
    dispose() {
      disposed = true
      abort.abort()
      document.removeEventListener('pointerdown', resume, true)
      document.removeEventListener('keydown', resume, true)
      for (const source of sources) source.stop()
      sources.clear()
      void context.close().catch(() => {})
    },
  }
}
