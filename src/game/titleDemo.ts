import { GameAI } from './ai/GameAI'
import { GameManager } from './GameManager'
import { THEME_DECKS, type ThemeDeckId } from './themeDecks'
import type { GameAction, GameState, PlayerId } from './types'

export type TitleDemoMatch = {
  manager: GameManager
  ais: Record<PlayerId, GameAI>
  deckIds: Record<PlayerId, ThemeDeckId>
  matchNumber: number
  actionCount: number
  lastAction: GameAction | null
  lastActor: PlayerId
}

export type TitleDemoFrame = {
  state: GameState
  deckIds: Record<PlayerId, ThemeDeckId>
  matchNumber: number
  actionCount: number
  lastAction: GameAction | null
  lastActor: PlayerId
  finished: boolean
}

export const createTitleDemoMatch = (
  random: () => number = Math.random,
  matchNumber = 1,
): TitleDemoMatch => {
  const firstIndex = Math.floor(random() * THEME_DECKS.length)
  const secondIndex = (firstIndex + 1 + Math.floor(random() * (THEME_DECKS.length - 1))) % THEME_DECKS.length
  const first = THEME_DECKS[firstIndex]
  const second = THEME_DECKS[secondIndex]
  return {
    manager: GameManager.create(random, {
      playerA: first.cardDefinitionIds,
      playerB: second.cardDefinitionIds,
    }),
    ais: {
      playerA: new GameAI({ difficulty: 'hard', random }),
      playerB: new GameAI({ difficulty: 'hard', random }),
    },
    deckIds: { playerA: first.id, playerB: second.id },
    matchNumber,
    actionCount: 0,
    lastAction: null,
    lastActor: 'playerA',
  }
}

const isFinished = ({ manager, actionCount }: TitleDemoMatch): boolean =>
  GameManager.getWinner(manager) !== null || manager.state.turn >= 200 || actionCount >= 1_000

export const advanceTitleDemoMatch = (
  match: TitleDemoMatch,
  random: () => number = Math.random,
): TitleDemoMatch => {
  // Show combat resolution before replacing a finished or stalled match.
  if (match.manager.state.pendingCombat === null && isFinished(match)) {
    return createTitleDemoMatch(random, match.matchNumber + 1)
  }
  const lastActor = match.manager.state.activePlayerId
  const lastAction: GameAction = match.manager.state.pendingCombat !== null
    ? { type: 'finishCombat' }
    : match.ais[lastActor].chooseAction(match.manager) ?? { type: 'passPhase' }
  return {
    ...match,
    manager: GameManager.applyAction(match.manager, lastAction),
    actionCount: match.actionCount + 1,
    lastAction,
    lastActor,
  }
}

export const getTitleDemoFrame = (match: TitleDemoMatch): TitleDemoFrame => ({
  state: match.manager.state,
  deckIds: match.deckIds,
  matchNumber: match.matchNumber,
  actionCount: match.actionCount,
  lastAction: match.lastAction,
  lastActor: match.lastActor,
  finished: match.manager.state.pendingCombat === null && isFinished(match),
})
