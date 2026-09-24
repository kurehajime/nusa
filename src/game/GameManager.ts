import { createDeck, STANDARD_DECK_LIST } from './decks'
import { CreatureRules } from './CreatureRules'
import {
  collectBoardGroups,
  getCreatureOwnerAt,
  getOpponentId,
  isWholeGroup,
} from './boardQueries'
import { PLAYER_IDS } from './types'
import type {
  ActivatedAbilityOption,
  ActivatedAbilityType,
  CardColor,
  CardInstance,
  CardInstanceId,
  CombatPreview,
  CreatureCard,
  CreatureInstance,
  CreatureStatModifier,
  EffectiveBoardGroup,
  EffectiveCreatureStats,
  GameAction,
  GameDeckLists,
  GameState,
  Phase,
  PlaySpellAction,
  PlayerId,
  PlayerState,
  SpellCard,
  SpellDuration,
  SpellTarget,
  SummonOption,
} from './types'

const PHASE_ORDER = ['main', 'battle', 'cleanup'] satisfies Phase[]

const PLAYER_BARRIER = 2
const MAX_HAND_SIZE = 5
const SECOND_PLAYER_STARTING_MANA = 1
const DEFAULT_DECK_LISTS: GameDeckLists = {
  playerA: STANDARD_DECK_LIST,
  playerB: STANDARD_DECK_LIST,
}

const getWinnerFromState = (state: GameState): PlayerId | null => {
  if (state.players.playerA.hp <= 0) {
    return 'playerB'
  }
  if (state.players.playerB.hp <= 0) {
    return 'playerA'
  }
  return null
}

const assertGameInProgress = (state: GameState): void => {
  if (getWinnerFromState(state) !== null) {
    throw new Error('The game is already over.')
  }
}

const shuffleCardIds = (
  cardIds: CardInstanceId[],
  random: () => number,
): CardInstanceId[] => {
  const shuffled = [...cardIds]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }

  return shuffled
}

const createPlayer = (
  id: PlayerId,
  name: string,
  deck: CardInstanceId[],
  startingMana = 0,
): PlayerState => ({
  id,
  name,
  hp: 20,
  mana: startingMana,
  deck,
  hand: [],
  discard: [],
  exile: [],
  placedSpell: null,
})

const clonePlayer = (player: PlayerState): PlayerState => ({
  ...player,
  deck: [...player.deck],
  hand: [...player.hand],
  discard: [...player.discard],
  exile: [...player.exile],
  placedSpell: player.placedSpell ? { ...player.placedSpell } : null,
})

// null marks a frozen registry whose IDs have not been validated yet.
const immutableCardRegistries = new WeakMap<GameState['cards'], number | null>()

const getImmutableCardRegistry = (
  cards: GameState['cards'],
): GameState['cards'] => {
  if (immutableCardRegistries.has(cards)) {
    return cards
  }

  const clonedCards = Object.fromEntries(
    Object.entries(cards).map(([id, instance]) => [
      id,
      Object.freeze({ ...instance }),
    ]),
  ) as GameState['cards']
  Object.freeze(clonedCards)
  immutableCardRegistries.set(clonedCards, null)
  return clonedCards
}

const cloneGameState = (state: GameState): GameState => ({
  ...state,
  cards: getImmutableCardRegistry(state.cards),
  players: {
    playerA: clonePlayer(state.players.playerA),
    playerB: clonePlayer(state.players.playerB),
  },
  board: {
    creatures: state.board.creatures.map((creature) => ({ ...creature })),
  },
  pendingCombat: state.pendingCombat
    ? {
        ...state.pendingCombat,
        damageMarkers: state.pendingCombat.damageMarkers.map((marker) => ({ ...marker })),
        destroyedCardIds: [...state.pendingCombat.destroyedCardIds],
        ...(state.pendingCombat.destructionManaRefunds
          ? {
              destructionManaRefunds: {
                ...state.pendingCombat.destructionManaRefunds,
              },
            }
          : {}),
      }
    : null,
})

const createInitialState = (
  random: () => number,
  deckLists: GameDeckLists,
  shuffle = true,
): GameState => {
  const playerACards = createDeck(deckLists.playerA, 'playerA', 1)
  const playerBCards = createDeck(
    deckLists.playerB,
    'playerB',
    playerACards.length + 1,
  )
  const cardInstances = [...playerACards, ...playerBCards]
  const cards = Object.fromEntries(cardInstances.map((instance) => [instance.id, instance]))
  const orderedA = playerACards.map(({ id }) => id)
  const orderedB = playerBCards.map(({ id }) => id)
  const playerADeck = shuffle ? shuffleCardIds(orderedA, random) : orderedA
  const playerBDeck = shuffle ? shuffleCardIds(orderedB, random) : orderedB

  return {
    turn: 1,
    activePlayerId: 'playerA',
    phase: 'keepUp',
    hasAttackedThisTurn: false,
    hasDiscardedThisTurn: false,
    pendingCombat: null,
    cards,
    players: {
      playerA: createPlayer(
        'playerA',
        'あなた',
        playerADeck,
      ),
      playerB: createPlayer(
        'playerB',
        'COM',
        playerBDeck,
        SECOND_PLAYER_STARTING_MANA,
      ),
    },
    board: {
      creatures: [],
    },
  }
}

const replacePlayer = (state: GameState, player: PlayerState): GameState => ({
  ...state,
  players: {
    ...state.players,
    [player.id]: player,
  },
})

const getCardInstance = (state: GameState, cardId: CardInstanceId): CardInstance => {
  const instance = state.cards[cardId]
  if (!instance) {
    throw new Error(`Unknown card instance: ${cardId}`)
  }
  return instance
}

const getCreatureOwner = (state: GameState, creature: CreatureInstance): PlayerId =>
  getCardInstance(state, creature.cardId).ownerId

const removeHandCard = (player: PlayerState, cardId: CardInstanceId): PlayerState => {
  if (!player.hand.includes(cardId)) {
    throw new Error(`Card instance ${cardId} is not in ${player.name}'s hand.`)
  }

  return {
    ...player,
    hand: player.hand.filter((id) => id !== cardId),
  }
}

const drawUpTo = (player: PlayerState, handSize: number): PlayerState => {
  const drawCount = Math.max(0, Math.min(handSize - player.hand.length, player.deck.length))

  return {
    ...player,
    hand: [...player.hand, ...player.deck.slice(0, drawCount)],
    deck: player.deck.slice(drawCount),
  }
}

const discardCard = (player: PlayerState, cardId: CardInstanceId): PlayerState => {
  const playerWithoutCard = removeHandCard(player, cardId)

  return {
    ...playerWithoutCard,
    discard: [...playerWithoutCard.discard, cardId],
  }
}

const getRequiredMarchForInsert = (
  state: GameState,
  ownerId: PlayerId,
  insertIndex: number,
  ignoreCapture: boolean,
): number => {
  const board = state.board.creatures
  let crossedStart = ownerId === 'playerA' ? 0 : insertIndex
  let crossedEnd = ownerId === 'playerA' ? insertIndex : board.length

  // Every crossed position has non-negative cost, so the nearest rear anchor is optimal.
  if (ownerId === 'playerA') {
    for (
      let anchorIndex = Math.min(insertIndex, board.length - 1);
      anchorIndex >= 0;
      anchorIndex -= 1
    ) {
      if (getCreatureOwnerAt(state, anchorIndex) === ownerId) {
        crossedStart = Math.min(anchorIndex + 1, insertIndex)
        break
      }
    }
  } else {
    for (
      let anchorIndex = Math.max(0, insertIndex - 1);
      anchorIndex < board.length;
      anchorIndex += 1
    ) {
      if (getCreatureOwnerAt(state, anchorIndex) === ownerId) {
        crossedEnd = Math.max(anchorIndex, insertIndex)
        break
      }
    }
  }

  let distance = 0
  for (
    let crossedIndex = crossedStart;
    crossedIndex < crossedEnd;
    crossedIndex += 1
  ) {
    distance +=
      1 +
      (ignoreCapture
        ? 0
        : new CreatureRules(state, crossedIndex).getOpponentMarchCost(ownerId))
  }
  return distance
}

