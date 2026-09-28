import { useEffect, useRef } from 'react'
import type { GameState } from '../game'
import { createDamageAudio } from './damageAudio'
import { getDamageSoundCues } from './combatPresentation'

export const useDamageSounds = (state: GameState) => {
  const audio = useRef<ReturnType<typeof createDamageAudio> | null>(null)

  useEffect(() => {
    if (typeof AudioContext === 'undefined') return
    const player = createDamageAudio()
    audio.current = player
    return () => {
      audio.current = null
      player.dispose()
    }
  }, [])

  useEffect(() => {
    const player = audio.current
    if (!player) return
    // Finish the whole burst even if the visual combat effect has already ended.
    // The audio player's dispose still cancels everything when leaving the battle.
    for (const cue of getDamageSoundCues(state)) player.play(cue.sound, cue.delayMs)
  }, [state])
}
