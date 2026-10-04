import { describe, expect, it } from 'vitest'
import { GameManager, assertValidGameState } from './GameManager'
import { GameAI } from './ai/GameAI'
import { CARD_DEFINITION_IDS as ID, EXPANSION_CARD_DEFINITION_IDS } from './cards'
import { describeAbility, formatAbility } from './CreatureRules'
import type { CardDefinitionId, PlayerId } from './types'

const position = (owner: PlayerId, allies: CardDefinitionId[], layout: (number | 'enemy')[]) => {
  const opponent = owner === 'playerA' ? 'playerB' : 'playerA'
  const initial = GameManager.create(() => 0.999, {
    [owner]: [ID.CLEANER, ...allies],
    [opponent]: layout.filter(value => value === 'enemy').map(() => ID.SPARK_SWORDSMAN),
  } as Record<PlayerId, CardDefinitionId[]>)
  const own = Object.values(initial.state.cards).filter(card => card.ownerId === owner).map(card => card.id)
  const enemies = Object.values(initial.state.cards).filter(card => card.ownerId === opponent).map(card => card.id)
  let enemyIndex = 0
  const ids = layout.map(value => value === 'enemy' ? enemies[enemyIndex++] : own[value])
  const board = owner === 'playerA' ? ids : ids.toReversed()
  const manager = GameManager.from({
    ...initial.state, activePlayerId: owner, phase: 'main', turn: 10,
    players: {
      ...initial.state.players,
      [owner]: { ...initial.state.players[owner], mana: 0, hand: [own[0]], deck: own.slice(1).filter(id => !board.includes(id)) },
      [opponent]: { ...initial.state.players[opponent], mana: 0, hand: [], deck: [] },
    },
    board: { creatures: board.map(cardId => ({ cardId, summonedTurn: 1 })) },
  })
  assertValidGameState(manager.state)
  return { manager, own, enemies }
}

describe('betrayal', () => {
  it('registers the expansion and its visible keyword', () => {
    expect(EXPANSION_CARD_DEFINITION_IDS).toContain(ID.CLEANER)
    expect(formatAbility({ type: 'betrayal' })).toBe('裏切り')
    expect(describeAbility({ type: 'betrayal' })).toContain('同じグループ')
  })

  it.each(['playerA', 'playerB'] as const)('summons alone for zero mana for %s', owner => {
    const { manager, own } = position(owner, [], [])
    const next = GameManager.summonCreature(manager, own[0], 0)
    expect(next.state.board.creatures).toEqual([{ cardId: own[0], summonedTurn: 10 }])
    expect(next.state.players[owner]).toMatchObject({ mana: 0, hand: [], discard: [] })
    expect(GameManager.getCreatureStats(next, own[0])).toEqual({ attack: 1, defense: 1, march: 1 })
    assertValidGameState(next.state)
  })

  it.each(['playerA', 'playerB'] as const)('destroys both sides of its group only, with normal refunds for %s', owner => {
    const { manager, own, enemies } = position(owner,
      [ID.SPARK_SWORDSMAN, ID.AZURE_WAVE_VOYAGER, ID.WORLD_SERPENT, ID.OAKBARK_SENTINEL],
      ['enemy', 1, 2, 3, 'enemy', 4],
    )
    const before = JSON.stringify(manager.state)
    const next = GameManager.summonCreature(manager, own[0], 3)
    expect(next.state.players[owner].discard.toSorted()).toEqual(own.slice(1, 4).toSorted())
    expect(next.state.players[owner].mana).toBe(3) // 2/2 + 4/2; vanish refunds nothing.
    expect(next.state.board.creatures.map(c => c.cardId).toSorted()).toEqual([own[0], own[4], ...enemies].toSorted())
    expect(next.state.players[owner].hand).toEqual([])
    expect(next.state.phase).toBe('main')
    expect(next.state.pendingCombat).toBeNull()
    expect(JSON.stringify(manager.state)).toBe(before)
    assertValidGameState(next.state)
  })

  it('destroys an older cleaner without triggering its ability again', () => {
    const { manager, own } = position('playerA', [ID.CLEANER], [1])
    const next = GameManager.summonCreature(manager, own[0], 1)
    expect(next.state.board.creatures.map(c => c.cardId)).toEqual([own[0]])
    expect(next.state.players.playerA).toMatchObject({ mana: 0, discard: [own[1]] })
    assertValidGameState(next.state)
  })

  it('does not trigger when teleport moves a cleaner into an allied group', () => {
    const { manager, own } = position('playerA', [ID.AZURE_WAVE_VOYAGER, ID.TRANSFER], [1, 'enemy'])
    const moved = GameManager.from({
      ...manager.state,
      players: {
        ...manager.state.players,
        playerA: { ...manager.state.players.playerA, hp: 10, hand: [own[2]], deck: [] },
      },
      board: { creatures: [...manager.state.board.creatures, { cardId: own[0], summonedTurn: 1 }] },
    })
    const next = GameManager.playSpell(moved, own[2], { kind: 'creature', cardId: own[0] })
    expect(next.state.board.creatures.map(c => c.cardId)).toEqual([own[0], own[1], manager.state.board.creatures[1].cardId])
    expect(next.state.players.playerA.discard).toEqual([])
    assertValidGameState(next.state)
  })

  it.each(['playerA', 'playerB'] as const)('AI avoids sacrificing a strong group for %s', owner => {
    const { manager, own } = position(owner, [ID.GREAT_TREE_GUARDIAN], [1, 'enemy'])
    const action = new GameAI().chooseAction(manager)
    const safe = GameManager.summonCreature(manager, own[0], owner === 'playerA' ? 2 : 0)
    const destructive = GameManager.summonCreature(manager, own[0], 1)
    expect(GameAI.evaluate(safe, owner).total).toBeGreaterThan(GameAI.evaluate(destructive, owner).total)
    expect(action).not.toBeNull()
    const next = GameManager.applyAction(manager, action!)
    expect(next.state.players[owner].discard).toEqual([])
  })
})