const getRequiredMarchByInsert = (
  state: GameState,
  ownerId: PlayerId,
  ignoreCapture: boolean,
): number[] => {
  const boardLength = state.board.creatures.length
  const requiredMarch = Array<number>(boardLength + 1)
  let distance = 0

  // Sweep from our player; either side of an allied creature is a new anchor.
  for (let offset = 0; offset <= boardLength; offset += 1) {
    const insertIndex = ownerId === 'playerA' ? offset : boardLength - offset
    const nextIndex = ownerId === 'playerA' ? insertIndex : insertIndex - 1
    const hasNext = nextIndex >= 0 && nextIndex < boardLength
    const nextIsAlly = hasNext && getCreatureOwnerAt(state, nextIndex) === ownerId
    if (nextIsAlly) distance = 0
    requiredMarch[insertIndex] = distance
    if (hasNext && !nextIsAlly) {
      distance += 1 + (ignoreCapture
        ? 0
        : new CreatureRules(state, nextIndex).getOpponentMarchCost(ownerId))
    }
  }
  return requiredMarch
}

const getEffectiveSummonCost = (
  card: CreatureCard,
  ownerId: PlayerId,
  insertIndex: number,
  boardRules: readonly CreatureRules[],
): number => Math.max(0, card.cost + boardRules.reduce(
  (total, rules) => total + rules.getSummonCostModifier(ownerId, insertIndex),
  0,
))

const getSummonOptionsForState = (
  state: GameState,
  ownerId: PlayerId,
  card: CreatureCard,
  availableMana: number,
): SummonOption[] => {
  const board = state.board.creatures
  const requiredMarchByInsert = getRequiredMarchByInsert(state, ownerId, false)
  const boardRules = board.map((_, boardIndex) => new CreatureRules(state, boardIndex))

  return Array.from({ length: board.length + 1 }, (_, insertIndex) => {
    const requiredMarch = requiredMarchByInsert[insertIndex]
    const effectiveCost = getEffectiveSummonCost(card, ownerId, insertIndex, boardRules)
    const canReach = requiredMarch <= card.march
    const affordable = effectiveCost <= availableMana

    return {
      insertIndex,
      requiredMarch,
      effectiveCost,
      canReach,
      affordable,
      canSummon: canReach && affordable,
    }
  })
}

const collectDefendingGroup = (
  state: GameState,
  defenderId: PlayerId,
  targetIndex: number,
  direction: 1 | -1,
): number[] => {
  const board = state.board.creatures
  const indexes: number[] = []
  for (
    let index = targetIndex;
    index >= 0 &&
    index < board.length &&
    getCreatureOwner(state, board[index]) === defenderId;
    index += direction
  ) {
    indexes.push(index)
  }
  return indexes
}

const getDestructionManaRefundForState = (
  state: GameState,
  cardId: CardInstanceId,
): number => {
  const spellRefund = state.pendingCombat?.destructionManaRefunds?.[cardId]
  if (spellRefund !== undefined) {
    return spellRefund
  }
  const instance = getCardInstance(state, cardId)
  return CreatureRules.fromCardId(state, cardId).preventsDestructionRefund()
    ? 0
    : Math.floor(instance.card.cost / 2)
}

const refundDestroyedCreatures = (
  state: GameState,
  destroyedCreatures: CreatureInstance[],
): GameState['players'] => {
  const nextPlayers = {
    playerA: { ...state.players.playerA, discard: [...state.players.playerA.discard] },
    playerB: { ...state.players.playerB, discard: [...state.players.playerB.discard] },
  }

  destroyedCreatures.forEach((creature) => {
    const instance = getCardInstance(state, creature.cardId)
    const owner = nextPlayers[instance.ownerId]
    const refund = getDestructionManaRefundForState(state, creature.cardId)
    nextPlayers[instance.ownerId] = {
      ...owner,
      mana: owner.mana + refund,
      discard: [...owner.discard, instance.id],
    }
  })

  return nextPlayers
}

const getPlayerBarrierForState = (state: GameState, playerId: PlayerId): number => {
  const player = state.players[playerId]
  const spell = getPlacedSpellCard(state, playerId)
  return PLAYER_BARRIER +
    (spell?.effect.type === 'lifeDroplet'
      ? player.placedSpell?.effectAmount ?? 0
      : 0)
}

const getEndTurnInstallmentResolution = (
  state: GameState,
  playerId: PlayerId,
): { mana: number; destroyedCardIds: CardInstanceId[] } => {
  let mana = state.players[playerId].mana
  const destroyedCardIds: CardInstanceId[] = []

  state.board.creatures.forEach((creature, boardIndex) => {
    const instance = getCardInstance(state, creature.cardId)
    if (instance.ownerId !== playerId) {
      return
    }
    const cost = new CreatureRules(state, boardIndex).getEndTurnManaCost()
    if (cost <= mana) {
      mana -= cost
    } else if (cost > 0) {
      destroyedCardIds.push(creature.cardId)
    }
  })

  return { mana, destroyedCardIds }
}

const resolveEndTurnInstallments = (
  state: GameState,
  playerId: PlayerId,
): GameState => {
  const { mana, destroyedCardIds } = getEndTurnInstallmentResolution(
    state,
    playerId,
  )
  const destroyedSet = new Set(destroyedCardIds)
  const player = state.players[playerId]

  return {
    ...replacePlayer(state, {
      ...player,
      mana,
      discard: [...player.discard, ...destroyedCardIds],
    }),
    board: {
      creatures: state.board.creatures.filter(
        ({ cardId }) => !destroyedSet.has(cardId),
      ),
    },
  }
}

const getManaRetainedAfterTurnEndForState = (
  state: GameState,
  playerId: PlayerId,
): number =>
  getPlacedSpellCard(state, playerId)?.effect.type === 'abundance'
    ? 0
    : getEndTurnInstallmentResolution(state, playerId).mana

const exileDiscardedCreatures = (
  state: GameState,
  player: PlayerState,
  color: CardColor,
): { player: PlayerState; count: number } => {
  const exiledCardIds = player.discard.filter((cardId) => {
    const card = getCardInstance(state, cardId).card
    return card.kind === 'creature' && card.color === color
  })
  const exiledSet = new Set(exiledCardIds)
  return {
    player: {
      ...player,
      discard: player.discard.filter((cardId) => !exiledSet.has(cardId)),
      exile: [...player.exile, ...exiledCardIds],
    },
    count: exiledCardIds.length,
  }
}

const applyReturnFire = (
  state: GameState,
  casterId: PlayerId,
  damage: number,
): GameState => {
  const board = state.board.creatures
  if (damage <= 0 || board.length === 0) {
    return state
  }

  const targetIndex = casterId === 'playerA' ? 0 : board.length - 1
  const targetGroup = collectBoardGroups(state).find(
    ({ startIndex, endIndex }) =>
      startIndex <= targetIndex && targetIndex <= endIndex,
  )
  if (!targetGroup) {
    return state
  }
  const targetIndexes = Array.from(
    { length: targetGroup.endIndex - targetGroup.startIndex + 1 },
    (_, offset) =>
      casterId === 'playerA'
        ? targetGroup.startIndex + offset
        : targetGroup.endIndex - offset,
  )
  let remainingDamage = damage
  const damageMarkers: NonNullable<GameState['pendingCombat']>['damageMarkers'] = []
  const destroyedCardIds: CardInstanceId[] = []

  for (const index of targetIndexes) {
    if (remainingDamage <= 0) {
      break
    }
    const creature = board[index]
    damageMarkers.push({ cardId: creature.cardId, damage: remainingDamage })
    const defense = CreatureRules.fromCardId(
      state,
      creature.cardId,
    ).getEffectiveStats().defense
    if (remainingDamage < defense) {
      break
    }
    remainingDamage -= defense
    destroyedCardIds.push(creature.cardId)
  }

  return {
    ...state,
    pendingCombat: {
      damageMarkers,
      destroyedCardIds,
      defendingPlayerId: targetGroup.ownerId,
      playerWasHit: false,
      playerDamage: 0,
      endsTurnAfterResolution: false,
    },
  }
}

