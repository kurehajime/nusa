import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { motion, useAnimationControls } from 'motion/react'
import type {
  ActivatedAbilityOption,
  Board,
  CardInstance,
  CardInstanceId,
  CardColor,
  DamageMarker,
  EffectiveBoardGroup,
  CreatureStatModifier,
  PlayerId,
  PlayerState,
  PlaySpellAction,
  SummonOption,
  ThemeDeckId,
} from '../game'
import CardView from './CardView'
import GraveyardSummary from './GraveyardSummary'
import ManaRefundEffects from './ManaRefundEffects'
import { PLAYER_IMAGE_BY_DECK_ID } from './playerImages'

export type BoardAttackAnimation = {
  id: number
  ownerId: PlayerId
  startIndex: number
  endIndex: number
}

type BoardViewProps = {
  board: Board
  cards: Record<CardInstanceId, CardInstance>
  damageMarkers?: DamageMarker[]
  destroyedCardIds?: CardInstanceId[]
  manaRefundCardIds?: CardInstanceId[]
  playerDamageMarker?: { playerId: PlayerId; damage: number } | null
  players: Record<PlayerState['id'], PlayerState>
  playerBarriers: Record<PlayerId, number>
  playerDeckColors: Record<PlayerId, readonly [CardColor, ...CardColor[]]>
  playerDeckIds: Record<PlayerId, ThemeDeckId>
  activePlayerId: PlayerId
  groups: EffectiveBoardGroup[]
  creatureStatModifiers: Record<CardInstanceId, CreatureStatModifier>
  summonOptions?: SummonOption[]
  activatedAbilities?: ActivatedAbilityOption[]
  spellTargetActions?: PlaySpellAction[]
  attackAnimation?: BoardAttackAnimation | null
  canAttack?: boolean
  onInsertClick?: (insertIndex: number) => void
  onGroupAttack?: (startIndex: number, endIndex: number) => void
  onActivateAbility?: (ability: ActivatedAbilityOption) => void
  onPlaySpellTarget?: (action: PlaySpellAction) => void
}

type BoardPlayerProps = {
  player: PlayerState
  cards: Record<CardInstanceId, CardInstance>
  barrier: number
  deckColors: readonly [CardColor, ...CardColor[]]
  imageUrl: string
  damage: number | null
}

type SummonSlotState = 'available' | 'reachable' | 'unreachable'
type PlayerDamageLevel = 'normal' | 'large' | 'critical'

const BOARD_SCROLL_PADDING = 12

// Keep the opponent farther up and our cards closer, with buttons outside them.
const getBoardCardGridRow = (ownerId: PlayerId): string =>
  ownerId === 'playerA' ? '3 / 5' : '2 / 4'

const DAMAGE_MARKER_STYLE = {
  '--damage-marker-icon': `url("${import.meta.env.BASE_URL}damage.svg")`,
} as CSSProperties

const PLAYER_ICON_URL = `${import.meta.env.BASE_URL}player.svg`

const PLAYER_COLOR_VALUES = {
  red: '#6f3028',
  blue: '#2b5278',
  green: '#315d42',
} satisfies Record<CardColor, string>

const getAttackTiltDegrees = (
  cardId: CardInstanceId,
  boardIndex: number,
  animationId: number,
  ownerId: PlayerId,
): number => {
  let hash = Math.imul(animationId + 1, 0x045d_9f3b) >>> 0
  const serializedCardId = String(cardId)
  for (let index = 0; index < serializedCardId.length; index += 1) {
    hash = Math.imul(hash ^ serializedCardId.charCodeAt(index), 16_777_619) >>> 0
  }
  hash = (hash + Math.imul(boardIndex + 1, 0x9e37_79b1)) >>> 0
  hash = (hash ^ (hash >>> 16)) >>> 0
  hash = Math.imul(hash, 0x7feb_352d) >>> 0
  hash = (hash ^ (hash >>> 15)) >>> 0
  const magnitude = 4 + ((hash % 61 + boardIndex * 23) % 61) / 10
  return ownerId === 'playerA' ? magnitude : -magnitude
}

const CARD_COLOR_LABELS = {
  red: '赤',
  blue: '青',
  green: '緑',
} as const

