import { describe, expect, it } from 'vitest'
import { CARD_DEFINITION_IDS as CARD, GameManager, type CardDefinitionId, type PlayerId } from '../game'
import { getCombatEffectDurationMs, getDamageSoundCues, getPlayerDamageDelayMs } from './combatPresentation'

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

describe('damage sound cues', () => {
  it.each<PlayerId>(['playerA', 'playerB'])('plays card then player sounds when %s breaks through', playerId => {
    expect(getDamageSoundCues(attack(playerId, [CARD.SPARK_SWORDSMAN]).state)).toEqual([
      { sound: 'normal', delayMs: 0 },
      { sound: 'player', delayMs: 100 },
    ])
  })

  it('plays only the player sound for a direct attack', () => {
    expect(getDamageSoundCues(attack('playerA', []).state)).toEqual([
      { sound: 'player', delayMs: 0 },
    ])
  })

  it('plays one sound per damaged card, including a surviving card', () => {
    const { state } = attack('playerA', [CARD.DREAMWALKING_FOREST_GIANT, CARD.DREAMWALKING_FOREST_GIANT])
    expect(state.pendingCombat!.damageMarkers.length).toBeGreaterThan(1)
    expect(getDamageSoundCues(state)).toEqual([
      { sound: 'normal', delayMs: 0 },
      { sound: 'normal', delayMs: 100 },
    ])
  })

  it('keeps every card impact even when the burst exceeds the visual effect duration', () => {
    const { state } = attack('playerA', Array<CardDefinitionId>(9).fill(CARD.BURNING_VANGUARD))
    const cues = getDamageSoundCues(state)
    expect(cues).toHaveLength(9)
    expect(cues.map(cue => cue.delayMs)).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800])
    expect(cues.at(-1)!.delayMs).toBeGreaterThan(getCombatEffectDurationMs(state))
  })

  it('counts damaged cards rather than duplicate or zero-damage markers', () => {
    const { state } = attack('playerA', [CARD.SPARK_SWORDSMAN])
    const combat = state.pendingCombat!
    const marker = combat.damageMarkers[0]
    expect(getDamageSoundCues({
      ...state,
      pendingCombat: {
        ...combat,
        damageMarkers: [marker, marker, { ...marker, damage: 0 }],
      },
    })).toEqual([
      { sound: 'normal', delayMs: 0 },
      { sound: 'player', delayMs: 100 },
    ])
  })

  it('does not play damage sounds for zero damage or resolved combat', () => {
    const manager = attack('playerA', [])
    expect(getDamageSoundCues({
      ...manager.state,
      pendingCombat: { ...manager.state.pendingCombat!, playerDamage: 0 },
    })).toEqual([])
    expect(getDamageSoundCues(GameManager.finishCombat(manager).state)).toEqual([])
  })

  it('uses the same sound cadence for simultaneous spell impacts', () => {
    const { state } = attack('playerA', [CARD.SPARK_SWORDSMAN])
    expect(getDamageSoundCues({
      ...state,
      pendingCombat: { ...state.pendingCombat!, endsTurnAfterResolution: false },
    })).toEqual([
      { sound: 'normal', delayMs: 0 },
      { sound: 'player', delayMs: 100 },
    ])
  })
})