const applyFireballAssault = (
  state: GameState,
  casterId: PlayerId,
  target: Extract<SpellTarget, { kind: 'group' }>,
): GameState => {
  const targetCreatures = state.board.creatures.slice(
    target.startIndex,
    target.endIndex + 1,
  )
  const destroyedCardIds = targetCreatures
    .filter(({ cardId }) => {
      const instance = getCardInstance(state, cardId)
      return instance.ownerId === casterId &&
        instance.card.kind === 'creature' &&
        instance.card.color === 'red'
    })
    .map(({ cardId }) => cardId)
  const playerDamage = destroyedCardIds.reduce(
    (total, cardId) => total + getCardInstance(state, cardId).card.cost,
    0,
  )

  if (destroyedCardIds.length === 0) {
    return state
  }

  return {
    ...state,
    pendingCombat: {
      damageMarkers: [],
      destroyedCardIds,
      defendingPlayerId: getOpponentId(casterId),
      playerWasHit: playerDamage > 0,
      playerDamage,
      endsTurnAfterResolution: false,
    },
  }
}

const applyTransfer = (
  state: GameState,
  target: Extract<SpellTarget, { kind: 'creature' }>,
): GameState => {
  const { playerA, playerB } = state.players
  if (playerA.hp === playerB.hp) {
    return state
  }

  const targetIndex = state.board.creatures.findIndex(
    ({ cardId }) => cardId === target.cardId,
  )
  if (targetIndex < 0) {
    throw new Error('The transfer target is not on the board.')
  }
  const targetCreature = state.board.creatures[targetIndex]
  const remainingCreatures = state.board.creatures.filter(
    ({ cardId }) => cardId !== target.cardId,
  )
  const creatures = playerA.hp < playerB.hp
    ? [targetCreature, ...remainingCreatures]
    : [...remainingCreatures, targetCreature]

  return {
    ...state,
    board: { creatures },
  }
}

const applySelfDestructOrder = (
  state: GameState,
  casterId: PlayerId,
  target: Extract<SpellTarget, { kind: 'creature' }>,
): GameState => {
  const targetIndex = state.board.creatures.findIndex(
    ({ cardId }) => cardId === target.cardId,
  )
  if (targetIndex < 0) {
    throw new Error('The self-destruct target is not on the board.')
  }

  const targetInstance = getCardInstance(state, target.cardId)
  if (targetInstance.ownerId !== casterId || targetInstance.card.kind !== 'creature') {
    throw new Error('Self-destruct requires one of the caster\'s creatures.')
  }

  const groups = collectBoardGroups(state)
  const targetGroupIndex = groups.findIndex(
    ({ startIndex, endIndex }) =>
      startIndex <= targetIndex && targetIndex <= endIndex,
  )
  if (targetGroupIndex < 0) {
    throw new Error('The self-destruct target does not belong to a group.')
  }

  const firstGroupIndex = Math.max(0, targetGroupIndex - 1)
  const lastGroupIndex = Math.min(groups.length - 1, targetGroupIndex + 1)
  const firstBoardIndex = groups[firstGroupIndex].startIndex
  const lastBoardIndex = groups[lastGroupIndex].endIndex
  const damage = targetInstance.card.cost
  const affectedCreatures = state.board.creatures.slice(
    firstBoardIndex,
    lastBoardIndex + 1,
  )
  const damageMarkers = affectedCreatures.map(({ cardId }) => ({ cardId, damage }))
  const destroyedCardIds = affectedCreatures.flatMap(({ cardId }) =>
    damage >= CreatureRules.fromCardId(state, cardId).getEffectiveStats().defense
      ? [cardId]
      : [],
  )

  return {
    ...state,
    pendingCombat: {
      damageMarkers,
      destroyedCardIds,
      defendingPlayerId: casterId,
      playerWasHit: false,
      playerDamage: 0,
      endsTurnAfterResolution: false,
    },
  }
}

const applyBribery = (
  state: GameState,
  casterId: PlayerId,
  target: Extract<SpellTarget, { kind: 'creature' }>,
): GameState => {
  const instance = getCardInstance(state, target.cardId)
  const player = state.players[casterId]
  const payment = instance.card.cost + 1
  if (player.mana < payment) {
    throw new Error('Not enough mana to bribe this creature.')
  }
  return {
    ...replacePlayer(state, { ...player, mana: player.mana - payment }),
    cards: {
      ...state.cards,
      [target.cardId]: { ...instance, ownerId: casterId },
    },
  }
}

const applyLifeCycle = (state: GameState, casterId: PlayerId): GameState => {
  const destroyedCardIds = state.board.creatures.flatMap(({ cardId }) => {
    const instance = getCardInstance(state, cardId)
    return instance.ownerId === casterId &&
      instance.card.kind === 'creature' &&
      instance.card.color === 'green'
      ? [cardId]
      : []
  })
  if (destroyedCardIds.length === 0) {
    return state
  }

  const destructionManaRefunds = Object.fromEntries(
    destroyedCardIds.map((cardId) => [
      cardId,
      getCardInstance(state, cardId).card.cost,
    ]),
  )

  return {
    ...state,
    pendingCombat: {
      damageMarkers: [],
      destroyedCardIds,
      destructionManaRefunds,
      defendingPlayerId: casterId,
      playerWasHit: false,
      playerDamage: 0,
      endsTurnAfterResolution: false,
    },
  }
}

const areSpellTargetsEqual = (
  left: SpellTarget | undefined,
  right: SpellTarget | undefined,
): boolean => {
  if (left === undefined || right === undefined) {
    return left === right
  }
  if (left.kind !== right.kind) {
    return false
  }
  return left.kind === 'group' && right.kind === 'group'
    ? left.startIndex === right.startIndex && left.endIndex === right.endIndex
    : left.kind === 'creature' && right.kind === 'creature' && left.cardId === right.cardId
}

const getKeepUpManaBonusForState = (
  state: GameState,
  playerId: PlayerId,
): number => {
  const manaByStackKey = new Map<string, number>()
  state.board.creatures.forEach((_, boardIndex) => {
    const rules = new CreatureRules(state, boardIndex)
    if (rules.ownerId !== playerId) {
      return
    }
    rules.getKeepUpManaModifier().forEach(({ amount, stackKey }) => {
      manaByStackKey.set(stackKey, Math.max(manaByStackKey.get(stackKey) ?? 0, amount))
    })
  })
  const abilityMana = [...manaByStackKey.values()].reduce(
    (total, amount) => total + amount,
    0,
  )
  return abilityMana
}

const getKeepUpPlayerDamageForState = (state: GameState, playerId: PlayerId): number =>
  state.board.creatures.reduce((total, _, boardIndex) => {
    const rules = new CreatureRules(state, boardIndex)
    return total + (rules.ownerId === playerId ? rules.getKeepUpPlayerDamage() : 0)
  }, 0)

const getPlacedSpellCard = (
  state: GameState,
  playerId: PlayerId,
): SpellCard | null => {
  const placedSpell = state.players[playerId].placedSpell
  if (placedSpell === null) {
    return null
  }
  const card = getCardInstance(state, placedSpell.cardId).card
  if (card.kind !== 'spell') {
    throw new Error(`Placed card ${placedSpell.cardId} is not a spell.`)
  }
  return card
}

const expirePlacedSpell = (
  state: GameState,
  playerId: PlayerId,
  duration: SpellDuration,
): GameState => {
  const player = state.players[playerId]
  if (
    player.placedSpell === null ||
    getPlacedSpellCard(state, playerId)?.duration !== duration
  ) {
    return state
  }

  return replacePlayer(state, {
    ...player,
    discard: [...player.discard, player.placedSpell.cardId],
    placedSpell: null,
  })
}

