import { describe, expect, it } from 'vitest'
import { CARD_DEFINITION_IDS as CARD, GameManager, type CardDefinitionId, type PlayerId } from '../game'
import { getCombatEffectDurationMs, getPlayerDamageDelayMs } from './combatPresentation'

const attack = (attackerId: PlayerId, defenders: CardDefinitionId[]) => {
  const defenderId = attackerId === 'playerA' ? 'playerB' : 'playerA'
  const initial = GameManager.create(() => 0.999, {
    playerA: attackerId === 'playerA' ? [CARD.WORLD_SERPENT] : defenders,
    playerB: defenderId === 'playerB' ? defenders : [CARD.WORLD_SERPENT],
  })
  const cards = Object.values(initial.state.cards)
  const manager = GameManager.from({
    ...initial.state,
    activePlayerId: attackerId,
    phase: 'battle',
    turn: 10,
    players: {
      playerA: { ...initial.state.players.playerA, hand: [], deck: [] },
      playerB: { ...initial.state.players.playerB, hand: [], deck: [] },
    },
    board: { creatures: cards.map(card => ({ cardId: card.id, summonedTurn: 9 })) },
  })
  const index = cards.findIndex(card => card.ownerId === attackerId)
  return GameManager.attackGroup(manager, index, index)
}

describe('combat presentation timing', () => {
  it.each<PlayerId>(['playerA', 'playerB'])('delays breakthrough damage by %s until after the group impact', (playerId) => {
    const manager = attack(playerId, [CARD.SPARK_SWORDSMAN])
    expect(manager.state.pendingCombat?.playerDamage).toBeGreaterThan(0)
    expect(getPlayerDamageDelayMs(manager.state)).toBe(250)
    expect(getCombatEffectDurationMs(manager.state)).toBe(750)
    const resolved = GameManager.finishCombat(manager)
    expect(getPlayerDamageDelayMs(resolved.state)).toBe(0)
  })

  it('keeps direct player attacks immediate', () => {
    expect(getPlayerDamageDelayMs(attack('playerA', []).state)).toBe(0)
    expect(getCombatEffectDurationMs(attack('playerA', []).state)).toBe(500)
  })

  it('keeps attacks stopped by a group at the existing duration', () => {
    const manager = attack('playerA', [CARD.DREAMWALKING_FOREST_GIANT, CARD.DREAMWALKING_FOREST_GIANT])
    expect(manager.state.pendingCombat?.playerWasHit).toBe(false)
    expect(getPlayerDamageDelayMs(manager.state)).toBe(0)
    expect(getCombatEffectDurationMs(manager.state)).toBe(500)
  })

  it('does not treat simultaneous spell damage as a breakthrough', () => {
    const { state } = attack('playerA', [CARD.SPARK_SWORDSMAN])
    expect(getPlayerDamageDelayMs({
      ...state,
      pendingCombat: { ...state.pendingCombat!, endsTurnAfterResolution: false },
    })).toBe(0)
  })
})
