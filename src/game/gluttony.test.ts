import { describe, expect, it } from 'vitest'
import { GameManager, assertValidGameState } from './GameManager'
import { CARD_DEFINITION_IDS as ID, EXPANSION_CARD_DEFINITION_IDS } from './cards'
import { describeAbility, formatAbility } from './CreatureRules'
import { GameAI } from './ai/GameAI'
import type { CardDefinitionId, PlayerId } from './types'

const position = (owner: PlayerId, group: CardDefinitionId[], remaining = 20, enemy?: CardDefinitionId) => {
  const opponent = owner === 'playerA' ? 'playerB' : 'playerA'
  const initial = GameManager.create(() => 0.999, {
    [owner]: [...group, ...Array<CardDefinitionId>(remaining).fill(ID.SPARK_SWORDSMAN)],
    [opponent]: enemy ? [enemy] : [],
  } as Record<PlayerId, CardDefinitionId[]>)
  const own = Object.values(initial.state.cards).filter(c => c.ownerId === owner).map(c => c.id)
  const other = Object.values(initial.state.cards).filter(c => c.ownerId === opponent).map(c => c.id)
  const groupIds = own.slice(0, group.length)
  const boardIds = owner === 'playerA' ? [...groupIds, ...other] : [...other, ...groupIds]
  return GameManager.from({
    ...initial.state, activePlayerId: owner, turn: 10, phase: 'battle',
    players: {
      ...initial.state.players,
      [owner]: { ...initial.state.players[owner], hand: [], deck: own.slice(group.length) },
      [opponent]: { ...initial.state.players[opponent], hand: [], deck: [] },
    },
    board: { creatures: boardIds.map(cardId => ({ cardId, summonedTurn: 1 })) },
  })
}