const resolveKeepUpState = (state: GameState): GameState => {
  if (state.phase !== 'keepUp') {
    throw new Error('Keep up can only be resolved during the keep up phase.')
  }

  const activePlayer = state.players[state.activePlayerId]
  const bonusMana = getKeepUpManaBonusForState(state, activePlayer.id)
  const playerDamage = getKeepUpPlayerDamageForState(state, activePlayer.id)
  const nextPlayer = {
    ...drawUpTo(activePlayer, MAX_HAND_SIZE),
    mana: activePlayer.mana + 2 + bonusMana,
  }

  return {
    ...replacePlayer(state, nextPlayer),
    phase: 'main',
    pendingCombat: playerDamage > 0
      ? {
          damageMarkers: [],
          destroyedCardIds: [],
          defendingPlayerId: getOpponentId(activePlayer.id),
          playerWasHit: true,
          playerDamage,
          endsTurnAfterResolution: false,
        }
      : null,
  }
}

const resolvePendingCombatState = (state: GameState): GameState => {
  const { pendingCombat } = state
  if (!pendingCombat) {
    throw new Error('There are no combat results to finish resolving.')
  }

  const destroyedCardIds = new Set(pendingCombat.destroyedCardIds)
  const destroyedCreatures = state.board.creatures.filter(({ cardId }) =>
    destroyedCardIds.has(cardId),
  )
  const nextPlayers = refundDestroyedCreatures(state, destroyedCreatures)
  if ((pendingCombat.attackerManaGain ?? 0) > 0) {
    const attackingPlayer = nextPlayers[state.activePlayerId]
    nextPlayers[state.activePlayerId] = {
      ...attackingPlayer,
      mana: attackingPlayer.mana + (pendingCombat.attackerManaGain ?? 0),
    }
  }
  const defendingPlayer = nextPlayers[pendingCombat.defendingPlayerId]
  nextPlayers[pendingCombat.defendingPlayerId] = {
    ...defendingPlayer,
    hp: defendingPlayer.hp - pendingCombat.playerDamage,
  }

  return {
    ...state,
    players: nextPlayers,
    board: {
      creatures: state.board.creatures.filter(
        ({ cardId }) => !destroyedCardIds.has(cardId),
      ),
    },
    pendingCombat: null,
  }
}

const endTurnState = (state: GameState): GameState => {
  const afterInstallments = resolveEndTurnInstallments(
    state,
    state.activePlayerId,
  )
  const endingPlayer = afterInstallments.players[state.activePlayerId]
  const afterEndTurnManaEffect = replacePlayer(afterInstallments, {
    ...endingPlayer,
    mana:
      getPlacedSpellCard(afterInstallments, state.activePlayerId)?.effect.type ===
      'abundance'
        ? 0
        : endingPlayer.mana,
  })
  const afterImmediateExpiration = expirePlacedSpell(
    afterEndTurnManaEffect,
    state.activePlayerId,
    'immediate',
  )
  const afterTurnEndExpiration = expirePlacedSpell(
    afterImmediateExpiration,
    state.activePlayerId,
    'untilTurnEnd',
  )
  const nextPlayerId = getOpponentId(state.activePlayerId)
  const nextTurnState: GameState = {
    ...afterTurnEndExpiration,
    turn: afterTurnEndExpiration.turn + 1,
    activePlayerId: nextPlayerId,
    phase: 'keepUp',
    hasAttackedThisTurn: false,
    hasDiscardedThisTurn: false,
    pendingCombat: null,
  }

  return resolveKeepUpState(
    expirePlacedSpell(nextTurnState, nextPlayerId, 'untilNextTurnStart'),
  )
}

const CARD_LOCATION_NONE = 0
const CARD_LOCATION_DECK = 1
const CARD_LOCATION_HAND = 2
const CARD_LOCATION_DISCARD = 3
const CARD_LOCATION_EXILE = 4
const CARD_LOCATION_PLACED_SPELL = 5
const CARD_LOCATION_BOARD = 6
const COMBAT_FLAG_DAMAGE_MARKED = 1
const COMBAT_FLAG_DESTROYED = 2
const CARD_LOCATION_LABELS = [
  'unknown',
  'deck',
  'hand',
  'discard',
  'exile',
  'placed spell',
  'board',
] as const

type CardLocation =
  | typeof CARD_LOCATION_DECK
  | typeof CARD_LOCATION_HAND
  | typeof CARD_LOCATION_DISCARD
  | typeof CARD_LOCATION_EXILE
  | typeof CARD_LOCATION_PLACED_SPELL
  | typeof CARD_LOCATION_BOARD

const getValidatedCardCount = (cards: GameState['cards']): number => {
  const validatedCount = immutableCardRegistries.get(cards)
  if (validatedCount !== undefined && validatedCount !== null) {
    return validatedCount
  }

  const registeredCardCount = Object.keys(cards).length

  for (let cardId = 1; cardId <= registeredCardCount; cardId += 1) {
    const instance = cards[cardId]
    if (!instance) {
      throw new Error(`Card registry must use consecutive ids starting at 1. Missing ${cardId}.`)
    }
    if (instance.id !== cardId) {
      throw new Error(`Card registry key ${cardId} does not match instance id ${instance.id}.`)
    }
  }

  // Only internally frozen registries and instances can safely reuse validation.
  if (immutableCardRegistries.has(cards)) {
    immutableCardRegistries.set(cards, registeredCardCount)
  }
  return registeredCardCount
}

const locateCard = (
  cards: GameState['cards'],
  locations: Uint8Array,
  cardId: CardInstanceId,
  ownerId: PlayerId,
  location: CardLocation,
  expectedKind?: CardInstance['card']['kind'],
): void => {
  if (!Number.isInteger(cardId) || cardId <= 0 || cardId >= locations.length) {
    throw new Error(`Game state references unknown card instance ${cardId}.`)
  }
  const instance = cards[cardId]
  if (!instance) {
    throw new Error(`Game state references unknown card instance ${cardId}.`)
  }
  if (instance.ownerId !== ownerId) {
    throw new Error(
      `Card instance ${cardId} is in ${ownerId}'s ${CARD_LOCATION_LABELS[location]} but belongs to ${instance.ownerId}.`,
    )
  }
  if (expectedKind && instance.card.kind !== expectedKind) {
    throw new Error(
      `Card instance ${cardId} at ${CARD_LOCATION_LABELS[location]} must be a ${expectedKind}.`,
    )
  }

  const previousLocation = locations[cardId]
  if (previousLocation !== CARD_LOCATION_NONE) {
    throw new Error(
      `Card instance ${cardId} exists in both ${CARD_LOCATION_LABELS[previousLocation]} and ${CARD_LOCATION_LABELS[location]}.`,
    )
  }
  locations[cardId] = location
}

