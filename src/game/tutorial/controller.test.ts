import { describe, expect, it } from 'vitest'
import { GameManager } from '../GameManager'
import { GameAI } from '../ai'
import { CARD_DEFINITION_IDS } from '../cards'
import { TUTORIAL } from './script'
import {
  applyTutorialInput, createTutorial, endCurrentTurn, finishTutorialCombat,
  getTutorialInstruction, isTutorialActive,
} from './controller'

const start = () => ({ ...createTutorial(), selectedCardId: null as number | null })
const perform = (state: ReturnType<typeof start>) => {
  const instruction = getTutorialInstruction(state.manager, state.progress)!
  const next = applyTutorialInput(state.manager, state.progress, state.selectedCardId, instruction.input, instruction.stepIndex)
  expect(next).not.toBeNull()
  return next!
}

const definitions = (manager: GameManager, ids: number[]) => ids.map((id) => manager.state.cards[id].card.definitionId)

describe('tutorial', () => {
  it('keeps both complete decks in their declared order and draws normally', () => {
    for (let run = 0; run < 3; run++) {
      const { manager } = createTutorial()
      const { playerA, playerB } = manager.state.players
      expect(definitions(manager, [...playerA.hand, ...playerA.deck])).toEqual(TUTORIAL.decks.playerA)
      expect(definitions(manager, playerB.deck)).toEqual(TUTORIAL.decks.playerB)
      expect(playerA.hand).toHaveLength(5)
      expect(playerA.mana).toBe(2)
      expect(playerB.hand).toEqual([])
      const opponentTurn = endCurrentTurn(manager)
      expect(definitions(opponentTurn, opponentTurn.state.players.playerB.hand)).toEqual(TUTORIAL.decks.playerB.slice(0, 5))
      expect(opponentTurn.state.players.playerB.mana).toBe(3)
    }
  })

  it('only disables shuffling when explicitly requested', () => {
    const random = () => 0
    const normal = GameManager.create(random, TUTORIAL.decks)
    const fixed = GameManager.create(random, TUTORIAL.decks, { shuffle: false })
    expect(normal.state.players.playerA.hand).not.toEqual(fixed.state.players.playerA.hand)
  })

  it('rejects the other copy of the same card, wrong operations and stale step tokens', () => {
    const state = start()
    const secondCopy = state.manager.state.players.playerA.hand[1]
    expect(state.manager.state.cards[secondCopy].card.definitionId).toBe(CARD_DEFINITION_IDS.SPARK_SWORDSMAN)
    expect(applyTutorialInput(state.manager, state.progress, null, { type: 'selectCard', cardId: secondCopy }, 0)).toBeNull()
    expect(applyTutorialInput(state.manager, state.progress, null, { type: 'endTurn' }, 0)).toBeNull()
    const selected = perform(state)
    const summon = getTutorialInstruction(selected.manager, selected.progress)!.input
    expect(applyTutorialInput(selected.manager, selected.progress, null, summon, 1)).toBeNull()
    expect(applyTutorialInput(selected.manager, selected.progress, selected.selectedCardId, summon, 0)).toBeNull()
    expect(selected.selectedCardId).toBe(selected.progress.cards.firstAlly)
  })

  it('waits for combat resolution and then completes the script without resetting the battle', () => {
    let state = perform(perform(start()))
    const initialId = state.progress.cards.firstAlly
    state = perform(state)
    expect(state.progress.stepIndex).toBe(2)
    expect(state.progress.settling).toBe(true)
    expect(state.manager.state.pendingCombat).not.toBeNull()
    const attack = getTutorialInstruction(state.manager, state.progress)!
    expect(applyTutorialInput(state.manager, state.progress, null, attack.input, attack.stepIndex)).toBeNull()
    state = { ...state, ...finishTutorialCombat(state.manager, state.progress) }
    expect(state.manager.state.players.playerB.hp).toBe(19)
    expect(state.manager.state.activePlayerId).toBe('playerB')
    expect(state.progress.stepIndex).toBe(3)
    state = perform(state)
    const beforeOpponentEnd = state
    state = perform(state)
    expect(applyTutorialInput(state.manager, state.progress, null, { type: 'endTurn' }, beforeOpponentEnd.progress.stepIndex)).toBeNull()
    expect(isTutorialActive(state.progress)).toBe(false)
    expect(getTutorialInstruction(state.manager, state.progress)).toBeNull()
    expect(state.manager.state.activePlayerId).toBe('playerA')
    expect(state.manager.state.phase).toBe('main')
    expect(state.manager.state.players.playerA.hand).toHaveLength(5)
    expect(state.manager.state.players.playerA.mana).toBe(2)
    expect(state.manager.state.players.playerB.hp).toBe(19)
    expect(state.manager.state.board.creatures.map((card) => card.cardId)).toEqual([initialId, state.progress.cards.firstEnemy])
    // The same manager can continue through normal human and AI operations.
    const cardId = state.manager.state.players.playerA.hand[0]
    const continued = GameManager.summonCreature(state.manager, cardId, 0)
    const opponentTurn = endCurrentTurn(continued)
    const ai = new GameAI({ difficulty: 'easy', random: () => 0.5 })
    const action = ai.chooseAction(opponentTurn)
    expect(action).not.toBeNull()
    expect(() => GameManager.applyAction(opponentTurn, action!)).not.toThrow()
  })
})