describe('gluttony', () => {
  it('registers the expansion and keyword', () => {
    expect(EXPANSION_CARD_DEFINITION_IDS).toContain(ID.GIANT_FROG)
    expect(formatAbility({type: 'gluttony'})).toBe('大喰い')
    expect(describeAbility({type: 'gluttony'})).toContain('山札')
  })
  it.each(['playerA', 'playerB'] as const)('does not mill when a defending creature blocks player damage for %s', owner => {
    const manager = position(owner, [ID.GIANT_FROG, ID.SPARK_SWORDSMAN], 20, ID.DREAMWALKING_FOREST_GIANT)
    const start = owner === 'playerA' ? 0 : 1
    const deck = [...manager.state.players[owner].deck]
    const preview = GameManager.previewCombat(manager, start, start + 1)
    const attacked = GameManager.attackGroup(manager, start, start + 1)
    expect(attacked.state.pendingCombat?.playerDamage).toBe(0)
    expect(attacked.state.players[owner].deck).toEqual(deck)
    expect(attacked.state.players[owner].discard).toEqual([])
    expect(preview.nextState.players[owner].deck).toEqual(deck)
    expect(manager.state.players[owner].deck).toEqual(deck)
    expect(() => assertValidGameState(attacked.state)).not.toThrow()
  })
  it('triggers per frog and does not repeat on combat resolution', () => {
    const single = position('playerA', [ID.GIANT_FROG])
    const attacked = GameManager.attackGroup(single, 0, 0)
    expect(attacked.state.pendingCombat?.playerDamage).toBe(1)
    expect(attacked.state.players.playerA.discard).toHaveLength(1)
    const double = GameManager.attackGroup(position('playerA', [ID.GIANT_FROG, ID.GIANT_FROG]), 0, 1)
    expect(double.state.players.playerA.discard).toHaveLength(8)
    const finished = GameManager.finishCombat(double)
    expect(finished.state.players.playerA.discard).toHaveLength(8)
  })
  it.each(['playerA', 'playerB'] as const)('mills only damage that penetrates defenses and shield for %s', owner => {
    const manager = position(owner, [ID.GIANT_FROG, ID.SPARK_SWORDSMAN], 20, ID.OAKBARK_SENTINEL)
    const start = owner === 'playerA' ? 0 : 1
    const attacked = GameManager.attackGroup(manager, start, start + 1)
    const damage = attacked.state.pendingCombat!.playerDamage
    expect(damage).toBeGreaterThan(0)
    expect(damage).toBeLessThan(6)
    expect(attacked.state.players[owner].discard).toHaveLength(damage)
    expect(GameManager.previewCombat(manager, start, start + 1).nextState.players[owner].deck)
      .toEqual(attacked.state.players[owner].deck)
  })
  it.each(['playerA', 'playerB'] as const)('does not mill when the shield absorbs all breakthrough damage for %s', owner => {
    const manager = position(owner, [ID.GIANT_FROG], 20, ID.BURNING_VANGUARD)
    const start = owner === 'playerA' ? 0 : 1
    const attacked = GameManager.attackGroup(manager, start, start)
    expect(attacked.state.pendingCombat).toMatchObject({ playerWasHit: true, playerDamage: 0 })
    expect(attacked.state.players[owner].deck).toEqual(manager.state.players[owner].deck)
    expect(attacked.state.players[owner].discard).toEqual([])
    expect(GameManager.previewCombat(manager, start, start).nextState.players[owner].deck)
      .toEqual(manager.state.players[owner].deck)
  })
  it('still triggers once when the attacking frog dies to a counterattack', () => {
    const manager = position('playerA', [ID.SPARK_SWORDSMAN, ID.GIANT_FROG], 20, ID.SURGING_DUELIST)
    const frog = manager.state.board.creatures[1].cardId
    const deck = manager.state.players.playerA.deck
    const attacked = GameManager.attackGroup(manager, 0, 1)
    expect(attacked.state.pendingCombat?.playerDamage).toBe(3)
    expect(attacked.state.pendingCombat?.destroyedCardIds).toContain(frog)
    expect(attacked.state.players.playerA.discard).toEqual(deck.slice(0, 3))
    const finished = GameManager.finishCombat(attacked)
    expect(finished.state.players.playerA.discard).toEqual([...deck.slice(0, 3), frog])
    const preview = GameManager.previewCombat(manager, 0, 1)
    expect(preview.nextState.players.playerA.deck).toEqual(finished.state.players.playerA.deck)
    expect(preview.nextState.players.playerA.discard).toEqual(finished.state.players.playerA.discard)
  })
  it.each([0, 1, 3])('handles a deck with only %i cards', count => {
    const attacked = GameManager.attackGroup(position('playerA', [ID.GIANT_FROG, ID.GIANT_FROG], count), 0, 1)
    expect(attacked.state.players.playerA.deck).toHaveLength(0)
    expect(attacked.state.players.playerA.discard).toHaveLength(count)
    expect(() => assertValidGameState(attacked.state)).not.toThrow()
  })
  it('does not trigger while defending or passing', () => {
    const manager = position('playerA', [ID.SPARK_SWORDSMAN], 20, ID.GIANT_FROG)
    expect(GameManager.attackGroup(manager, 0, 0).state.players.playerA.discard).toHaveLength(0)
    const frog = position('playerA', [ID.GIANT_FROG])
    expect(GameManager.passPhase(frog).state.players.playerA.discard).toHaveLength(0)
  })
  it('lets AI choose a winning attack with frogs without mutating its input', () => {
    const initial = position('playerA', [ID.GIANT_FROG, ID.SPARK_SWORDSMAN])
    const manager = GameManager.from({ ...initial.state, players: {
      ...initial.state.players, playerB: {...initial.state.players.playerB, hp: 1},
    }})
    expect(new GameAI().chooseAction(manager)).toEqual({type: 'attackGroup', startIndex: 0, endIndex: 1})
    expect(manager.state.players.playerA.discard).toHaveLength(0)
  })
})
