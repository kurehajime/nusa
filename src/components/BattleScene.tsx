import type { ReactNode } from 'react'
import { LayoutGroup, MotionConfig } from 'motion/react'
import {
  GameManager,
  THEME_DECK_BY_ID,
  type ActivatedAbilityOption,
  type CardInstanceId,
  type PlaySpellAction,
  type ThemeDeckId,
} from '../game'
import BoardView, { type BoardAttackAnimation } from './BoardView'
import HandView from './HandView'
import { getDeckBackgroundStyle } from './deckBackground'

type BattleSceneProps = {
  manager: GameManager
  playerDeckId: ThemeDeckId
  comDeckId: ThemeDeckId
  selectedCardId?: CardInstanceId | null
  message?: string | null
  attackAnimation?: BoardAttackAnimation | null
  onCardClick?: (cardId: CardInstanceId) => void
  onInsertClick?: (insertIndex: number) => void
  onGroupAttack?: (startIndex: number, endIndex: number) => void
  onActivateAbility?: (ability: ActivatedAbilityOption) => void
  onPlaySpellTarget?: (action: PlaySpellAction) => void
  onDiscardCard?: (cardId: CardInstanceId) => void
  onPlaySpell?: (cardId: CardInstanceId) => void
  onPassPhase?: () => void
  children?: ReactNode
  as?: 'main' | 'div'
  layoutId?: string
}

const BattleScene = ({
  manager,
  playerDeckId,
  comDeckId,
  selectedCardId = null,
  message = null,
  attackAnimation = null,
  onCardClick,
  onInsertClick,
  onGroupAttack,
  onActivateAbility,
  onPlaySpellTarget,
  onDiscardCard,
  onPlaySpell,
  onPassPhase,
  children,
  as: Root = 'main',
  layoutId = 'game-card-layout',
}: BattleSceneProps) => {
  const { state } = manager
  const { playerA, playerB } = state.players
  const winnerId = GameManager.getWinner(manager)
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


  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
    >
      <LayoutGroup id={layoutId}>
        <Root className="game-shell" style={getDeckBackgroundStyle(comDeckId)}>
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
            onCardClick={onCardClick}
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
            onInsertClick={onInsertClick}
            onGroupAttack={onGroupAttack}
            onActivateAbility={onActivateAbility}
            onPlaySpellTarget={onPlaySpellTarget}
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
              onCardClick={onCardClick}
              onDiscardCard={onDiscardCard}
              onPlaySpell={onPlaySpell}
            />
            <button
              className="turn-end-button"
              type="button"
              aria-label="ターン終了"
              disabled={
                state.activePlayerId === 'playerB' ||
                state.phase === 'keepUp' ||
                state.pendingCombat !== null ||
                winnerId !== null
              }
              onClick={onPassPhase}
            >
              ターン
              <br />
              終了
            </button>
          </div>
          {children}
        </Root>
      </LayoutGroup>
    </MotionConfig>
  )
}

export default BattleScene
