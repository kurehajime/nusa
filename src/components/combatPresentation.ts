import type { GameState } from '../game'

const COMBAT_EFFECT_DURATION_MS = 500
const BREAKTHROUGH_DAMAGE_DELAY_MS = 250

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
