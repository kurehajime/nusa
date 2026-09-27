import { describe, expect, it } from 'vitest'
import { CARD_DEFINITION_IDS, CARD_LIST } from './cards'
import { GameManager } from './GameManager'

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('card definition ids', () => {
  it('does not refund mana when World Serpent with vanish is destroyed in combat', () => {
    const initial = GameManager.create(() => 0.999, {
      playerA: [CARD_DEFINITION_IDS.WORLD_SERPENT],
      playerB: [CARD_DEFINITION_IDS.WORLD_SERPENT],
    })
    const cards = Object.values(initial.state.cards)
    const manager = GameManager.from({
      ...initial.state, activePlayerId: 'playerB', phase: 'battle', turn: 10,
      players: {
        playerA: { ...initial.state.players.playerA, hand: [], deck: [], mana: 0 },
        playerB: { ...initial.state.players.playerB, hand: [], deck: [], mana: 0 },
      },
      board: { creatures: cards.map(card => ({cardId: card.id, summonedTurn: 1})) },
    })
    const preview = GameManager.previewCombat(manager, 1, 1)
    expect(preview.nextState.players.playerA.discard).toContain(cards[0].id)
    expect(preview.refundedMana.playerA).toBeUndefined()
    expect(preview.nextState.players.playerA.mana).toBe(0)
  })
  it('allows World Serpent at six mana and retains its attack on the summon turn', () => {
    const initial = GameManager.create(() => 0.999, {
      playerA: [CARD_DEFINITION_IDS.WORLD_SERPENT], playerB: [],
    })
    const cardId = initial.state.players.playerA.hand[0]
    const atMana = (mana: number) => GameManager.from({
      ...initial.state, turn: 10,
      players: { ...initial.state.players, playerA: { ...initial.state.players.playerA, mana } },
    })
    expect(GameManager.getSummonOptions(atMana(5), cardId).every(option => !option.canSummon)).toBe(true)
    expect(GameManager.getSummonOptions(atMana(6), cardId).some(option => option.canSummon)).toBe(true)
    const summoned = GameManager.summonCreature(atMana(6), cardId, 0)
    expect(summoned.state.players.playerA.mana).toBe(0)
    expect(GameManager.getCreatureStats(summoned, cardId).attack).toBe(9)
    const nextTurn = GameManager.from({ ...summoned.state, turn: summoned.state.turn + 1 })
    expect(GameManager.getCreatureStats(nextTurn, cardId).attack).toBe(9)
    expect(summoned.state.cards[cardId].card).toMatchObject({ attack: 9, defense: 9, march: 2, abilities: [{ type: 'vanish' }] })
  })
  it('uses one unique UUID v4 for every card definition', () => {
    const registeredIds = Object.values(CARD_DEFINITION_IDS)
    const actualIds = CARD_LIST.map(({ definitionId }) => definitionId)

    expect(registeredIds).toHaveLength(42)
    expect(new Set(registeredIds).size).toBe(registeredIds.length)
    expect(registeredIds.every((definitionId) => UUID_V4_PATTERN.test(definitionId))).toBe(true)
    expect(actualIds.toSorted()).toEqual(registeredIds.toSorted())
  })
})
