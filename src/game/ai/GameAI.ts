import { GameManager } from '../GameManager'
import type { CardInstanceId, GameAction, PlayerId } from '../types'
import {
  evaluateBattleEntry,
  evaluateCoherentMainPlan,
  evaluateMainContinuation,
  getPlunderFutureDeployableHandValue,
} from './evaluation'
import type {
  AiDifficulty,
  EvaluationBreakdown,
  GameAIOptions,
} from './types'
import { isMeaningfullyGreater } from './scoreComparison'

export const AI_DIFFICULTY_IGNORED_HAND_COUNT: Record<AiDifficulty, number> = {
  easy: 2,
  normal: 1,
  hard: 0,
}

const resolveImmediateDamage = (manager: GameManager): GameManager =>
  manager.state.pendingCombat?.endsTurnAfterResolution === false
    ? GameManager.finishCombat(manager)
    : manager

const resolveBattleOption = (
  manager: GameManager,
  action: GameAction | null,
): { manager: GameManager; attackerManaGain: number } => {
  if (action === null) {
    return {
      manager: resolveImmediateDamage(GameManager.passPhase(GameManager.passPhase(manager))),
      attackerManaGain: 0,
    }
  }
  if (action.type !== 'attackGroup') {
    throw new Error('Battle option must attack a group or be null.')
  }

  const pendingManager = GameManager.applyAction(manager, action)
  return {
    manager: resolveImmediateDamage(GameManager.finishCombat(pendingManager)),
    attackerManaGain: pendingManager.state.pendingCombat?.attackerManaGain ?? 0,
  }
}

const resolveMainActionForEvaluation = (
  manager: GameManager,
  action: GameAction,
): GameManager => {
  return resolveImmediateDamage(GameManager.applyAction(manager, action))
}

const chooseMainAction = (
  manager: GameManager,
  aiPlayerId: PlayerId,
  actions: readonly GameAction[],
  ignoredHandCardIds: ReadonlySet<CardInstanceId>,
  difficulty: AiDifficulty,
): GameAction => {
  const hand = manager.state.players[aiPlayerId].hand
  if (
    hand.length === 5 &&
    !actions.some(action => action.type === 'summonCreature' || action.type === 'playSpell')
  ) {
    let discardAction: Extract<GameAction, { type: 'discardFromHand' }> | null = null
    for (const action of actions) {
      if (
        action.type === 'discardFromHand' &&
        (discardAction === null ||
          manager.state.cards[action.cardId].card.cost >
            manager.state.cards[discardAction.cardId].card.cost)
      ) {
        discardAction = action
      }
    }
    if (discardAction !== null) return discardAction
  }

  const passScore = evaluateBattleEntry(
    manager,
    aiPlayerId,
    ignoredHandCardIds,
  ).total
  let bestAction: GameAction | null = null
  let bestScore = passScore
  const evaluateAction = difficulty === 'easy'
    ? evaluateBattleEntry
    : evaluateCoherentMainPlan

  for (const action of actions) {
    const nextManager = resolveMainActionForEvaluation(manager, action)
    const score = evaluateAction(
      nextManager,
      aiPlayerId,
      ignoredHandCardIds,
    ).total
    if (isMeaningfullyGreater(score, bestScore)) {
      bestAction = action
      bestScore = score
    }
  }

  return bestAction ?? { type: 'passPhase' }
}

const isRallyAction = (
  action: GameAction,
): action is Extract<GameAction, { type: 'activateAbility' }> =>
  action.type === 'activateAbility' && action.abilityType === 'rally'

export class AiTurnActionMemory {
  private turn: number | null = null
  private playerId: PlayerId | null = null
  private readonly ralliedCardIds = new Set<CardInstanceId>()
  private readonly ignoredHandCardIds = new Set<CardInstanceId>()
  private handMaskInitialized = false

  private syncTurn(manager: GameManager): void {
    const { turn, activePlayerId } = manager.state
    if (this.turn === turn && this.playerId === activePlayerId) {
      return
    }

    this.turn = turn
    this.playerId = activePlayerId
    this.ralliedCardIds.clear()
    this.ignoredHandCardIds.clear()
    this.handMaskInitialized = false
  }

