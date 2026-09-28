import type { GameState } from '../game'

const COMBAT_EFFECT_DURATION_MS = 500
const BREAKTHROUGH_DAMAGE_DELAY_MS = 250
const DAMAGE_SOUND_INTERVAL_MS = 100

export const getPlayerDamageDelayMs = (
  { pendingCombat, cards }: Pick<GameState, 'pendingCombat' | 'cards'>,
): number => {
  if (
    !pendingCombat?.playerWasHit ||
    pendingCombat.endsTurnAfterResolution === false
  ) return 0

  return pendingCombat.damageMarkers.some(
    ({ cardId }) => cards[cardId].ownerId === pendingCombat.defendingPlayerId,
  ) ? BREAKTHROUGH_DAMAGE_DELAY_MS : 0
}

export const getCombatEffectDurationMs = (state: GameState): number =>
  COMBAT_EFFECT_DURATION_MS + getPlayerDamageDelayMs(state)

export type DamageSound = 'normal' | 'player'

export const getDamageSoundCues = (state: GameState): { sound: DamageSound; delayMs: number }[] => {
  const combat = state.pendingCombat
  if (!combat) return []

  const cues: { sound: DamageSound; delayMs: number }[] = []
  const damagedCards = new Set(
    combat.damageMarkers.filter(marker => marker.damage > 0).map(marker => marker.cardId),
  )
  for (const _cardId of damagedCards) {
    cues.push({ sound: 'normal', delayMs: cues.length * DAMAGE_SOUND_INTERVAL_MS })
  }
  if (combat.playerWasHit && combat.playerDamage > 0) {
    cues.push({ sound: 'player', delayMs: cues.length * DAMAGE_SOUND_INTERVAL_MS })
  }
  return cues
}