export const assertValidGameState = (state: GameState): void => {
  const registeredCardCount = getValidatedCardCount(state.cards)
  const locations = new Uint8Array(registeredCardCount + 1)
  let locatedCardCount = 0

  for (const playerId of PLAYER_IDS) {
    const player = state.players[playerId]
    if (player.id !== playerId) {
      throw new Error(`Player registry key ${playerId} does not match player id ${player.id}.`)
    }
    if (player.hand.length > MAX_HAND_SIZE) {
      throw new Error(`${player.name}'s hand cannot contain more than ${MAX_HAND_SIZE} cards.`)
    }
    for (const cardId of player.deck) {
      locateCard(state.cards, locations, cardId, playerId, CARD_LOCATION_DECK)
      locatedCardCount += 1
    }
    for (const cardId of player.hand) {
      locateCard(state.cards, locations, cardId, playerId, CARD_LOCATION_HAND)
      locatedCardCount += 1
    }
    for (const cardId of player.discard) {
      locateCard(state.cards, locations, cardId, playerId, CARD_LOCATION_DISCARD)
      locatedCardCount += 1
    }
    for (const cardId of player.exile) {
      locateCard(state.cards, locations, cardId, playerId, CARD_LOCATION_EXILE)
      locatedCardCount += 1
    }
    if (player.placedSpell !== null) {
      locateCard(
        state.cards,
        locations,
        player.placedSpell.cardId,
        playerId,
        CARD_LOCATION_PLACED_SPELL,
        'spell',
      )
      locatedCardCount += 1
      if (
        !Number.isInteger(player.placedSpell.effectAmount) ||
        player.placedSpell.effectAmount < 0
      ) {
        throw new Error('Placed spell effect amount must be a non-negative integer.')
      }
      const spell = state.cards[player.placedSpell.cardId].card
      if (spell.kind !== 'spell') {
        throw new Error('Only spells can occupy the placed spell zone.')
      }
    }
  }

  for (const creature of state.board.creatures) {
    const instance = state.cards[creature.cardId]
    if (!instance) {
      throw new Error(`Board references unknown card instance ${creature.cardId}.`)
    }
    locateCard(state.cards, locations, creature.cardId, instance.ownerId, CARD_LOCATION_BOARD, 'creature')
    locatedCardCount += 1
  }

  if (state.pendingCombat) {
    const endsTurnAfterResolution = state.pendingCombat.endsTurnAfterResolution !== false
    if (endsTurnAfterResolution) {
      if (state.phase !== 'battle' || !state.hasAttackedThisTurn) {
        throw new Error('Pending combat requires the battle phase and a completed attack.')
      }
      if (state.pendingCombat.defendingPlayerId !== getOpponentId(state.activePlayerId)) {
        throw new Error('Pending combat has the wrong defending player.')
      }
    } else if (state.phase !== 'main' || state.hasAttackedThisTurn) {
      throw new Error('Pending effect damage requires an unattacked main phase.')
    }
    if (
      !Number.isInteger(state.pendingCombat.playerDamage) ||
      state.pendingCombat.playerDamage < 0
    ) {
      throw new Error('Pending combat player damage must be a non-negative integer.')
    }
    if (!state.pendingCombat.playerWasHit && state.pendingCombat.playerDamage !== 0) {
      throw new Error('Combat cannot damage a player it did not reach.')
    }
    if (
      state.pendingCombat.attackerManaGain !== undefined &&
      (!Number.isInteger(state.pendingCombat.attackerManaGain) ||
        state.pendingCombat.attackerManaGain < 0)
    ) {
      throw new Error('Combat attacker mana gain must be a non-negative integer.')
    }
    const combatFlags = new Uint8Array(registeredCardCount + 1)
    for (const { cardId, damage } of state.pendingCombat.damageMarkers) {
      if (locations[cardId] !== CARD_LOCATION_BOARD) {
        throw new Error(`Damage marker references card ${cardId} outside the board.`)
      }
      if (!Number.isInteger(damage) || damage <= 0) {
        throw new Error(`Damage marker for card ${cardId} must have positive integer damage.`)
      }
      if ((combatFlags[cardId] & COMBAT_FLAG_DAMAGE_MARKED) !== 0) {
        throw new Error(`Card ${cardId} has more than one damage marker.`)
      }
      combatFlags[cardId] |= COMBAT_FLAG_DAMAGE_MARKED
    }

    for (const cardId of state.pendingCombat.destroyedCardIds) {
      if (locations[cardId] !== CARD_LOCATION_BOARD) {
        throw new Error(`Destroyed card ${cardId} is outside the board.`)
      }
      if (
        endsTurnAfterResolution &&
        (combatFlags[cardId] & COMBAT_FLAG_DAMAGE_MARKED) === 0
      ) {
        throw new Error(`Destroyed card ${cardId} does not have a damage marker.`)
      }
      if ((combatFlags[cardId] & COMBAT_FLAG_DESTROYED) !== 0) {
        throw new Error(`Destroyed card ${cardId} is listed more than once.`)
      }
      combatFlags[cardId] |= COMBAT_FLAG_DESTROYED
    }
    for (const [cardIdText, refund] of Object.entries(
      state.pendingCombat.destructionManaRefunds ?? {},
    )) {
      const cardId = Number(cardIdText)
      if ((combatFlags[cardId] & COMBAT_FLAG_DESTROYED) === 0) {
        throw new Error(`Mana refund references card ${cardId} that is not destroyed.`)
      }
      if (refund === undefined || !Number.isInteger(refund) || refund < 0) {
        throw new Error(`Mana refund for card ${cardId} must be a non-negative integer.`)
      }
    }
  } else if (state.hasAttackedThisTurn && state.phase !== 'battle') {
    throw new Error('A resolved attack must remain in the battle phase.')
  }

  // Every located ID is unique and in range, so equal counts prove none are missing.
  if (locatedCardCount === registeredCardCount) return

  for (let cardId = 1; cardId <= registeredCardCount; cardId += 1) {
    if (locations[cardId] === CARD_LOCATION_NONE) {
      throw new Error(`Card instance ${cardId} is not in any game zone.`)
    }
  }
}

export class GameManager {
  public readonly state: GameState

  private constructor(state: GameState) {
    this.state = state
  }

  static create(
    random: () => number = Math.random,
    deckLists: GameDeckLists = DEFAULT_DECK_LISTS,
    options: { shuffle?: boolean } = {},
  ): GameManager {
    return GameManager.from(resolveKeepUpState(createInitialState(random, deckLists, options.shuffle)))
  }

  static from(state: GameState): GameManager {
    const clonedState = cloneGameState(state)
    assertValidGameState(clonedState)
    return new GameManager(clonedState)
  }

  static getWinner(manager: GameManager): PlayerId | null {
    return getWinnerFromState(manager.state)
  }

  static getKeepUpManaBonus(manager: GameManager, playerId: PlayerId): number {
    return getKeepUpManaBonusForState(manager.state, playerId)
  }

  static getKeepUpPlayerDamage(manager: GameManager, playerId: PlayerId): number {
    return getKeepUpPlayerDamageForState(manager.state, playerId)
  }

  static getPlayerBarrier(manager: GameManager, playerId: PlayerId): number {
    return getPlayerBarrierForState(manager.state, playerId)
  }

  static getManaRetainedAfterTurnEnd(
    manager: GameManager,
    playerId: PlayerId,
  ): number {
    return getManaRetainedAfterTurnEndForState(manager.state, playerId)
  }

  static getEndTurnInstallmentResolution(
    manager: GameManager,
    playerId: PlayerId,
  ): { mana: number; destroyedCardIds: CardInstanceId[] } {
    const resolution = getEndTurnInstallmentResolution(manager.state, playerId)
    return {
      mana: resolution.mana,
      destroyedCardIds: [...resolution.destroyedCardIds],
    }
  }

  static getDestructionManaRefund(
    manager: GameManager,
    cardId: CardInstanceId,
  ): number {
    return getDestructionManaRefundForState(manager.state, cardId)
  }

  static canCurrentPlayerAttack(_manager: GameManager): boolean {
    return true
  }

  static countReachableSummonPositions(
    manager: GameManager,
    playerId: PlayerId,
    march: number,
    ignoreCapture = false,
  ): number {
    return getRequiredMarchByInsert(manager.state, playerId, ignoreCapture)
      .reduce((total, requiredMarch) => total + Number(requiredMarch <= march), 0)
  }

  static getRequiredMarchForInsert(
    manager: GameManager,
    playerId: PlayerId,
    insertIndex: number,
  ): number {
    return getRequiredMarchForInsert(manager.state, playerId, insertIndex, false)
  }

  static setPhase(manager: GameManager, phase: Phase): GameManager {
    return GameManager.from({
      ...manager.state,
      phase,
    })
  }

  static getCurrentPlayer(manager: GameManager): PlayerState {
    return manager.state.players[manager.state.activePlayerId]
  }

  static addDebugMana(manager: GameManager, playerId: PlayerId): GameManager {
    const player = manager.state.players[playerId]
    return GameManager.from(
      replacePlayer(manager.state, {
        ...player,
        mana: player.mana + 1,
      }),
    )
  }

  static getOpponent(manager: GameManager): PlayerState {
    const opponentId = getOpponentId(manager.state.activePlayerId)
    return manager.state.players[opponentId]
  }

  static getCard(manager: GameManager, cardId: CardInstanceId): CardInstance {
    return getCardInstance(manager.state, cardId)
  }

  static getCreatureStats(
    manager: GameManager,
    cardId: CardInstanceId,
  ): EffectiveCreatureStats {
    return CreatureRules.fromCardId(manager.state, cardId).getEffectiveStats()
  }

