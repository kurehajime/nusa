import { useEffect, useReducer, useRef, useState } from 'react'
import { LayoutGroup, motion, MotionConfig } from 'motion/react'
import {
  GameAI,
  GameManager,
  THEME_DECK_BY_ID,
  THEME_DECK_IDS,
  addScenarioReward,
  getScenarioComDeck,
  getScenarioRewardChoices,
  getScenarioOpponentDeckIds,
  resolveScenarioBattle,
  type AiDifficulty,
  type ActivatedAbilityOption,
  type CardInstanceId,
  type CardDefinitionId,
  type PlaySpellAction,
  type PlayerId,
  type ThemeDeckId,
} from '../game'
import BoardView, { type BoardAttackAnimation } from './BoardView'
import GameSetup, {
  type BattleMode,
  type GameSetupSelection,
} from './GameSetup'
import HandView from './HandView'
import ScenarioProgressDialog from './ScenarioProgressDialog'
import TitleScreen from './TitleScreen'
import { getDeckBackgroundStyle } from './deckBackground'

const COMBAT_EFFECT_DURATION_MS = 500
const AI_ACTION_DELAY_MS = 700
const SCENARIO_WIN_DIALOG_DELAY_MS = 500
const AI_PLAYER_ID = 'playerB'

type GameUiState = {
  manager: GameManager
  selectedCardId: CardInstanceId | null
  message: string | null
}

type GameUiAction =
  | { type: 'selectCard'; cardId: CardInstanceId }
  | { type: 'applyGameUpdate'; update: (manager: GameManager) => GameManager }

type GameSelection = {
  playerDeckId: ThemeDeckId
  comDeckId: ThemeDeckId
  difficulty: AiDifficulty
}

type ScenarioRun = {
  opponentDeckIds: ThemeDeckId[]
  currentBattleIndex: number
  playerCardDefinitionIds: CardDefinitionId[]
}

type GameSessionProps = GameSelection & {
  scenarioRun: ScenarioRun | null
  onResultConfirm: (winnerId: PlayerId, rewardId?: CardDefinitionId) => void
}

const createGameUiState = ({
  playerDeckId,
  comDeckId,
  difficulty,
  scenarioRun,
}: GameSelection & { scenarioRun: ScenarioRun | null }): GameUiState => ({
  manager: GameManager.create(Math.random, {
    playerA: scenarioRun?.playerCardDefinitionIds ?? THEME_DECK_BY_ID[playerDeckId].cardDefinitionIds,
    playerB: scenarioRun
      ? getScenarioComDeck(comDeckId, difficulty, scenarioRun.currentBattleIndex)
      : THEME_DECK_BY_ID[comDeckId].cardDefinitionIds,
  }),
  selectedCardId: null,
  message: null,
})

const gameUiReducer = (state: GameUiState, action: GameUiAction): GameUiState => {
  if (action.type === 'selectCard') {
    return {
      ...state,
      selectedCardId: state.selectedCardId === action.cardId ? null : action.cardId,
      message: null,
    }
  }

  try {
    return {
      manager: action.update(state.manager),
      selectedCardId: null,
      message: null,
    }
  } catch (error) {
    return {
      ...state,
      message: error instanceof Error ? error.message : '操作できません。',
    }
  }
}

