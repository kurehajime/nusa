import { GameManager } from '../GameManager'
import type { CardInstanceId, GameAction } from '../types'
import { TUTORIAL, type TutorialStep } from './script'

export type TutorialInput =
  | { type: 'selectCard'; cardId: CardInstanceId }
  | Extract<GameAction, { type: 'summonCreature' | 'attackGroup' }>
  | { type: 'endTurn' }

export type TutorialProgress = {
  stepIndex: number
  settling: boolean
  cards: Record<string, CardInstanceId>
}

export const isTutorialActive = (progress: TutorialProgress | null): progress is TutorialProgress =>
  progress !== null && progress.stepIndex < TUTORIAL.steps.length

export const createTutorial = () => {
  const manager = GameManager.create(Math.random, TUTORIAL.decks, { shuffle: false })
  const cards = Object.fromEntries(Object.entries(TUTORIAL.cards).map(([alias, ref]) => {
    const player = manager.state.players[ref.playerId]
    return [alias, [...player.hand, ...player.deck][ref.deckIndex]]
  }))
  return { manager, progress: { stepIndex: 0, settling: false, cards } }
}

const cardIdFor = (progress: TutorialProgress, alias: string) => {
  const id = progress.cards[alias]
  if (id === undefined) throw new Error(`Tutorial card not found: ${alias}`)
  return id
}

const groupFor = (manager: GameManager, progress: TutorialProgress, alias: string) => {
  const cardId = cardIdFor(progress, alias)
  const index = manager.state.board.creatures.findIndex((card) => card.cardId === cardId)
  const group = GameManager.getBoardGroups(manager).find(
    (candidate) => candidate.startIndex <= index && candidate.endIndex >= index,
  )
  if (!group) throw new Error(`Tutorial group not found: ${alias}`)
  return group
}

export const getTutorialInstruction = (manager: GameManager, progress: TutorialProgress | null) => {
  if (!isTutorialActive(progress)) return null
  const step: TutorialStep = TUTORIAL.steps[progress.stepIndex]
  const { action, target } = step
  let input: TutorialInput
  switch (action.type) {
    case 'selectCard': input = { type: action.type, cardId: cardIdFor(progress, action.card) }; break
    case 'summonCreature': input = {
      type: action.type, cardId: cardIdFor(progress, action.card),
      insertIndex: action.besidePlayer === 'playerA' ? 0 : manager.state.board.creatures.length,
    }; break
    case 'attackGroup': {
      const group = groupFor(manager, progress, action.card)
      input = { type: action.type, startIndex: group.startIndex, endIndex: group.endIndex }
      break
    }
    case 'endTurn': input = { type: action.type }; break
  }
  let targetKey: string
  switch (target.kind) {
    case 'handCard': targetKey = `hand-${cardIdFor(progress, target.card)}`; break
    case 'summonSlot': targetKey = `insert-${target.besidePlayer === 'playerA' ? 0 : manager.state.board.creatures.length}`; break
    case 'attackGroup': {
      const group = groupFor(manager, progress, target.card)
      targetKey = `attack-${group.startIndex}-${group.endIndex}`
      break
    }
    case 'player': targetKey = `player-${target.playerId}`; break
    case 'endTurn': targetKey = 'end-turn'; break
  }
  return { ...step, input, targetKey, stepIndex: progress.stepIndex }
}

export const tutorialInputsEqual = (a: TutorialInput, b: TutorialInput): boolean => {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'selectCard': return b.type === a.type && a.cardId === b.cardId
    case 'summonCreature': return b.type === a.type && a.cardId === b.cardId && a.insertIndex === b.insertIndex
    case 'attackGroup': return b.type === a.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex
    case 'endTurn': return true
  }
}

export const endCurrentTurn = (manager: GameManager): GameManager => {
  const playerId = manager.state.activePlayerId
  let next = manager
  while (next.state.activePlayerId === playerId && GameManager.getWinner(next) === null && !next.state.pendingCombat) {
    next = GameManager.passPhase(next)
  }
  return next
}

// A stale step token cannot execute an action twice, including a delayed opponent action.
export const applyTutorialInput = (
  manager: GameManager,
  progress: TutorialProgress,
  selectedCardId: CardInstanceId | null,
  input: TutorialInput,
  stepIndex: number,
) => {
  if (!isTutorialActive(progress) || progress.settling || stepIndex !== progress.stepIndex ||
      manager.state.pendingCombat || GameManager.getWinner(manager) !== null) return null
  const instruction = getTutorialInstruction(manager, progress)!
  if (instruction.actor !== manager.state.activePlayerId || !tutorialInputsEqual(instruction.input, input)) return null
  if (input.type === 'selectCard') {
    if (!GameManager.isCardPlayable(manager, input.cardId)) return null
    return { manager, selectedCardId: input.cardId, progress: { ...progress, stepIndex: progress.stepIndex + 1 } }
  }
  if (input.type === 'summonCreature' && instruction.actor === 'playerA' && selectedCardId !== input.cardId) return null
  const nextManager = input.type === 'endTurn'
    ? endCurrentTurn(manager)
    : GameManager.applyAction(manager, input)
  const settling = nextManager.state.pendingCombat !== null
  return {
    manager: nextManager,
    selectedCardId: null,
    progress: { ...progress, settling, stepIndex: progress.stepIndex + (settling ? 0 : 1) },
  }
}

export const finishTutorialCombat = (manager: GameManager, progress: TutorialProgress) => {
  if (!manager.state.pendingCombat) return { manager, progress }
  return {
    manager: GameManager.finishCombat(manager),
    progress: { ...progress, settling: false, stepIndex: progress.stepIndex + (progress.settling ? 1 : 0) },
  }
}