  static getCreatureStatModifier(
    manager: GameManager,
    cardId: CardInstanceId,
  ): CreatureStatModifier {
    return CreatureRules.fromCardId(manager.state, cardId).getPositionStatModifier()
  }

  static getBoardGroups(manager: GameManager): EffectiveBoardGroup[] {
    return collectBoardGroups(manager.state).map((group) => {
      const stats = manager.state.board.creatures
        .slice(group.startIndex, group.endIndex + 1)
        .map((creature) => GameManager.getCreatureStats(manager, creature.cardId))
      return {
        ...group,
        attack: stats.reduce((total, creatureStats) => total + creatureStats.attack, 0),
        defense: stats.reduce((total, creatureStats) => total + creatureStats.defense, 0),
      }
    })
  }

  static getSummonOptions(
    manager: GameManager,
    cardId: CardInstanceId,
  ): SummonOption[] {
    const activePlayer = GameManager.getCurrentPlayer(manager)
    if (!activePlayer.hand.includes(cardId)) {
      return []
    }
    const card = getCardInstance(manager.state, cardId).card
    if (card.kind !== 'creature' || manager.state.phase !== 'main') {
      return []
    }
    return getSummonOptionsForState(
      manager.state,
      activePlayer.id,
      card,
      activePlayer.mana,
    )
  }

  static isCardPlayable(manager: GameManager, cardId: CardInstanceId): boolean {
    const activePlayer = GameManager.getCurrentPlayer(manager)
    if (manager.state.phase !== 'main' || !activePlayer.hand.includes(cardId)) {
      return false
    }
    const card = getCardInstance(manager.state, cardId).card
    if (card.kind === 'creature') {
      return GameManager.getSummonOptions(manager, cardId).some(({ canSummon }) => canSummon)
    }
    return GameManager.getSpellPlayActions(manager, cardId).length > 0
  }

  static getSpellPlayActions(
    manager: GameManager,
    cardId: CardInstanceId,
  ): PlaySpellAction[] {
    const activePlayer = GameManager.getCurrentPlayer(manager)
    if (
      manager.state.phase !== 'main' ||
      manager.state.pendingCombat !== null ||
      GameManager.getWinner(manager) !== null ||
      !activePlayer.hand.includes(cardId)
    ) {
      return []
    }
    const card = getCardInstance(manager.state, cardId).card
    if (card.kind !== 'spell' || activePlayer.mana < card.cost) {
      return []
    }

    switch (card.effect.type) {
      case 'fireballAssault':
        return collectBoardGroups(manager.state).flatMap((group) =>
          group.ownerId === activePlayer.id
            ? [{
                type: 'playSpell',
                cardId,
                target: {
                  kind: 'group',
                  startIndex: group.startIndex,
                  endIndex: group.endIndex,
                },
              }]
            : [],
        )
      case 'transfer':
        return manager.state.board.creatures.flatMap(({ cardId: targetCardId }) => {
          const targetInstance = getCardInstance(manager.state, targetCardId)
          return targetInstance.ownerId === activePlayer.id &&
            targetInstance.card.kind === 'creature' &&
            targetInstance.card.color === 'blue'
            ? [{
                type: 'playSpell',
                cardId,
                target: { kind: 'creature', cardId: targetCardId },
              }]
            : []
        })
      case 'bribery':
        return manager.state.board.creatures.flatMap(({ cardId: targetCardId }) => {
          const targetInstance = getCardInstance(manager.state, targetCardId)
          return targetInstance.ownerId !== activePlayer.id &&
            targetInstance.card.kind === 'creature' &&
            activePlayer.mana >= card.cost + targetInstance.card.cost + 1
            ? [{
                type: 'playSpell',
                cardId,
                target: { kind: 'creature', cardId: targetCardId },
              }]
            : []
        })
      case 'selfDestructOrder':
        return manager.state.board.creatures.flatMap(({ cardId: targetCardId }) => {
          const targetInstance = getCardInstance(manager.state, targetCardId)
          return targetInstance.ownerId === activePlayer.id &&
            targetInstance.card.kind === 'creature'
            ? [{
                type: 'playSpell',
                cardId,
                target: { kind: 'creature', cardId: targetCardId },
              }]
            : []
        })
      default:
        return [{ type: 'playSpell', cardId }]
    }
  }

  static getActivatedAbilities(manager: GameManager): ActivatedAbilityOption[] {
    return manager.state.board.creatures.flatMap((_, boardIndex) =>
      new CreatureRules(manager.state, boardIndex).getActivatedActions(),
    )
  }

  static getLegalMainActions(manager: GameManager): GameAction[] {
    if (
      manager.state.phase !== 'main' ||
      manager.state.pendingCombat !== null ||
      GameManager.getWinner(manager) !== null
    ) {
      return []
    }

    const activePlayer = GameManager.getCurrentPlayer(manager)
    const handActions = activePlayer.hand.flatMap((cardId): GameAction[] => {
      const card = getCardInstance(manager.state, cardId).card
      if (card.kind === 'creature') {
        return GameManager.getSummonOptions(manager, cardId)
          .filter(({ canSummon }) => canSummon)
          .map(({ insertIndex }) => ({ type: 'summonCreature', cardId, insertIndex }))
      }
      return GameManager.getSpellPlayActions(manager, cardId)
    })
    const abilityActions = GameManager.getActivatedAbilities(manager).flatMap(
      (option): GameAction[] =>
        option.enabled
          ? [{
              type: 'activateAbility',
              sourceCardId: option.sourceCardId,
              abilityType: option.abilityType,
            }]
          : [],
    )
    const discardActions: GameAction[] = manager.state.hasDiscardedThisTurn
      ? []
      : activePlayer.hand.map((cardId) => ({ type: 'discardFromHand', cardId }))

    return [...handActions, ...abilityActions, ...discardActions]
  }

  static getLegalBattleActions(manager: GameManager): GameAction[] {
    if (
      manager.state.phase !== 'battle' ||
      manager.state.hasAttackedThisTurn ||
      !GameManager.canCurrentPlayerAttack(manager) ||
      manager.state.pendingCombat !== null ||
      GameManager.getWinner(manager) !== null
    ) {
      return []
    }

    return collectBoardGroups(manager.state).flatMap((group): GameAction[] =>
      group.ownerId === manager.state.activePlayerId
        ? [{
            type: 'attackGroup',
            startIndex: group.startIndex,
            endIndex: group.endIndex,
          }]
        : [],
    )
  }

  static getLegalActions(manager: GameManager): GameAction[] {
    if (GameManager.getWinner(manager) !== null) {
      return []
    }
    if (manager.state.pendingCombat !== null) {
      return [{ type: 'finishCombat' }]
    }

    switch (manager.state.phase) {
      case 'keepUp':
        return [{ type: 'resolveKeepUp' }]
      case 'main':
        return [...GameManager.getLegalMainActions(manager), { type: 'passPhase' }]
      case 'battle':
        return [...GameManager.getLegalBattleActions(manager), { type: 'passPhase' }]
      case 'cleanup':
        return [{ type: 'passPhase' }]
    }
  }

  static applyAction(manager: GameManager, action: GameAction): GameManager {
    switch (action.type) {
      case 'resolveKeepUp':
        return GameManager.resolveKeepUp(manager)
      case 'passPhase':
        return GameManager.passPhase(manager)
      case 'summonCreature':
        return GameManager.summonCreature(manager, action.cardId, action.insertIndex)
      case 'playSpell':
        return GameManager.playSpell(manager, action.cardId, action.target)
      case 'attackGroup':
        return GameManager.attackGroup(manager, action.startIndex, action.endIndex)
      case 'finishCombat':
        return GameManager.finishCombat(manager)
      case 'activateAbility':
        return GameManager.activateAbility(
          manager,
          action.sourceCardId,
          action.abilityType,
        )
      case 'discardFromHand':
        return GameManager.discardFromHand(manager, action.cardId)
    }
  }

  static resolveKeepUp(manager: GameManager): GameManager {
    assertGameInProgress(manager.state)
    return GameManager.from(resolveKeepUpState(manager.state))
  }