const GameSession = ({
  playerDeckId,
  comDeckId,
  difficulty,
  scenarioRun,
  onResultConfirm,
}: GameSessionProps) => {
  const aiRef = useRef<GameAI | null>(null)
  const attackAnimationIdRef = useRef(0)
  const [attackAnimation, setAttackAnimation] = useState<BoardAttackAnimation | null>(null)
  if (aiRef.current === null) {
    aiRef.current = new GameAI({ difficulty, random: Math.random })
  }
  const ai = aiRef.current
  const [showScenarioIntro, setShowScenarioIntro] = useState(
    scenarioRun?.currentBattleIndex === 0,
  )
  const [showScenarioWinResult, setShowScenarioWinResult] = useState(false)
  const [rewardChoices, setRewardChoices] = useState<CardDefinitionId[]>([])
  const [{ manager, selectedCardId, message }, dispatch] = useReducer(
    gameUiReducer,
    { playerDeckId, comDeckId, difficulty, scenarioRun },
    createGameUiState,
  )
  const { state } = manager
  const playerA = state.players.playerA
  const playerB = state.players.playerB
  const winnerId = GameManager.getWinner(manager)
  const winnerMessage =
    winnerId === null || scenarioRun !== null
      ? null
      : `${state.players[winnerId].name}の勝利`
  const currentPlayer = GameManager.getCurrentPlayer(manager)
  const selectedCard = selectedCardId === null ? null : state.cards[selectedCardId] ?? null
  const playerAHand = playerA.hand.map((cardId) => state.cards[cardId])
  const playerBHand = playerB.hand.map((cardId) => state.cards[cardId])
  const boardGroups = GameManager.getBoardGroups(manager)
  const creatureStatModifiers = Object.fromEntries(
    state.board.creatures.map(({ cardId }) => [
      cardId,
      GameManager.getCreatureStatModifier(manager, cardId),
    ]),
  )
  const selectedSummonOptions =
    selectedCard?.card.kind === 'creature'
      ? GameManager.getSummonOptions(manager, selectedCard.id)
      : []
  const selectedSpellActions =
    selectedCard?.card.kind === 'spell'
      ? GameManager.getSpellPlayActions(manager, selectedCard.id)
      : []
  const selectedSpellTargetActions = selectedSpellActions.filter(
    (action) => action.target !== undefined,
  )
  const playableCardIds = new Set(
    currentPlayer.hand.filter((cardId) => GameManager.isCardPlayable(manager, cardId)),
  )
  const directlyPlayableSpellIds = new Set(
    currentPlayer.hand.filter((cardId) =>
      GameManager.getSpellPlayActions(manager, cardId).some(
        (action) => action.target === undefined,
      ),
    ),
  )
  const discardableCardIds = new Set<CardInstanceId>(
    state.activePlayerId === 'playerA' &&
      state.phase === 'main' &&
      !state.hasDiscardedThisTurn &&
      state.pendingCombat === null &&
      winnerId === null
      ? playerA.hand
      : [],
  )
  const activatedAbilities = GameManager.getActivatedAbilities(manager)
  const playerDamageMarker =
    state.pendingCombat?.playerWasHit === true
      ? {
        playerId: state.pendingCombat.defendingPlayerId,
        damage: state.pendingCombat.playerDamage,
      }
      : null
  const manaRefundCardIds =
    state.pendingCombat?.destroyedCardIds.filter(
      (cardId) => GameManager.getDestructionManaRefund(manager, cardId) > 0,
    ) ?? []

  useEffect(() => {
    if (!state.pendingCombat) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      dispatch({
        type: 'applyGameUpdate',
        update: (currentManager) => GameManager.finishCombat(currentManager),
      })
    }, COMBAT_EFFECT_DURATION_MS)

    return () => window.clearTimeout(timeoutId)
  }, [state.pendingCombat])

  useEffect(() => {
    if (scenarioRun === null || winnerId !== 'playerA') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (scenarioRun.currentBattleIndex < scenarioRun.opponentDeckIds.length - 1) {
        setRewardChoices(getScenarioRewardChoices(scenarioRun.playerCardDefinitionIds))
      }
      setShowScenarioWinResult(true)
    }, SCENARIO_WIN_DIALOG_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [scenarioRun, winnerId])

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    const handleDebugKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        event.key.toLowerCase() !== 'm' ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)))
      ) {
        return
      }

      dispatch({
        type: 'applyGameUpdate',
        update: (currentManager) =>
          GameManager.addDebugMana(currentManager, 'playerA'),
      })
    }

    window.addEventListener('keydown', handleDebugKeyDown)
    return () => window.removeEventListener('keydown', handleDebugKeyDown)
  }, [])

  useEffect(() => {
    if (
      state.activePlayerId !== AI_PLAYER_ID ||
      state.pendingCombat !== null ||
      winnerId !== null
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const action = ai.chooseAction(manager)
      if (action?.type === 'attackGroup') {
        attackAnimationIdRef.current += 1
        setAttackAnimation({
          id: attackAnimationIdRef.current,
          ownerId: AI_PLAYER_ID,
          startIndex: action.startIndex,
          endIndex: action.endIndex,
        })
      }

      dispatch({
        type: 'applyGameUpdate',
        update: (currentManager) => {
          if (
            currentManager.state.activePlayerId !== AI_PLAYER_ID ||
            currentManager.state.pendingCombat !== null ||
            GameManager.getWinner(currentManager) !== null
          ) {
            return currentManager
          }
          return action === null
            ? currentManager
            : GameManager.applyAction(currentManager, action)
        },
      })
    }, AI_ACTION_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [ai, manager, state.activePlayerId, state.pendingCombat, winnerId])

  const applyGameUpdate = (update: (currentManager: GameManager) => GameManager) => {
    dispatch({ type: 'applyGameUpdate', update })
  }

  const handlePassPhase = () => {
    applyGameUpdate((currentManager) => {
      const endingPlayerId = currentManager.state.activePlayerId
      let nextManager = currentManager

      while (nextManager.state.activePlayerId === endingPlayerId) {
        nextManager = GameManager.passPhase(nextManager)
      }

      return nextManager
    })
  }

  const handleCardClick = (cardId: CardInstanceId) => {
    dispatch({ type: 'selectCard', cardId })
  }

  const handleDiscardCard = (cardId: CardInstanceId) => {
    applyGameUpdate((currentManager) => GameManager.discardFromHand(currentManager, cardId))
  }

  const handleInsertClick = (insertIndex: number) => {
    if (selectedCardId === null) {
      return
    }

    applyGameUpdate((currentManager) =>
      GameManager.summonCreature(currentManager, selectedCardId, insertIndex),
    )
  }

  const handlePlaySpell = (cardId: CardInstanceId) => {
    applyGameUpdate((currentManager) => {
      const action = GameManager.getSpellPlayActions(currentManager, cardId).find(
        (candidate) => candidate.target === undefined,
      )
      return action
        ? GameManager.applyAction(currentManager, action)
        : currentManager
    })
  }

  const handlePlaySpellTarget = (action: PlaySpellAction) => {
    applyGameUpdate((currentManager) => GameManager.applyAction(currentManager, action))
  }

  const handleGroupAttack = (startIndex: number, endIndex: number) => {
    attackAnimationIdRef.current += 1
    setAttackAnimation({
      id: attackAnimationIdRef.current,
      ownerId: 'playerA',
      startIndex,
      endIndex,
    })
    applyGameUpdate((currentManager) =>
      GameManager.attackGroup(currentManager, startIndex, endIndex),
    )
  }

  const handleActivateAbility = (ability: ActivatedAbilityOption) => {
    applyGameUpdate((currentManager) =>
      GameManager.activateAbility(
        currentManager,
        ability.sourceCardId,
        ability.abilityType,
      ),
    )
  }

  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
    >
      <LayoutGroup id="game-card-layout">
        <main
          className="game-shell"
          style={getDeckBackgroundStyle(comDeckId)}
        >
          <header className="game-header">
            <h1>nusa</h1>
          </header>
          {message && winnerId === null && (
            <div className="game-message" role="status">
              {message}
            </div>
          )}
          <HandView
            cards={playerBHand}
            faceDown
            playerName={playerB.name}
            position="top"
            playableCardIds={undefined}
            active={state.activePlayerId === 'playerB'}
            disabled
            selectedCardId={null}
            onCardClick={handleCardClick}
          />
          <BoardView
            board={state.board}
            cards={state.cards}
            damageMarkers={state.pendingCombat?.damageMarkers ?? []}
            destroyedCardIds={state.pendingCombat?.destroyedCardIds ?? []}
            manaRefundCardIds={manaRefundCardIds}
            playerDamageMarker={playerDamageMarker}
            players={state.players}
            playerBarriers={{
              playerA: GameManager.getPlayerBarrier(manager, 'playerA'),
              playerB: GameManager.getPlayerBarrier(manager, 'playerB'),
            }}
            playerDeckColors={{
              playerA: THEME_DECK_BY_ID[playerDeckId].colors,
              playerB: THEME_DECK_BY_ID[comDeckId].colors,
            }}
            playerDeckIds={{
              playerA: playerDeckId,
              playerB: comDeckId,
            }}
            activePlayerId={state.activePlayerId}
            groups={boardGroups}
            creatureStatModifiers={creatureStatModifiers}
            summonOptions={selectedSummonOptions}
            spellTargetActions={selectedSpellTargetActions}
            activatedAbilities={
              state.activePlayerId === 'playerA' && winnerId === null
                ? activatedAbilities
                : []
            }
            attackAnimation={attackAnimation}
            canAttack={
              state.activePlayerId === 'playerA' &&
              ['main', 'battle'].includes(state.phase) &&
              !state.hasAttackedThisTurn &&
              GameManager.canCurrentPlayerAttack(manager) &&
              state.pendingCombat === null &&
              winnerId === null
            }
            onInsertClick={handleInsertClick}
            onGroupAttack={handleGroupAttack}
            onActivateAbility={handleActivateAbility}
            onPlaySpellTarget={handlePlaySpellTarget}
          />
          <div className="player-hand-row">
            <div className="player-hand-row-spacer" aria-hidden="true" />
            <HandView
              cards={playerAHand}
              playerName={playerA.name}
              position="bottom"
              playableCardIds={state.activePlayerId === 'playerA' ? playableCardIds : undefined}
              directlyPlayableSpellIds={
                state.activePlayerId === 'playerA'
                  ? directlyPlayableSpellIds
                  : undefined
              }
              discardableCardIds={discardableCardIds}
              active={state.activePlayerId === 'playerA'}
              disabled={
                state.activePlayerId !== 'playerA' ||
                state.phase !== 'main' ||
                winnerId !== null
              }
              selectedCardId={state.activePlayerId === 'playerA' ? selectedCardId : null}
              onCardClick={handleCardClick}
              onDiscardCard={handleDiscardCard}
              onPlaySpell={handlePlaySpell}
            />
            <button
              className="turn-end-button"
              type="button"
              aria-label="ターン終了"
              disabled={
                state.activePlayerId === AI_PLAYER_ID ||
                state.phase === 'keepUp' ||
                state.pendingCombat !== null ||
                winnerId !== null
              }
              onClick={handlePassPhase}
            >
              ターン
              <br />
              終了
            </button>
          </div>
          {winnerMessage !== null && (
            <motion.div
              className="game-result-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <motion.div
                className="game-result-band"
                data-result={winnerId === 'playerA' ? 'win' : 'loss'}
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.08, duration: 0.38, ease: 'easeOut' }}
              >
                <p className="game-result-message" role="status" aria-live="assertive">
                  {winnerMessage}
                </p>
                <button
                  className="game-result-confirm"
                  type="button"
                  autoFocus
                  onClick={() => {
                    if (winnerId !== null) {
                      onResultConfirm(winnerId)
                    }
                  }}
                >
                  OK
                </button>
              </motion.div>
            </motion.div>
          )}
          {scenarioRun !== null &&
            (showScenarioIntro || winnerId === 'playerB' || showScenarioWinResult) && (
              <ScenarioProgressDialog
                opponentDeckIds={scenarioRun.opponentDeckIds}
                currentBattleIndex={scenarioRun.currentBattleIndex}
                rewardChoices={rewardChoices}
                playerCardDefinitionIds={scenarioRun.playerCardDefinitionIds}
                result={
                  winnerId === null
                    ? 'intro'
                    : winnerId === 'playerA'
                      ? 'win'
                      : 'loss'
                }
                onConfirm={(rewardId) => {
                  if (winnerId === null) {
                    setShowScenarioIntro(false)
                  } else {
                    if (rewardChoices.length > 0 &&
                      (rewardId === undefined || !rewardChoices.includes(rewardId))) {
                      return
                    }
                    onResultConfirm(winnerId, rewardId)
                  }
                }}
              />
            )}
        </main>
      </LayoutGroup>
    </MotionConfig>
  )
}

