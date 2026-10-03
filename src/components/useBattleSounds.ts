import { useCallback, useEffect, useRef } from 'react'
import type { GameState } from '../game'
import { createDamageAudio } from './damageAudio'
import { getDamageSoundCues, getPlacementSoundCount } from './combatPresentation'

export const useBattleSounds = (state: GameState) => {
  const audio = useRef<ReturnType<typeof createDamageAudio> | null>(null)
  const previousState = useRef(state)

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
    const previous = previousState.current
    previousState.current = state
    const player = audio.current
    if (!player) return
    for (let index = 0; index < getPlacementSoundCount(previous, state); index += 1) {
      player.play('put', 0)
    }
    // Finish the whole burst even if the visual combat effect has already ended.
    // The audio player's dispose still cancels everything when leaving the battle.
    for (const cue of getDamageSoundCues(state)) player.play(cue.sound, cue.delayMs)
  }, [state])

  const playResultSound = useCallback((delayMs = 0) => audio.current?.play('result', delayMs), [])
  return { playResultSound }
}