  static passPhase(manager: GameManager): GameManager {
    assertGameInProgress(manager.state)
    if (manager.state.pendingCombat) {
      throw new Error('Combat results must finish resolving before the phase can advance.')
    }
    if (manager.state.phase === 'keepUp') {
      return GameManager.resolveKeepUp(manager)
    }

    const currentPhaseIndex = PHASE_ORDER.indexOf(manager.state.phase)
    const nextPhase = PHASE_ORDER[currentPhaseIndex + 1]

    if (manager.state.phase === 'cleanup') {
      return GameManager.from(endTurnState(manager.state))
    }
    if (!nextPhase) {
      throw new Error(`Invalid phase: ${manager.state.phase}`)
    }

    return GameManager.from({
      ...manager.state,
      phase: nextPhase,
    })
  }

  static summonCreature(
    manager: GameManager,
    cardId: CardInstanceId,
    insertIndex: number,
  ): GameManager {
    assertGameInProgress(manager.state)
    if (manager.state.phase !== 'main') {
      throw new Error('Creatures can only be summoned during the main phase.')
    }

    const activePlayer = GameManager.getCurrentPlayer(manager)
    if (!activePlayer.hand.includes(cardId)) {
      throw new Error(`Card instance ${cardId} is not in ${activePlayer.name}'s hand.`)
    }
    const instance = getCardInstance(manager.state, cardId)
    const { card } = instance
    if (card.kind !== 'creature') {
      throw new Error('Selected card is not a creature.')
    }
    if (
      !Number.isInteger(insertIndex) ||
      insertIndex < 0 ||
      insertIndex > manager.state.board.creatures.length ||
      !(getRequiredMarchForInsert(manager.state, activePlayer.id, insertIndex, false) <= card.march)
    ) {
      throw new Error('The creature cannot be summoned at this position.')
    }
    const boardRules = manager.state.board.creatures.map(
      (_, boardIndex) => new CreatureRules(manager.state, boardIndex),
    )
    const effectiveCost = getEffectiveSummonCost(card, activePlayer.id, insertIndex, boardRules)
    if (!(effectiveCost <= activePlayer.mana)) {
      throw new Error('Not enough mana to summon this creature.')
    }

    const creature: CreatureInstance = {
      cardId,
      summonedTurn: manager.state.turn,
    }
    const playerWithoutCard = removeHandCard(activePlayer, cardId)
    const nextPlayer = {
      ...playerWithoutCard,
      mana: playerWithoutCard.mana - effectiveCost,
    }
    const nextCreatures = [
      ...manager.state.board.creatures.slice(0, insertIndex),
      creature,
      ...manager.state.board.creatures.slice(insertIndex),
    ]

    return GameManager.from({
      ...replacePlayer(manager.state, nextPlayer),
      board: {
        creatures: nextCreatures,
      },
    })
  }

  static playSpell(
    manager: GameManager,
    cardId: CardInstanceId,
    target?: SpellTarget,
  ): GameManager {
    assertGameInProgress(manager.state)
    if (manager.state.phase !== 'main') {
      throw new Error('Spells can only be played during the main phase.')
    }
    if (manager.state.pendingCombat !== null) {
      throw new Error('A spell cannot be played while damage is resolving.')
    }

    const activePlayer = GameManager.getCurrentPlayer(manager)
    if (!activePlayer.hand.includes(cardId)) {
      throw new Error(`Card instance ${cardId} is not in ${activePlayer.name}'s hand.`)
    }
    const instance = getCardInstance(manager.state, cardId)
    if (instance.card.kind !== 'spell') {
      throw new Error('Selected card is not a spell.')
    }
    if (activePlayer.mana < instance.card.cost) {
      throw new Error('Not enough mana to play this spell.')
    }
    const isLegalTarget = GameManager.getSpellPlayActions(manager, cardId).some(
      (action) => areSpellTargetsEqual(action.target, target),
    )
    if (!isLegalTarget) {
      throw new Error('The selected spell target is not valid.')
    }
    const playerWithoutCard = removeHandCard(activePlayer, cardId)
    const paidPlayer = {
      ...playerWithoutCard,
      mana: playerWithoutCard.mana - instance.card.cost,
    }
    const exileResult = 'exileColor' in instance.card.effect
      ? exileDiscardedCreatures(
          manager.state,
          paidPlayer,
          instance.card.effect.exileColor,
        )
      : { player: paidPlayer, count: 0 }
    const { player: playerAfterExile, count: effectAmount } = exileResult

    const nextPlayer = {
      ...playerAfterExile,
      hp:
        playerAfterExile.hp +
        (instance.card.effect.type === 'lifeDroplet' ? effectAmount : 0),
      mana:
        playerAfterExile.mana +
        (instance.card.effect.type === 'abundance' ? effectAmount : 0),
      discard:
        activePlayer.placedSpell === null
          ? playerAfterExile.discard
          : [...playerAfterExile.discard, activePlayer.placedSpell.cardId],
      placedSpell: { cardId, effectAmount },
    }
    const stateAfterSpell = replacePlayer(manager.state, nextPlayer)

    switch (instance.card.effect.type) {
      case 'cataclysm':
        return GameManager.from({
          ...stateAfterSpell,
          board: {
            ...stateAfterSpell.board,
            creatures: stateAfterSpell.board.creatures.toReversed(),
          },
        })
      case 'returnFire':
        return GameManager.from(
          applyReturnFire(stateAfterSpell, activePlayer.id, effectAmount),
        )
      case 'fireballAssault':
        if (target?.kind !== 'group') {
          throw new Error('Fireball assault requires a group target.')
        }
        return GameManager.from(
          applyFireballAssault(stateAfterSpell, activePlayer.id, target),
        )
      case 'transfer':
        if (target?.kind !== 'creature') {
          throw new Error('Transfer requires a creature target.')
        }
        return GameManager.from(applyTransfer(stateAfterSpell, target))
      case 'lifeCycle':
        return GameManager.from(applyLifeCycle(stateAfterSpell, activePlayer.id))
      case 'bribery':
        if (target?.kind !== 'creature') {
          throw new Error('Bribery requires a creature target.')
        }
        return GameManager.from(applyBribery(stateAfterSpell, activePlayer.id, target))
      case 'selfDestructOrder':
        if (target?.kind !== 'creature') {
          throw new Error('Self-destruct order requires a creature target.')
        }
        return GameManager.from(
          applySelfDestructOrder(stateAfterSpell, activePlayer.id, target),
        )
      default:
        return GameManager.from(stateAfterSpell)
    }
  }