const GameApp = () => {
  const [setupMode, setSetupMode] = useState<BattleMode>('scenario')
  const [selection, setSelection] = useState<GameSelection>({
    playerDeckId: THEME_DECK_IDS.RED_TOTAL_ASSAULT,
    comDeckId: THEME_DECK_IDS.RED_BLUE_SKIRMISH,
    difficulty: 'easy',
  })
  const [scenarioRun, setScenarioRun] = useState<ScenarioRun | null>(null)
  const [screen, setScreen] = useState<'title' | 'setup' | 'game'>('title')

  const returnToSetup = () => {
    setScenarioRun(null)
    setScreen('setup')
  }

  const returnToTitle = (nextSelection: GameSetupSelection) => {
    setSelection((current) => ({
      ...current,
      playerDeckId: nextSelection.playerDeckId,
      difficulty: nextSelection.difficulty,
      ...(nextSelection.mode === 'free' ? { comDeckId: nextSelection.comDeckId } : {}),
    }))
    setScreen('title')
  }

  const startGame = (nextSelection: GameSetupSelection) => {
    setSetupMode(nextSelection.mode)
    if (nextSelection.mode === 'scenario') {
      const opponentDeckIds = getScenarioOpponentDeckIds(nextSelection.playerDeckId)
      const firstOpponentDeckId = opponentDeckIds[0]
      if (!firstOpponentDeckId) {
        return
      }
      setSelection({
        playerDeckId: nextSelection.playerDeckId,
        comDeckId: firstOpponentDeckId,
        difficulty: nextSelection.difficulty,
      })
      setScenarioRun({
        opponentDeckIds,
        currentBattleIndex: 0,
        playerCardDefinitionIds: [...THEME_DECK_BY_ID[nextSelection.playerDeckId].cardDefinitionIds],
      })
    } else {
      setSelection({
        playerDeckId: nextSelection.playerDeckId,
        comDeckId: nextSelection.comDeckId,
        difficulty: nextSelection.difficulty,
      })
      setScenarioRun(null)
    }
    setScreen('game')
  }

  const handleResultConfirm = (winnerId: PlayerId, rewardId?: CardDefinitionId) => {
    if (scenarioRun === null) {
      returnToSetup()
      return
    }

    const resolution = resolveScenarioBattle(
      scenarioRun.currentBattleIndex,
      scenarioRun.opponentDeckIds.length,
      winnerId === 'playerA',
    )
    if (resolution.type !== 'advance') {
      returnToSetup()
      return
    }

    const nextOpponentDeckId =
      scenarioRun.opponentDeckIds[resolution.nextBattleIndex]
    const playerCardDefinitionIds = addScenarioReward(scenarioRun.playerCardDefinitionIds, rewardId)
    setSelection((current) => ({ ...current, comDeckId: nextOpponentDeckId }))
    setScenarioRun({
      ...scenarioRun,
      currentBattleIndex: resolution.nextBattleIndex,
      playerCardDefinitionIds,
    })
  }

  if (screen === 'title') {
    return (
      <TitleScreen
        playerDeckId={selection.playerDeckId}
        onSelectMode={(mode) => {
          setSetupMode(mode)
          setScreen('setup')
        }}
      />
    )
  }

  if (screen === 'setup') {
    return (
      <GameSetup
        mode={setupMode}
        initialPlayerDeckId={selection.playerDeckId}
        initialComDeckId={selection.comDeckId}
        initialDifficulty={selection.difficulty}
        onStart={startGame}
        onBack={returnToTitle}
      />
    )
  }

  return (
    <GameSession
      key={
        scenarioRun
          ? `scenario-${selection.playerDeckId}-${scenarioRun.currentBattleIndex}`
          : `free-${selection.playerDeckId}-${selection.comDeckId}`
      }
      {...selection}
      scenarioRun={scenarioRun}
      onResultConfirm={handleResultConfirm}
    />
  )
}

export default GameApp