  getIgnoredHandCardIds(
    manager: GameManager,
    ignoredCount: number,
    random: () => number,
  ): ReadonlySet<CardInstanceId> {
    this.syncTurn(manager)
    if (this.handMaskInitialized) {
      return this.ignoredHandCardIds
    }

    const candidates = [...GameManager.getCurrentPlayer(manager).hand]
    const count = Math.min(ignoredCount, candidates.length)
    for (let index = 0; index < count; index += 1) {
      const randomValue = random()
      if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
        throw new Error('AI random must return a value from 0 (inclusive) to 1 (exclusive).')
      }
      const selectedIndex = Math.floor(randomValue * candidates.length)
      const [cardId] = candidates.splice(selectedIndex, 1)
      this.ignoredHandCardIds.add(cardId)
    }
    this.handMaskInitialized = true
    return this.ignoredHandCardIds
  }

  allows(manager: GameManager, action: GameAction): boolean {
    this.syncTurn(manager)
    return (
      !isRallyAction(action) ||
      !this.ralliedCardIds.has(action.sourceCardId)
    )
  }

  remember(manager: GameManager, action: GameAction): void {
    this.syncTurn(manager)
    if (isRallyAction(action)) {
      this.ralliedCardIds.add(action.sourceCardId)
    }
  }
}

const chooseBattleAction = (
  manager: GameManager,
  aiPlayerId: PlayerId,
  ignoredHandCardIds: ReadonlySet<CardInstanceId>,
): GameAction => {
  const noAttackScore = evaluateBattleEntry(
    resolveBattleOption(manager, null).manager,
    aiPlayerId,
    ignoredHandCardIds,
  ).total
  let bestAction: GameAction | null = null
  let bestScore = noAttackScore

  for (const action of GameManager.getLegalBattleActions(manager)) {
    const resolved = resolveBattleOption(manager, action)
    const resolvedManager = resolved.manager
    if (GameManager.getWinner(resolvedManager) === aiPlayerId) {
      return action
    }
    const score = evaluateBattleEntry(
      resolvedManager,
      aiPlayerId,
      ignoredHandCardIds,
    ).total + getPlunderFutureDeployableHandValue(
      resolvedManager,
      aiPlayerId,
      resolved.attackerManaGain,
      resolvedManager.state.players[aiPlayerId].mana,
    )
    if (isMeaningfullyGreater(score, bestScore)) {
      bestAction = action
      bestScore = score
    }
  }

  return bestAction ?? { type: 'passPhase' }
}

export class GameAI {
  private readonly turnMemory = new AiTurnActionMemory()
  private readonly difficulty: AiDifficulty
  private readonly random: () => number

  constructor({ difficulty = 'hard', random = Math.random }: GameAIOptions = {}) {
    this.difficulty = difficulty
    this.random = random
  }

  private getIgnoredHandCardIds(manager: GameManager): ReadonlySet<CardInstanceId> {
    return this.turnMemory.getIgnoredHandCardIds(
      manager,
      AI_DIFFICULTY_IGNORED_HAND_COUNT[this.difficulty],
      this.random,
    )
  }

  private getMainActions(
    manager: GameManager,
    ignoredHandCardIds: ReadonlySet<CardInstanceId>,
  ): GameAction[] {
    return GameManager.getLegalMainActions(manager).filter(
      (action) => {
        if (!this.turnMemory.allows(manager, action)) {
          return false
        }
        switch (action.type) {
          case 'summonCreature':
          case 'playSpell':
          case 'discardFromHand':
            return !ignoredHandCardIds.has(action.cardId)
          default:
            return true
        }
      },
    )
  }

  static evaluate(
    manager: GameManager,
    aiPlayerId: PlayerId = manager.state.activePlayerId,
    ignoredHandCardIds?: ReadonlySet<CardInstanceId>,
  ): EvaluationBreakdown {
    return manager.state.phase === 'main'
      ? evaluateMainContinuation(manager, aiPlayerId, ignoredHandCardIds)
      : evaluateBattleEntry(manager, aiPlayerId, ignoredHandCardIds)
  }

  chooseAction(manager: GameManager): GameAction | null {
    if (GameManager.getWinner(manager) !== null) {
      return null
    }
    if (manager.state.pendingCombat !== null) {
      return { type: 'finishCombat' }
    }

    const aiPlayerId = manager.state.activePlayerId
    switch (manager.state.phase) {
      case 'keepUp':
        return { type: 'resolveKeepUp' }
      case 'main': {
        const ignoredHandCardIds = this.getIgnoredHandCardIds(manager)
        const action = chooseMainAction(
          manager,
          aiPlayerId,
          this.getMainActions(manager, ignoredHandCardIds),
          ignoredHandCardIds,
          this.difficulty,
        )
        this.turnMemory.remember(manager, action)
        return action
      }
      case 'battle':
        return chooseBattleAction(
          manager,
          aiPlayerId,
          this.getIgnoredHandCardIds(manager),
        )
      case 'cleanup':
        return { type: 'passPhase' }
    }
  }
}