  private static getAttackState(manager: GameManager, startIndex: number, endIndex: number): GameState {
    assertGameInProgress(manager.state)
    if (manager.state.phase !== 'main' && manager.state.phase !== 'battle') {
      throw new Error('Groups can only attack during the main or battle phase.')
    }
    if (manager.state.pendingCombat) {
      throw new Error('The previous combat is still resolving.')
    }
    if (manager.state.hasAttackedThisTurn) {
      throw new Error('Only one group can attack each turn.')
    }
    if (!GameManager.canCurrentPlayerAttack(manager)) {
      throw new Error('The current player cannot attack this turn.')
    }

    const attackerId = manager.state.activePlayerId
    const defenderId = getOpponentId(attackerId)
    const board = manager.state.board.creatures
    if (!isWholeGroup(manager.state, attackerId, startIndex, endIndex)) {
      throw new Error('The selected range is not one whole attacking group.')
    }

    const direction = attackerId === 'playerA' ? 1 : -1
    const targetIndex = direction === 1 ? endIndex + 1 : startIndex - 1
    const attackPower = board
      .slice(startIndex, endIndex + 1)
      .reduce(
        (total, creature) =>
          total +
          CreatureRules.fromCardId(manager.state, creature.cardId).getEffectiveStats().attack,
        0,
      )

    const discardCount = board.slice(startIndex, endIndex + 1).reduce(
      (total, creature) => total + CreatureRules.fromCardId(
        manager.state, creature.cardId,
      ).getAttackDeckDiscardCount(attackPower),
      0,
    )
    const attacker = manager.state.players[attackerId]
    const players = discardCount > 0 && attacker.deck.length > 0
      ? {
          ...manager.state.players,
          [attackerId]: {
            ...attacker,
            deck: attacker.deck.slice(discardCount),
            discard: [...attacker.discard, ...attacker.deck.slice(0, discardCount)],
          },
        }
      : manager.state.players

    if (targetIndex < 0 || targetIndex >= board.length) {
      const playerDamage = Math.max(
        0,
        attackPower - getPlayerBarrierForState(manager.state, defenderId),
      )
      const attackerManaGain =
        playerDamage > 0
          ? board
              .slice(startIndex, endIndex + 1)
              .reduce(
                (total, creature) =>
                  total +
                  CreatureRules.fromCardId(
                    manager.state,
                    creature.cardId,
                  ).getPlayerDamageManaGain(),
                0,
              )
          : 0
      return {
        ...manager.state,
        phase: 'battle',
        hasAttackedThisTurn: true,
        pendingCombat: {
          damageMarkers: [],
          destroyedCardIds: [],
          defendingPlayerId: defenderId,
          playerWasHit: true,
          playerDamage,
          ...(attackerManaGain > 0 ? { attackerManaGain } : {}),
        },
        players,
      }
    }
    if (getCreatureOwner(manager.state, board[targetIndex]) !== defenderId) {
      throw new Error('The attacking group is not adjacent to an enemy group or player.')
    }

    const defendingGroupIndexes = collectDefendingGroup(
      manager.state,
      defenderId,
      targetIndex,
      direction,
    )
    let remainingAttack = attackPower
    const destroyedIndexes: number[] = []
    const damageMarkers: NonNullable<GameState['pendingCombat']>['damageMarkers'] = []

    for (const index of defendingGroupIndexes) {
      const defender = board[index]
      if (remainingAttack <= 0) {
        break
      }
      damageMarkers.push({
        cardId: defender.cardId,
        damage: remainingAttack,
      })

      const defense = CreatureRules.fromCardId(
        manager.state,
        defender.cardId,
      ).getEffectiveStats().defense
      if (remainingAttack < defense) {
        break
      }
      remainingAttack -= defense
      destroyedIndexes.push(index)
    }

    const groupTouchedDefenderPlayer =
      direction === 1
        ? defendingGroupIndexes.at(-1) === board.length - 1
        : defendingGroupIndexes.at(-1) === 0
    const playerWasHit =
      destroyedIndexes.length === defendingGroupIndexes.length && groupTouchedDefenderPlayer
    const playerDamage = playerWasHit
      ? Math.max(
          0,
          remainingAttack - getPlayerBarrierForState(manager.state, defenderId),
        )
      : 0
    const attackerManaGain =
      playerDamage > 0
        ? board
            .slice(startIndex, endIndex + 1)
            .reduce(
              (total, creature) =>
                total +
                CreatureRules.fromCardId(
                  manager.state,
                  creature.cardId,
                ).getPlayerDamageManaGain(),
              0,
            )
        : 0
    const defendingFront = board[targetIndex]
    const counterDamage = CreatureRules.fromCardId(
      manager.state,
      defendingFront.cardId,
    ).getCounterAttack()
    if (counterDamage > 0) {
      const attackingFrontIndex = attackerId === 'playerA' ? endIndex : startIndex
      const attackingFront = board[attackingFrontIndex]
      damageMarkers.push({ cardId: attackingFront.cardId, damage: counterDamage })
      const attackingFrontDefense = CreatureRules.fromCardId(
        manager.state,
        attackingFront.cardId,
      ).getEffectiveStats().defense
      if (counterDamage >= attackingFrontDefense) {
        destroyedIndexes.push(attackingFrontIndex)
      }
    }

    return {
      ...manager.state,
      phase: 'battle',
      hasAttackedThisTurn: true,
      pendingCombat: {
        damageMarkers,
        destroyedCardIds: [...new Set(destroyedIndexes.map((index) => board[index].cardId))],
        defendingPlayerId: defenderId,
        playerWasHit,
        playerDamage,
        ...(attackerManaGain > 0 ? { attackerManaGain } : {}),
      },
      players,
    }
  }

  static attackGroup(manager: GameManager, startIndex: number, endIndex: number): GameManager {
    return GameManager.from(GameManager.getAttackState(manager, startIndex, endIndex))
  }

  static previewCombat(
    manager: GameManager,
    startIndex: number,
    endIndex: number,
  ): CombatPreview & { nextManager: GameManager } {
    const attackerId = manager.state.activePlayerId
    const pendingState = GameManager.getAttackState(manager, startIndex, endIndex)
    // Validate the intermediate result without copying a state used only by this preview.
    assertValidGameState(pendingState)
    const pendingCombat = pendingState.pendingCombat
    if (!pendingCombat) {
      throw new Error('Combat preview did not produce combat results.')
    }

    const resolvedState = resolvePendingCombatState(pendingState)
    const refundedMana = Object.fromEntries(
      PLAYER_IDS.flatMap((playerId) => {
        const refund = resolvedState.players[playerId].mana - manager.state.players[playerId].mana
        return refund > 0 ? [[playerId, refund]] : []
      }),
    ) as Partial<Record<PlayerId, number>>
    const nextManager = GameManager.from(resolvedState)

    return {
      attackerId,
      attackingGroup: { startIndex, endIndex },
      destroyedCardIds: [...pendingCombat.destroyedCardIds],
      refundedMana,
      playerDamage: pendingCombat.playerDamage,
      attackerManaGain: pendingCombat.attackerManaGain ?? 0,
      nextState: nextManager.state,
      nextManager,
    }
  }

  static finishCombat(manager: GameManager): GameManager {
    const endsTurnAfterResolution =
      manager.state.pendingCombat?.endsTurnAfterResolution !== false
    const resolvedState = resolvePendingCombatState(manager.state)
    return GameManager.from(
      endsTurnAfterResolution && getWinnerFromState(resolvedState) === null
        ? endTurnState(resolvedState)
        : resolvedState,
    )
  }

  static activateAbility(
    manager: GameManager,
    sourceCardId: CardInstanceId,
    abilityType: ActivatedAbilityType,
  ): GameManager {
    assertGameInProgress(manager.state)
    const rules = CreatureRules.fromCardId(manager.state, sourceCardId)
    const option = rules
      .getActivatedActions()
      .find((candidate) => candidate.abilityType === abilityType)
    if (!option) {
      throw new Error(`Creature card ${sourceCardId} does not have ${abilityType}.`)
    }
    if (!option.enabled) {
      throw new Error(option.reason ?? 'This ability cannot be activated now.')
    }

    const resolution = rules.getActivatedAbilityResolution(abilityType)
    if (resolution.destination === 'board') {
      const creatures = [...manager.state.board.creatures]
      const sourceIndex = creatures.findIndex(({ cardId }) => cardId === sourceCardId)
      const [source] = creatures.splice(sourceIndex, 1)
      creatures.splice(resolution.boardIndex, 0, source)
      return GameManager.from({ ...manager.state, board: { creatures } })
    }
    const owner = manager.state.players[rules.ownerId]
    const nextOwner = {
      ...owner,
      mana: owner.mana + resolution.mana,
      [resolution.destination]: [...owner[resolution.destination], sourceCardId],
    }

    return GameManager.from({
      ...replacePlayer(manager.state, nextOwner),
      board: {
        creatures: manager.state.board.creatures.filter(
          ({ cardId }) => cardId !== sourceCardId,
        ),
      },
    })
  }

  static discardFromHand(manager: GameManager, cardId: CardInstanceId): GameManager {
    assertGameInProgress(manager.state)
    if (manager.state.phase !== 'main') {
      throw new Error('Cards can only be discarded during the main phase.')
    }
    if (manager.state.pendingCombat !== null) {
      throw new Error('Cards cannot be discarded while combat is resolving.')
    }
    if (manager.state.hasDiscardedThisTurn) {
      throw new Error('Only one card can be discarded each turn.')
    }
    const activePlayer = GameManager.getCurrentPlayer(manager)
    return GameManager.from({
      ...replacePlayer(manager.state, discardCard(activePlayer, cardId)),
      hasDiscardedThisTurn: true,
    })
  }
}