const getPlayerDamageLevel = (damage: number): PlayerDamageLevel => {
  if (damage >= 10) {
    return 'critical'
  }
  return damage >= 5 ? 'large' : 'normal'
}

const getSummonSlotState = (option?: SummonOption): SummonSlotState | null => {
  if (!option) {
    return null
  }
  if (!option.canReach) {
    return 'unreachable'
  }
  return option.affordable ? 'available' : 'reachable'
}

const getSummonSlotClassName = (option?: SummonOption, empty = false): string => {
  const state = getSummonSlotState(option)
  return [
    'board-insert-slot',
    empty ? 'board-insert-slot-empty' : '',
    state ? `board-insert-slot-${state}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const getSummonSlotTitle = (option?: SummonOption): string | undefined => {
  if (!option) {
    return undefined
  }
  if (!option.canReach) {
    return `進軍不可 / 必要進軍 ${option.requiredMarch}`
  }
  if (!option.affordable) {
    return `進軍可能 / コスト ${option.effectiveCost}（マナ不足）`
  }
  return `進軍可能 / コスト ${option.effectiveCost}`
}

const BoardPlayer = ({
  player,
  cards,
  barrier,
  deckColors,
  imageUrl,
  damage,
}: BoardPlayerProps) => {
  const mainColor = deckColors[0]
  const subColor = deckColors[1] ?? mainColor
  const placedSpell = player.placedSpell
  const placedSpellCard =
    placedSpell === null ? null : cards[placedSpell.cardId].card
  const exileColor =
    placedSpellCard?.kind === 'spell' && 'exileColor' in placedSpellCard.effect
      ? placedSpellCard.effect.exileColor
      : null
  const damageLevel = damage === null ? 'normal' : getPlayerDamageLevel(damage)
  const shakeDistance = damageLevel === 'critical' ? 20 : damageLevel === 'large' ? 13 : 8
  const verticalShake = damageLevel === 'critical' ? 4 : damageLevel === 'large' ? 2 : 1
  const shakeDuration = damageLevel === 'critical' ? 0.48 : damageLevel === 'large' ? 0.4 : 0.34

  return (
    <section
      className={`board-player board-player-${player.id}`}
      aria-label={`${player.name} field`}
    >
      <dl className="board-player-stats">
        <div>
          <dt>HP</dt>
          <dd>{player.hp}</dd>
        </div>
        <div>
          <dt>Mana</dt>
          <dd>{player.mana}</dd>
        </div>
      </dl>
      <motion.div
        className="board-endpoint"
        data-player-id={player.id}
        data-main-color={mainColor}
        data-sub-color={subColor}
        style={
          {
            '--player-main-color': PLAYER_COLOR_VALUES[mainColor],
            '--player-sub-color': PLAYER_COLOR_VALUES[subColor],
          } as CSSProperties
        }
        initial={false}
        animate={
          damage !== null && damage >= 1
            ? {
                x: [
                  0,
                  -shakeDistance,
                  shakeDistance * 0.88,
                  -shakeDistance * 0.63,
                  shakeDistance * 0.5,
                  -shakeDistance * 0.25,
                  0,
                ],
                y: [
                  0,
                  verticalShake,
                  -verticalShake,
                  verticalShake,
                  -verticalShake,
                  0,
                  0,
                ],
              }
            : { x: 0, y: 0 }
        }
        transition={{ duration: shakeDuration, ease: 'easeInOut' }}
      >
        <img
          className={`board-player-icon board-player-icon-${player.id}`}
          src={imageUrl}
          alt=""
          aria-hidden="true"
        />
        <span className="board-player-identity">
          <span>{player.name}</span>
          <small className="board-player-barrier">(シールド:{barrier})</small>
        </span>
        {damage !== null && (
          <span
            className={`damage-marker player-damage-marker player-damage-marker-${damageLevel}`}
            role="status"
            aria-label={`プレイヤーに${damage}ダメージ`}
            style={DAMAGE_MARKER_STYLE}
          >
            {damage}
          </span>
        )}
      </motion.div>
      <GraveyardSummary player={player} cards={cards} />
      <div
        className={`board-spell ${placedSpell === null ? 'board-spell-empty' : ''}`}
        aria-label={`${player.name} spell`}
      >
        <CardView
          key={placedSpell?.cardId ?? 'empty'}
          card={placedSpellCard}
          compact
          jitterArt
          flashFoilOnMount
        />
        {placedSpell !== null && exileColor !== null && (
          <span
            className={`spell-exile-token spell-exile-token-${exileColor}`}
            role="status"
            aria-label={`${CARD_COLOR_LABELS[exileColor]}のクリーチャーを${placedSpell.effectAmount}枚除外`}
          >
            {placedSpell.effectAmount}
          </span>
        )}
      </div>
    </section>
  )
}

type BoardGroupButtonProps = {
  group: EffectiveBoardGroup
  activePlayerId: PlayerId
  animationId: number | null
  canAttack: boolean
  spellTargetAction?: PlaySpellAction
  spellName?: string
  onAttack?: (startIndex: number, endIndex: number) => void
  onPlaySpellTarget?: (action: PlaySpellAction) => void
}

type SummonImpactProps = {
  enabled: boolean
  children: ReactNode
}

const SummonImpact = ({ enabled, children }: SummonImpactProps) => {
  const animationControls = useAnimationControls()
  const flashControls = useAnimationControls()

  useEffect(() => {
    if (!enabled) {
      return
    }

    void animationControls.start({
      scale: [1.48, 1.24, 1, 0.975, 1],
      y: [0, 0, 0, 4, 0],
      opacity: [0.78, 0.94, 1, 1, 1],
      filter: [
        'brightness(0.88) blur(2.5px) drop-shadow(0 36px 30px rgb(18 12 8 / 22%))',
        'brightness(1) blur(0.8px) drop-shadow(0 20px 18px rgb(18 12 8 / 36%))',
        'brightness(1.28) blur(0) drop-shadow(0 2px 3px rgb(18 12 8 / 82%))',
        'brightness(1.08) blur(0) drop-shadow(0 1px 6px rgb(18 12 8 / 56%))',
        'brightness(1) blur(0) drop-shadow(0 0 0 rgb(18 12 8 / 0%))',
      ],
      transition: {
        delay: 0.04,
        duration: 0.52,
        times: [0, 0.4, 0.64, 0.72, 1],
        ease: 'linear',
      },
    })
    void flashControls.start({
      opacity: [0, 0, 0.9, 0],
      scale: [0.82, 0.82, 1.04, 1.38],
      transition: {
        delay: 0.04,
        duration: 0.52,
        times: [0, 0.57, 0.64, 1],
        ease: 'easeOut',
      },
    })
  }, [animationControls, enabled, flashControls])

  return (
    <motion.div className="board-summon-impact" animate={animationControls}>
      <motion.span
        className="board-summon-impact-flash"
        aria-hidden="true"
        animate={flashControls}
      />
      {children}
    </motion.div>
  )
}

const BoardGroupButton = ({
  group,
  activePlayerId,
  animationId,
  canAttack,
  spellTargetAction,
  spellName,
  onAttack,
  onPlaySpellTarget,
}: BoardGroupButtonProps) => {
  const animationControls = useAnimationControls()
  const pokeDistance = group.ownerId === 'playerA' ? 10 : -10

  useEffect(() => {
    if (animationId === null) {
      return
    }

    void animationControls.start({
      x: [0, pokeDistance, 0],
      transition: { duration: 0.2, times: [0, 0.4, 1], ease: 'easeOut' },
    })
  }, [animationControls, animationId, pokeDistance])

  return (
    <motion.button
      className={`board-group-button board-group-${group.ownerId} ${spellTargetAction ? 'board-group-spell-target' : ''}`}
      style={{
        gridColumn: `${group.startIndex * 2 + 2} / ${group.endIndex * 2 + 3}`,
        gridRow: group.ownerId === 'playerB' ? 1 : 5,
      }}
      animate={animationControls}
      type="button"
      aria-label={
        spellTargetAction
          ? `${spellName ?? '魔法'}の対象に攻${group.attack}、防${group.defense}のグループを選ぶ`
          : undefined
      }
      disabled={
        spellTargetAction === undefined &&
        (!canAttack || activePlayerId !== group.ownerId)
      }
      onClick={() => {
        if (spellTargetAction) {
          onPlaySpellTarget?.(spellTargetAction)
          return
        }
        onAttack?.(group.startIndex, group.endIndex)
      }}
    >
      {spellTargetAction ? '対象' : `攻${group.attack} / 防${group.defense}`}
    </motion.button>
  )
}

const BoardView = ({
  board,
  cards,
  damageMarkers = [],
  destroyedCardIds = [],
  manaRefundCardIds = [],
  playerDamageMarker = null,
  players,
  playerBarriers,
  playerDeckColors,
  playerDeckIds,
  activePlayerId,
  groups,
  creatureStatModifiers,
  summonOptions = [],
  activatedAbilities = [],
  spellTargetActions = [],
  attackAnimation = null,
  canAttack = false,
  onInsertClick,
  onGroupAttack,
  onActivateAbility,
  onPlaySpellTarget,
}: BoardViewProps) => {
  const boardRef = useRef<HTMLElement>(null)
  const laneScrollRef = useRef<HTMLDivElement>(null)
  const laneGridRef = useRef<HTMLDivElement>(null)
  const previousBoardCardIdsRef = useRef(
    new Set(board.creatures.map(({ cardId }) => cardId)),
  )
  const scrollBoardRangeIntoView = useCallback((startIndex: number, endIndex: number) => {
    const grid = laneGridRef.current
    const laneScroll = laneScrollRef.current
    if (!grid || !laneScroll) {
      return
    }

    const startMarker = grid.querySelector<HTMLElement>(
      `[data-insert-index="${startIndex}"]`,
    )
    const endMarker = grid.querySelector<HTMLElement>(
      `[data-insert-index="${endIndex + 1}"]`,
    )
    if (!startMarker || !endMarker) {
      return
    }

    const scroller = [grid, laneScroll].find(
      (element) => element.scrollWidth > element.clientWidth + 1,
    )
    if (!scroller) {
      return
    }

    const scrollerRect = scroller.getBoundingClientRect()
    const startRect = startMarker.getBoundingClientRect()
    const endRect = endMarker.getBoundingClientRect()
    const targetLeft = startRect.right
    const targetRight = endRect.left
    const visibleLeft = scrollerRect.left + BOARD_SCROLL_PADDING
    const visibleRight = scrollerRect.right - BOARD_SCROLL_PADDING
    if (targetLeft >= visibleLeft && targetRight <= visibleRight) {
      return
    }

    const targetCenter = (targetLeft + targetRight) / 2
    const viewportCenter = (scrollerRect.left + scrollerRect.right) / 2
    scroller.scrollTo({
      left: scroller.scrollLeft + targetCenter - viewportCenter,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [])

  useEffect(() => {
    const currentCardIds = board.creatures.map(({ cardId }) => cardId)
    const previousCardIds = previousBoardCardIdsRef.current
    const summonedIndex = currentCardIds.findIndex((cardId) => !previousCardIds.has(cardId))
    previousBoardCardIdsRef.current = new Set(currentCardIds)

    if (summonedIndex < 0) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollBoardRangeIntoView(summonedIndex, summonedIndex)
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [board.creatures, scrollBoardRangeIntoView])

  useEffect(() => {
    if (attackAnimation === null) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollBoardRangeIntoView(attackAnimation.startIndex, attackAnimation.endIndex)
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [attackAnimation, scrollBoardRangeIntoView])

  const damageByCardId = new Map(
    damageMarkers.map(({ cardId, damage }) => [cardId, damage]),
  )
  const destroyedCardIdSet = new Set(destroyedCardIds)
  const summonOptionByIndex = new Map(
    summonOptions.map((option) => [option.insertIndex, option]),
  )
  const firstSummonOption = summonOptionByIndex.get(0)
  const lastSummonOption = summonOptionByIndex.get(board.creatures.length)
  const abilitiesByCardId = new Map<CardInstanceId, ActivatedAbilityOption[]>()
  activatedAbilities.forEach((ability) => {
    abilitiesByCardId.set(ability.sourceCardId, [
      ...(abilitiesByCardId.get(ability.sourceCardId) ?? []),
      ability,
    ])
  })
  const groupSpellTargetActions = new Map(
    spellTargetActions.flatMap((action) =>
      action.target?.kind === 'group'
        ? [[`${action.target.startIndex}-${action.target.endIndex}`, action] as const]
        : [],
    ),
  )
  const creatureSpellTargetActions = new Map(
    spellTargetActions.flatMap((action) =>
      action.target?.kind === 'creature'
        ? [[action.target.cardId, action] as const]
        : [],
    ),
  )
  const selectedSpellCard = spellTargetActions[0]
    ? cards[spellTargetActions[0].cardId].card
    : undefined
  const selectedSpellName = selectedSpellCard?.name
  const isBribery = selectedSpellCard?.kind === 'spell' && selectedSpellCard.effect.type === 'bribery'
  const boardCardWidth = 'var(--board-card-width, 140px)'
  const boardInsertSlotWidth = 'var(--board-insert-slot-width, 34px)'
  const gridTemplateColumns =
    board.creatures.length === 0
      ? `minmax(${boardCardWidth}, 1fr)`
      : `${boardInsertSlotWidth} ${board.creatures
          .map(() => `${boardCardWidth} ${boardInsertSlotWidth}`)
          .join(' ')}`

  return (
    <section ref={boardRef} className="board-panel" aria-label="battlefield">
      <ManaRefundEffects
        boardRef={boardRef}
        cardIds={manaRefundCardIds}
        cards={cards}
      />
      <BoardPlayer
        player={players.playerA}
        cards={cards}
        barrier={playerBarriers.playerA}
        deckColors={playerDeckColors.playerA}
        imageUrl={PLAYER_ICON_URL}
        damage={playerDamageMarker?.playerId === 'playerA' ? playerDamageMarker.damage : null}
      />
      <span
        className={`board-lane-flow board-lane-flow-${activePlayerId}`}
        aria-hidden="true"
      />
      <motion.div ref={laneScrollRef} className="board-lane-scroll" layoutScroll>
        {board.creatures.length === 0 ? (
          <div
            ref={laneGridRef}
            className="board-lane-grid"
            style={{ gridTemplateColumns }}
          >
            <button
              className={getSummonSlotClassName(firstSummonOption, true)}
              data-insert-index={0}
              data-summon-state={getSummonSlotState(firstSummonOption) ?? undefined}
              type="button"
              disabled={!firstSummonOption?.canSummon}
              title={getSummonSlotTitle(firstSummonOption)}
              onClick={() => onInsertClick?.(0)}
            >
              配置
            </button>
          </div>
        ) : (
          <div
            ref={laneGridRef}
            className="board-lane-grid"
            style={{ gridTemplateColumns }}
          >
            {board.creatures.map((creature, index) => {
              const summonOption = summonOptionByIndex.get(index)
              const ownerId = cards[creature.cardId].ownerId
              const cardGridRow = getBoardCardGridRow(ownerId)
              const isInsideGroup = index > 0 &&
                cards[board.creatures[index - 1].cardId].ownerId === ownerId
              return (
                <Fragment key={creature.cardId}>
                <button
                  key={`insert-${index}`}
                  className={getSummonSlotClassName(summonOption)}
                  data-insert-index={index}
                  data-summon-state={getSummonSlotState(summonOption) ?? undefined}
                  style={{
                    gridColumn: index * 2 + 1,
                    gridRow: index === 0 || isInsideGroup ? cardGridRow : undefined,
                  }}
                  type="button"
                  disabled={!summonOption?.canSummon}
                  title={getSummonSlotTitle(summonOption)}
                  onClick={() => onInsertClick?.(index)}
                >
                  +
                </button>
                <motion.div
                  layout
                  layoutId={`card-${creature.cardId}`}
                  data-card-id={creature.cardId}
                  className="board-slot"
                  style={{
                    gridColumn: index * 2 + 2,
                    gridRow: cardGridRow,
                  }}
                >
                  <SummonImpact enabled={cards[creature.cardId].card.cost >= 4}>
                    <motion.div
                      className="board-card-content"
                      initial={false}
                      animate={{ scale: destroyedCardIdSet.has(creature.cardId) ? 0 : 1 }}
                      transition={
                        destroyedCardIdSet.has(creature.cardId)
                          ? { delay: 0.12, duration: 0.3, ease: [0.4, 0, 0.6, 1] }
                          : { duration: 0.15 }
                      }
                    >
                      <CardView
                        artAttackAnimation={
                          attackAnimation !== null &&
                          index >= attackAnimation.startIndex &&
                          index <= attackAnimation.endIndex &&
                            cards[creature.cardId].ownerId === attackAnimation.ownerId
                            ? {
                                id: attackAnimation.id,
                                direction:
                                  attackAnimation.ownerId === 'playerA' ? 'right' : 'left',
                                tiltDegrees: getAttackTiltDegrees(
                                  creature.cardId,
                                  index,
                                  attackAnimation.id,
                                  attackAnimation.ownerId,
                                ),
                              }
                            : undefined
                        }
                        card={cards[creature.cardId].card}
                        compact
                        jitterArt
                        flashFoilOnMount
                        statModifier={creatureStatModifiers[creature.cardId]}
                      />
                    </motion.div>
                  </SummonImpact>
                  {(
                    (abilitiesByCardId.get(creature.cardId) ?? []).length > 0 ||
                    creatureSpellTargetActions.has(creature.cardId)
                  ) && (
                    <div className="board-ability-actions">
                      {(abilitiesByCardId.get(creature.cardId) ?? []).map((ability) => (
                        <button
                          key={ability.abilityType}
                          type="button"
                          disabled={!ability.enabled}
                          title={ability.reason}
                          onClick={() => onActivateAbility?.(ability)}
                        >
                          {ability.label}
                        </button>
                      ))}
                      {creatureSpellTargetActions.has(creature.cardId) && (
                        <button
                          className="board-spell-target-button"
                          type="button"
                          aria-label={`${selectedSpellName ?? '魔法'}の対象に${cards[creature.cardId].card.name}を選ぶ`}
                          onClick={() => {
                            const action = creatureSpellTargetActions.get(creature.cardId)
                            if (action) {
                              onPlaySpellTarget?.(action)
                            }
                          }}
                        >
                          {isBribery
                            ? `買収（${cards[creature.cardId].card.cost + 1}マナ）`
                            : selectedSpellName ?? '対象'}
                        </button>
                      )}
                    </div>
                  )}
                  {damageByCardId.has(creature.cardId) && (
                    <span
                      className="damage-marker card-damage-marker"
                      role="status"
                      aria-label={`${damageByCardId.get(creature.cardId)}ダメージ`}
                      style={DAMAGE_MARKER_STYLE}
                    >
                      {damageByCardId.get(creature.cardId)}
                    </span>
                  )}
                </motion.div>
                </Fragment>
              )
            })}
            <button
              className={getSummonSlotClassName(lastSummonOption)}
              data-insert-index={board.creatures.length}
              data-summon-state={getSummonSlotState(lastSummonOption) ?? undefined}
              style={{
                gridColumn: board.creatures.length * 2 + 1,
                gridRow: getBoardCardGridRow(
                  cards[board.creatures[board.creatures.length - 1].cardId].ownerId,
                ),
              }}
              type="button"
              disabled={!lastSummonOption?.canSummon}
              title={getSummonSlotTitle(lastSummonOption)}
              onClick={() => onInsertClick?.(board.creatures.length)}
            >
              +
            </button>
            {groups.map((group) => (
              <BoardGroupButton
                key={`group-${group.startIndex}-${group.endIndex}`}
                group={group}
                activePlayerId={activePlayerId}
                animationId={
                  attackAnimation?.ownerId === group.ownerId &&
                  attackAnimation.startIndex === group.startIndex &&
                  attackAnimation.endIndex === group.endIndex
                    ? attackAnimation.id
                    : null
                }
                canAttack={canAttack}
                spellTargetAction={groupSpellTargetActions.get(
                  `${group.startIndex}-${group.endIndex}`,
                )}
                spellName={selectedSpellName}
                onAttack={onGroupAttack}
                onPlaySpellTarget={onPlaySpellTarget}
              />
            ))}
          </div>
        )}
      </motion.div>
      <BoardPlayer
        player={players.playerB}
        cards={cards}
        barrier={playerBarriers.playerB}
        deckColors={playerDeckColors.playerB}
        imageUrl={PLAYER_IMAGE_BY_DECK_ID[playerDeckIds.playerB]}
        damage={playerDamageMarker?.playerId === 'playerB' ? playerDamageMarker.damage : null}
      />
    </section>
  )
}

export default BoardView
