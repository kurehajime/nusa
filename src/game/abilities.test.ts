import { describe, expect, it } from 'vitest'
import { GameManager, assertValidGameState } from './GameManager'
import { GameAI } from './ai/GameAI'
import { CreatureRules, describeAbility } from './CreatureRules'
import {
  getCrossedIndexes,
  isAdjacentInsertToAnchor,
  isForwardInsertFromAnchor,
} from './boardQueries'
import { CARD_DEFINITION_IDS, CREATURE_CARDS } from './cards'
import { STANDARD_DECK_LIST } from './decks'
import type {
  CardInstanceId,
  CreatureCard,
  GameState,
  Phase,
  PlayerId,
} from './types'

const KEEP_ORDER_RANDOM = () => 1 - Number.EPSILON
const CARD_ID = CARD_DEFINITION_IDS

type BoardSpec = {
  cardId: CardInstanceId
  summonedTurn?: number
}

type ConfigureOptions = {
  board: BoardSpec[]
  activePlayerId?: PlayerId
  phase?: Phase
  mana?: Partial<Record<PlayerId, number>>
  hp?: Partial<Record<PlayerId, number>>
  handAdditions?: CardInstanceId[]
  turn?: number
}

const createTestManager = (): GameManager => GameManager.create(KEEP_ORDER_RANDOM)

const withHandSize = (
  manager: GameManager,
  playerId: PlayerId,
  handSize: number,
): GameManager => {
  const player = manager.state.players[playerId]
  const returnedToDeck = player.hand.slice(handSize)

  return GameManager.from({
    ...manager.state,
    players: {
      ...manager.state.players,
      [playerId]: {
        ...player,
        hand: player.hand.slice(0, handSize),
        deck: [...returnedToDeck, ...player.deck],
      },
    },
  })
}

const findCardIds = (
  state: GameState,
  ownerId: PlayerId,
  definitionId: string,
  count = 1,
): CardInstanceId[] => {
  const ids = Object.values(state.cards)
    .filter(
      (instance) =>
        instance.ownerId === ownerId && instance.card.definitionId === definitionId,
    )
    .map(({ id }) => id)
    .slice(0, count)
  if (ids.length !== count) {
    throw new Error(`Expected ${count} copies of ${definitionId} for ${ownerId}.`)
  }
  return ids
}

const configureManager = (
  manager: GameManager,
  {
    board,
    activePlayerId = 'playerA',
    phase = 'main',
    mana = {},
    hp = {},
    handAdditions = [],
    turn = 10,
  }: ConfigureOptions,
): GameManager => {
  const movedCardIds = new Set([
    ...board.map(({ cardId }) => cardId),
    ...handAdditions,
  ])
  const preparePlayer = (playerId: PlayerId) => {
    const player = manager.state.players[playerId]
    const addedHandCards = handAdditions.filter(
      (cardId) => manager.state.cards[cardId].ownerId === playerId,
    )
    return {
      ...player,
      hp: hp[playerId] ?? player.hp,
      mana: mana[playerId] ?? player.mana,
      deck: player.deck.filter((cardId) => !movedCardIds.has(cardId)),
      hand: [
        ...player.hand.filter((cardId) => !movedCardIds.has(cardId)),
        ...addedHandCards,
      ],
      discard: player.discard.filter((cardId) => !movedCardIds.has(cardId)),
    }
  }

  return GameManager.from({
    ...manager.state,
    turn,
    activePlayerId,
    phase,
    hasAttackedThisTurn: false,
    pendingCombat: null,
    players: {
      playerA: preparePlayer('playerA'),
      playerB: preparePlayer('playerB'),
    },
    board: {
      creatures: board.map(({ cardId, summonedTurn = turn - 1 }) => ({
        cardId,
        summonedTurn,
      })),
    },
  })
}

const createExpansionTestManager = (): GameManager => {
  const deck = [
    ...STANDARD_DECK_LIST,
    CARD_ID.MEPHISTOPHELES,
    CARD_ID.MAGICIAN,
    CARD_ID.THIEF,
  ]
  return GameManager.create(KEEP_ORDER_RANDOM, {
    playerA: deck,
    playerB: deck,
  })
}

describe('board march distance', () => {
  it('counts crossed cards and only uses creature anchors toward the opponent', () => {
    expect(getCrossedIndexes(4, 'playerA', 2, 0)).toEqual([0, 1])
    expect(getCrossedIndexes(4, 'playerA', 1, 4)).toEqual([2, 3])
    expect(getCrossedIndexes(4, 'playerB', null, 1)).toEqual([1, 2, 3])
    expect(isForwardInsertFromAnchor('playerA', 2, 2)).toBe(false)
    expect(isForwardInsertFromAnchor('playerA', 2, 3)).toBe(true)
    expect(isForwardInsertFromAnchor('playerB', 2, 2)).toBe(true)
    expect(isForwardInsertFromAnchor('playerB', 2, 3)).toBe(false)
    expect(isAdjacentInsertToAnchor(2, 2)).toBe(true)
    expect(isAdjacentInsertToAnchor(2, 3)).toBe(true)
    expect(isAdjacentInsertToAnchor(2, 1)).toBe(false)
  })
})

describe('CreatureRules position modifiers', () => {
  it.each<PlayerId>(['playerA', 'playerB'])('grants escort only next to %s and recalculates after insertion', ownerId => {
    const initial = withHandSize(createTestManager(), ownerId, 4)
    const [guard, secondGuard] = findCardIds(initial.state, ownerId, CARD_ID.ROOT_FORT_REARGUARD, 2)
    const [ally] = findCardIds(initial.state, ownerId, CARD_ID.OAKBARK_SENTINEL)
    const enemyId = ownerId === 'playerA' ? 'playerB' : 'playerA'
    const [enemy] = findCardIds(initial.state, enemyId, CARD_ID.SPARK_SWORDSMAN)
    const boardFromOwnSide = (ids: CardInstanceId[]) =>
      (ownerId === 'playerA' ? ids : [...ids].reverse()).map(cardId => ({ cardId }))

    for (const ids of [[guard], [guard, ally, enemy], [guard, secondGuard, enemy]]) {
      const manager = configureManager(initial, { board: boardFromOwnSide(ids) })
      expect(GameManager.getCreatureStats(manager, guard)).toMatchObject({ attack: 3, defense: 5 })
      if (ids.includes(secondGuard)) {
        expect(GameManager.getCreatureStats(manager, secondGuard)).toMatchObject({ attack: 2, defense: 2 })
      }
    }
    for (const ids of [[ally, guard, enemy], [enemy, guard]]) {
      const manager = configureManager(initial, { board: boardFromOwnSide(ids) })
      expect(GameManager.getCreatureStats(manager, guard)).toMatchObject({ attack: 2, defense: 2 })
    }

    const manager = configureManager(initial, {
      board: boardFromOwnSide([guard, enemy]), activePlayerId: ownerId,
      handAdditions: [ally], mana: { [ownerId]: 2 },
    })
    const inserted = GameManager.summonCreature(manager, ally, ownerId === 'playerA' ? 0 : 2)
    expect(GameManager.getCreatureStats(inserted, guard)).toMatchObject({ attack: 2, defense: 2 })

    const battle = configureManager(initial, {
      board: boardFromOwnSide([guard, enemy]), activePlayerId: enemyId, phase: 'battle',
    })
    const enemyIndex = ownerId === 'playerA' ? 1 : 0
    const preview = GameManager.previewCombat(battle, enemyIndex, enemyIndex)
    expect(preview.destroyedCardIds).not.toContain(guard)
    expect(preview.playerDamage).toBe(0)
  })

  it('keeps rejecting invalid positions, missing cards, and spells on the board', () => {
    const manager = createTestManager()
    expect(() => new CreatureRules(manager.state, -1)).toThrow(/No creature exists/)
    const [spellId] = findCardIds(manager.state, 'playerA', CARD_ID.RETURN_FIRE)
    for (const cardId of [0, spellId]) {
      expect(() => new CreatureRules({
        ...manager.state,
        board: { creatures: [{ cardId, summonedTurn: 1 }] },
      }, 0)).toThrow(/does not contain a creature card/)
    }
  })

  it.each([
    ['playerA', CARD_ID.SOLITARY_PEAK_SWORDSMAN],
    ['playerB', CARD_ID.SOLITARY_PEAK_SWORDSMAN],
    ['playerA', CARD_ID.LONE_ARMY_GENERAL],
    ['playerB', CARD_ID.LONE_ARMY_GENERAL],
  ] as const)('activates lone warrior for any singleton group: %s %s', (ownerId, definitionId) => {
    const initial = createTestManager()
    const opponentId = ownerId === 'playerA' ? 'playerB' : 'playerA'
    const [source] = findCardIds(initial.state, ownerId, definitionId)
    const [ally] = findCardIds(initial.state, ownerId, CARD_ID.SPARK_SWORDSMAN)
    const [enemyLeft, enemyRight] = findCardIds(initial.state, opponentId, CARD_ID.SPARK_SWORDSMAN, 2)
    const card = initial.state.cards[source].card as CreatureCard
    const ability = card.abilities.find((candidate) => candidate.type === 'loneWarrior')!
    const positions = [
      { ids: [source], active: true },
      { ids: [source, enemyRight], active: true },
      { ids: [enemyLeft, source], active: true },
      { ids: [enemyLeft, source, enemyRight], active: true },
      { ids: [ally, enemyLeft, source], active: true },
      { ids: [source, ally], active: false },
      { ids: [ally, source], active: false },
      { ids: [enemyLeft, source, ally, enemyRight], active: false },
    ]
    for (const { ids, active } of positions) {
      const manager = configureManager(initial, { board: ids.map((cardId) => ({ cardId })) })
      expect(GameManager.getCreatureStatModifier(manager, source), `board: ${ids}`).toEqual({
        attack: active ? ability.attack : 0,
        defense: active ? ability.defense : 0,
      })
      expect(GameManager.getCreatureStats(manager, source), `board: ${ids}`).toEqual({
        attack: card.attack + (active ? ability.attack : 0),
        defense: card.defense + (active ? ability.defense : 0),
        march: card.march,
      })
    }
  })

  it('describes the singleton group condition for lone warrior', () => {
    expect(describeAbility({ type: 'loneWarrior', attack: 2, defense: 1 }))
      .toBe('このクリーチャーの所属するグループが1体の場合、攻撃力+2、防御力+1する。')
  })

  it('applies position abilities without giving every creature summon sickness', () => {
    const initial = createTestManager()
    const [loneWarrior] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SOLITARY_PEAK_SWORDSMAN,
    )
    const [enemyLeft, enemyRight] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
      2,
    )
    let manager = configureManager(initial, {
      board: [
        { cardId: enemyLeft },
        { cardId: loneWarrior },
        { cardId: enemyRight },
      ],
    })
    expect(GameManager.getCreatureStats(manager, loneWarrior)).toEqual({
      attack: 4,
      defense: 1,
      march: 1,
    })
    expect(GameManager.getCreatureStatModifier(manager, loneWarrior)).toEqual({
      attack: 2,
      defense: 0,
    })

    const [assassin] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.CRIMSON_BLADE_INFILTRATOR,
    )
    manager = configureManager(initial, { board: [{ cardId: assassin }] })
    expect(GameManager.getCreatureStats(manager, assassin).attack).toBe(4)

    const [rearguardA] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.ROOT_FORT_REARGUARD,
    )
    manager = configureManager(initial, {
      board: [{ cardId: enemyLeft }, { cardId: rearguardA }],
    })
    expect(GameManager.getCreatureStats(manager, rearguardA)).toMatchObject({ attack: 2, defense: 2 })

    const [rearguardB] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.ROOT_FORT_REARGUARD,
    )
    const [allyA] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.OAKBARK_SENTINEL,
    )
    manager = configureManager(initial, {
      board: [{ cardId: rearguardB }, { cardId: allyA }],
    })
    expect(GameManager.getCreatureStats(manager, rearguardB)).toMatchObject({ attack: 2, defense: 2 })

    manager = configureManager(initial, {
      board: [{ cardId: allyA, summonedTurn: 10 }],
      turn: 10,
    })
    expect(GameManager.getCreatureStats(manager, allyA).attack).toBe(2)
    const currentCreatureCards: readonly CreatureCard[] = CREATURE_CARDS
    expect(
      currentCreatureCards.filter((card) =>
        card.abilities.some((ability) => ability.type === 'summoningSickness'),
      ).map(card => card.definitionId),
    ).toEqual([])

    const allyInstance = manager.state.cards[allyA]
    if (allyInstance.card.kind !== 'creature') {
      throw new Error('Expected a creature card.')
    }
    manager = GameManager.from({
      ...manager.state,
      cards: {
        ...manager.state.cards,
        [allyA]: {
          ...allyInstance,
          card: {
            ...allyInstance.card,
            abilities: [
              ...allyInstance.card.abilities,
              { type: 'summoningSickness' },
            ],
          },
        },
      },
    })
    expect(GameManager.getCreatureStats(manager, allyA).attack).toBe(0)
  })

  it('applies trickster attack or defense according to player HP', () => {
    const initial = createExpansionTestManager()
    const [magician] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.MAGICIAN,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: magician }],
      hp: { playerA: 20, playerB: 10 },
    })
    expect(GameManager.getCreatureStats(manager, magician)).toEqual({
      attack: 5,
      defense: 1,
      march: 2,
    })

    manager = configureManager(initial, {
      board: [{ cardId: magician }],
      hp: { playerA: 10, playerB: 20 },
    })
    expect(GameManager.getCreatureStats(manager, magician)).toEqual({
      attack: 1,
      defense: 5,
      march: 2,
    })
  })

  it('adds repeated numeric abilities while keeping the card instance serializable', () => {
    const initial = createTestManager()
    const [source] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SOLITARY_PEAK_SWORDSMAN,
    )
    const [enemyLeft, enemyRight] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
      2,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: enemyLeft }, { cardId: source }, { cardId: enemyRight }],
    })
    const instance = manager.state.cards[source]
    if (instance.card.kind !== 'creature') {
      throw new Error('Expected a creature card.')
    }
    manager = GameManager.from({
      ...manager.state,
      cards: {
        ...manager.state.cards,
        [source]: {
          ...instance,
          card: {
            ...instance.card,
            abilities: [
              { type: 'loneWarrior', attack: 1, defense: 0 },
              { type: 'loneWarrior', attack: 2, defense: 1 },
            ],
          },
        },
      },
    })

    expect(GameManager.getCreatureStats(manager, source)).toEqual({
      attack: 5,
      defense: 2,
      march: 1,
    })
    expect(JSON.parse(JSON.stringify(manager.state.cards[source]))).toEqual(
      manager.state.cards[source],
    )
  })
})

describe('summon modifiers', () => {
  it.each(['playerA', 'playerB'] as const)(
    'matches individual position queries across all short capture/beachhead boards for %s',
    (ownerId) => {
      const boardCards = [CARD_ID.TIDEFRONT_FORTIFIER, CARD_ID.VINE_SNARE_HUNTER]
      const deck = [CARD_ID.SPARK_SWORDSMAN, ...Array.from({ length: 4 }, () => boardCards).flat()]
      const initial = withHandSize(withHandSize(
        GameManager.create(KEEP_ORDER_RANDOM, { playerA: deck, playerB: deck }),
        'playerA', 0,
      ), 'playerB', 0)
      const [summonId] = findCardIds(initial.state, ownerId, CARD_ID.SPARK_SWORDSMAN)
      const summonCard = initial.state.cards[summonId].card as CreatureCard
      const pools = (['playerA', 'playerB'] as const).flatMap((playerId) =>
        boardCards.map((definitionId) => findCardIds(initial.state, playerId, definitionId, 4)),
      )

      for (let length = 0; length <= 4; length += 1) {
        for (let pattern = 0; pattern < 4 ** length; pattern += 1) {
          const used = [0, 0, 0, 0]
          const board = Array.from({ length }, (_, index) => {
            const type = Math.floor(pattern / 4 ** index) % 4
            return { cardId: pools[type][used[type]++] }
          })
          const availableMana = [0, 1, 2, 4][pattern % 4]
          const manager = configureManager(initial, {
            board, activePlayerId: ownerId, handAdditions: [summonId],
            mana: { [ownerId]: availableMana },
          })
          const withoutCapture = GameManager.from({
            ...manager.state,
            cards: Object.fromEntries(Object.entries(manager.state.cards).map(([id, instance]) => [
              id, {
                ...instance,
                card: instance.card.kind === 'creature' ? {
                  ...instance.card,
                  abilities: instance.card.abilities.filter((ability) => ability.type !== 'capture'),
                } : instance.card,
              },
            ])),
          })
          const expected = Array.from({ length: length + 1 }, (_, insertIndex) => {
            const requiredMarch = GameManager.getRequiredMarchForInsert(manager, ownerId, insertIndex)
            const costModifier = board.reduce((total, _, index) => total +
              new CreatureRules(manager.state, index).getSummonCostModifier(ownerId, insertIndex), 0)
            const effectiveCost = Math.max(0, summonCard.cost + costModifier)
            const canReach = requiredMarch <= summonCard.march
            const affordable = effectiveCost <= availableMana
            return { insertIndex, requiredMarch, effectiveCost, canReach, affordable,
              canSummon: canReach && affordable }
          })
          expect(GameManager.getSummonOptions(manager, summonId)).toEqual(expected)
          const originalState = structuredClone(manager.state)
          for (const option of expected) {
            if (!option.canReach) {
              expect(() => GameManager.summonCreature(manager, summonId, option.insertIndex))
                .toThrow('The creature cannot be summoned at this position.')
            } else if (!option.affordable) {
              expect(() => GameManager.summonCreature(manager, summonId, option.insertIndex))
                .toThrow('Not enough mana to summon this creature.')
            } else {
              const next = GameManager.summonCreature(manager, summonId, option.insertIndex)
              expect(next.state.players[ownerId].mana).toBe(availableMana - option.effectiveCost)
              expect(next.state.players[ownerId].hand).not.toContain(summonId)
              expect(next.state.board.creatures[option.insertIndex].cardId).toBe(summonId)
            }
          }
          expect(manager.state).toEqual(originalState)
          for (const ignoreCapture of [false, true]) {
            const reference = ignoreCapture ? withoutCapture : manager
            const distances = Array.from({ length: length + 1 }, (_, insertIndex) =>
              GameManager.getRequiredMarchForInsert(reference, ownerId, insertIndex))
            for (const march of [-1, 0, 1, 2, 3, 4, 8, Infinity, NaN]) {
              expect(GameManager.countReachableSummonPositions(manager, ownerId, march, ignoreCapture))
                .toBe(distances.filter((distance) => distance <= march).length)
            }
          }
        }
      }
    },
  )

  it('keeps march zero creatures at the starting edge when they have no ally anchor', () => {
    const initial = withHandSize(createTestManager(), 'playerA', 4)
    const [enemy] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
    )
    const [rootedCreature] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.ROOTED_ANCIENT,
    )
    const manager = configureManager(initial, {
      board: [{ cardId: enemy }],
      mana: { playerA: 2 },
      handAdditions: [rootedCreature],
    })

    expect(GameManager.getSummonOptions(manager, rootedCreature)[0]).toMatchObject({
      requiredMarch: 0,
      canReach: true,
    })
    expect(GameManager.getSummonOptions(manager, rootedCreature)[1]).toMatchObject({
      requiredMarch: 1,
      canReach: false,
    })
  })

  it('does not use an advanced creature as an anchor for a backward interruption', () => {
    const initial = createTestManager()
    const enemies = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
      3,
    )
    const [advancedAlly] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.OAKBARK_SENTINEL,
    )
    const [summonCard] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SPARK_SWORDSMAN,
    )
    let manager = configureManager(initial, {
      board: [
        { cardId: enemies[0] },
        { cardId: enemies[1] },
        { cardId: enemies[2] },
        { cardId: advancedAlly },
      ],
      mana: { playerA: 2 },
    })

    expect(GameManager.getSummonOptions(manager, summonCard)[2]).toMatchObject({
      requiredMarch: 2,
      canReach: false,
    })
    expect(GameManager.getSummonOptions(manager, summonCard)[3]).toMatchObject({
      requiredMarch: 0,
      canReach: true,
    })
    expect(GameManager.getSummonOptions(manager, summonCard)[4]).toMatchObject({
      requiredMarch: 0,
      canReach: true,
    })
    expect(() => GameManager.summonCreature(manager, summonCard, 2)).toThrow(
      /cannot be summoned at this position/,
    )

    const mirroredEnemies = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SPARK_SWORDSMAN,
      3,
    )
    const [advancedAllyB] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.OAKBARK_SENTINEL,
    )
    const [summonCardB] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
    )
    manager = configureManager(initial, {
      board: [
        { cardId: advancedAllyB },
        { cardId: mirroredEnemies[0] },
        { cardId: mirroredEnemies[1] },
        { cardId: mirroredEnemies[2] },
      ],
      activePlayerId: 'playerB',
      mana: { playerB: 2 },
      handAdditions: [summonCardB],
    })

    expect(GameManager.getSummonOptions(manager, summonCardB)[2]).toMatchObject({
      requiredMarch: 2,
      canReach: false,
    })
    expect(GameManager.getSummonOptions(manager, summonCardB)[1]).toMatchObject({
      requiredMarch: 0,
      canReach: true,
    })
    expect(GameManager.getSummonOptions(manager, summonCardB)[0]).toMatchObject({
      requiredMarch: 0,
      canReach: true,
    })
  })

  it('adds each capture value to crossed march distance for both player directions', () => {
    const initial = createTestManager()
    const [captureB] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.FOREST_CAGE_BEASTMASTER,
    )
    const [summonA] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SPARK_SWORDSMAN,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: captureB }],
      mana: { playerA: 2 },
    })
    expect(GameManager.getSummonOptions(manager, summonA)[1]).toMatchObject({
      requiredMarch: 3,
      canReach: false,
    })

    const [captureA] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.VINE_SNARE_HUNTER,
    )
    const [summonB] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
    )
    manager = configureManager(initial, {
      board: [{ cardId: captureA }],
      activePlayerId: 'playerB',
      mana: { playerB: 2 },
      handAdditions: [summonB],
    })
    expect(GameManager.getSummonOptions(manager, summonB)[0]).toMatchObject({
      requiredMarch: 2,
      canReach: false,
    })
  })

  it('uses bridgehead discounted cost for playability and mana payment', () => {
    const initial = createTestManager()
    const [enemy] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
    )
    const [beachhead] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.TIDEFRONT_FORTIFIER,
    )
    const [summonCard] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SPARK_SWORDSMAN,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: enemy }, { cardId: beachhead }],
      mana: { playerA: 1 },
    })
    expect(manager.state.cards[beachhead].card).toMatchObject({
      name: '偵察者',
      attack: 2,
      defense: 2,
      march: 2,
    })

    expect(GameManager.getSummonOptions(manager, summonCard)[2]).toMatchObject({
      effectiveCost: 1,
      canReach: true,
      affordable: true,
      canSummon: true,
    })
    expect(GameManager.isCardPlayable(manager, summonCard)).toBe(true)

    manager = GameManager.summonCreature(manager, summonCard, 2)
    expect(manager.state.players.playerA.mana).toBe(0)
    expect(manager.state.players.playerA.hand).not.toContain(summonCard)
    expect(manager.state.board.creatures.at(-1)?.cardId).toBe(summonCard)
  })
})

describe('keep-up mana abilities', () => {
  it('uses only the highest mining value in one surrounded group', () => {
    const initial = createTestManager()
    const [enemyLeft, enemyRight] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SPARK_SWORDSMAN,
      2,
    )
    const [minerA, minerB] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.GEODE_MINER,
      2,
    )
    let manager = configureManager(initial, {
      board: [
        { cardId: enemyLeft },
        { cardId: minerA },
        { cardId: minerB },
        { cardId: enemyRight },
      ],
      phase: 'keepUp',
      mana: { playerA: 0 },
    })

    manager = GameManager.resolveKeepUp(manager)
    expect(manager.state.players.playerA.mana).toBe(3)
  })

})

describe('combat abilities', () => {
  it('gains plunder mana when its group damages the enemy player', () => {
    const initial = createExpansionTestManager()
    const [attacker] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SPARK_SWORDSMAN,
    )
    const [thief] = findCardIds(initial.state, 'playerA', CARD_ID.THIEF)
    let manager = configureManager(initial, {
      board: [{ cardId: attacker }, { cardId: thief }],
      mana: { playerA: 0 },
    })

    manager = GameManager.attackGroup(manager, 0, 1)
    expect(manager.state.pendingCombat).toMatchObject({
      playerDamage: 3,
      attackerManaGain: 2,
    })
    manager = GameManager.finishCombat(manager)
    expect(manager.state.players.playerA.mana).toBe(2)
  })

  it('resolves counterattack simultaneously against the attacking front creature', () => {
    const initial = createTestManager()
    const [attackingRear, attackingFront] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.SPARK_SWORDSMAN,
      2,
    )
    const [counter] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.SURGING_DUELIST,
    )
    let manager = configureManager(initial, {
      board: [
        { cardId: attackingRear },
        { cardId: attackingFront },
        { cardId: counter },
      ],
      mana: { playerA: 0, playerB: 0 },
    })

    manager = GameManager.attackGroup(manager, 0, 1)
    expect(manager.state.pendingCombat?.damageMarkers).toEqual([
      { cardId: counter, damage: 6 },
      { cardId: attackingFront, damage: 3 },
    ])
    expect(new Set(manager.state.pendingCombat?.destroyedCardIds)).toEqual(
      new Set([attackingFront, counter]),
    )
    expect(GameManager.getDestructionManaRefund(manager, attackingFront)).toBe(
      Math.floor(manager.state.cards[attackingFront].card.cost / 2),
    )
    expect(GameManager.getDestructionManaRefund(manager, counter)).toBe(
      Math.floor(manager.state.cards[counter].card.cost / 2),
    )

    manager = GameManager.finishCombat(manager)
    expect(manager.state.players.playerA.discard).toContain(attackingFront)
    expect(manager.state.players.playerA.discard).not.toContain(attackingRear)
    expect(manager.state.players.playerB.discard).toContain(counter)
    expect(manager.state.players.playerA.mana).toBe(1)
    expect(manager.state.players.playerB.mana).toBe(3)
  })

  it('does not refund mana for a creature with vanish', () => {
    const initial = createTestManager()
    const [attacker] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.EXHAUSTED_VOLCANO_DRAGON,
    )
    const [vanishingDefender] = findCardIds(
      initial.state,
      'playerB',
      CARD_ID.EPHEMERAL_DEEP_WHALE,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: attacker }, { cardId: vanishingDefender }],
      mana: { playerA: 0, playerB: 0 },
    })

    expect(GameManager.getDestructionManaRefund(manager, vanishingDefender)).toBe(0)
    manager = GameManager.attackGroup(manager, 0, 0)
    manager = GameManager.finishCombat(manager)
    expect(manager.state.players.playerB.discard).toContain(vanishingDefender)
    expect(manager.state.players.playerB.mana).toBe(2)
  })
})

describe('activated abilities', () => {
  it('withdraws to discard and refunds full printed cost', () => {
    const initial = createTestManager()
    const [source] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.FORMATION_CLEARING_MERCENARY,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: source }],
      mana: { playerA: 0 },
    })
    expect(GameManager.getActivatedAbilities(manager)).toContainEqual(
      expect.objectContaining({
        sourceCardId: source,
        abilityType: 'withdraw',
        enabled: true,
      }),
    )

    manager = GameManager.applyAction(manager, {
      type: 'activateAbility',
      sourceCardId: source,
      abilityType: 'withdraw',
    })
    expect(manager.state.board.creatures).toHaveLength(0)
    expect(manager.state.players.playerA.discard).toContain(source)
    expect(manager.state.players.playerA.mana).toBe(2)
  })

  it.each(['playerA', 'playerB'] as const)(
    'rallies each affected card across enemies to the foremost friendly group for %s',
    (ownerId) => {
      for (const definitionId of [CARD_ID.MIST_RETURNING_MESSENGER, CARD_ID.WAVE_RETURN_MAGE, CARD_ID.MAGICIAN]) {
        const initial = withHandSize(createExpansionTestManager(), ownerId, 0)
        const enemyId = ownerId === 'playerA' ? 'playerB' : 'playerA'
        const [source] = findCardIds(initial.state, ownerId, definitionId)
        const [middle, front] = findCardIds(initial.state, ownerId, CARD_ID.TIDEWAY_SCOUT, 2)
        const [enemy1, enemy2] = findCardIds(initial.state, enemyId, CARD_ID.TIDEWAY_SCOUT, 2)
        const ids = [source, enemy1, middle, enemy2, front]
        if (ownerId === 'playerB') ids.reverse()
        const manager = configureManager(initial, {
          board: ids.map((cardId) => ({ cardId, summonedTurn: 10 })),
          handAdditions: initial.state.players[ownerId].deck.filter((id) => !ids.includes(id)).slice(0, 5),
          activePlayerId: ownerId,
          mana: { [ownerId]: 0 },
        })
        expect(manager.state.players[ownerId].hand).toHaveLength(5)
        const action = { type: 'activateAbility', sourceCardId: source, abilityType: 'rally' } as const
        expect(GameManager.getLegalMainActions(manager)).toContainEqual(action)
        const next = GameManager.applyAction(manager, action)
        const expected = [enemy1, middle, enemy2, source, front]
        if (ownerId === 'playerB') expected.reverse()
        expect(next.state.board.creatures.map(({ cardId }) => cardId)).toEqual(expected)
        expect(next.state.board.creatures.find(({ cardId }) => cardId === source)?.summonedTurn).toBe(10)
        expect(next.state.players).toEqual(manager.state.players)
        expect(next.state.cards).toEqual(manager.state.cards)
        expect(manager.state.board.creatures.map(({ cardId }) => cardId)).toEqual(ids)
        expect(GameManager.getLegalMainActions(next)).not.toContainEqual(action)
        expect(() => assertValidGameState(next.state)).not.toThrow()
      }
    },
  )

  it.each(['playerA', 'playerB'] as const)('can move within its foremost group for %s', (ownerId) => {
    const initial = createTestManager()
    const [source] = findCardIds(initial.state, ownerId, CARD_ID.MIST_RETURNING_MESSENGER)
    const [rear, middle] = findCardIds(initial.state, ownerId, CARD_ID.TIDEWAY_SCOUT, 2)
    for (const ids of [[rear, middle, source], [rear, source, middle]]) {
      const board = ownerId === 'playerA' ? ids : ids.toReversed()
      const manager = configureManager(initial, {
        board: board.map((cardId) => ({ cardId })), activePlayerId: ownerId,
      })
      const next = GameManager.activateAbility(manager, source, 'rally')
      const expected = [source, rear, middle]
      expect(next.state.board.creatures.map(({ cardId }) => cardId))
        .toEqual(ownerId === 'playerA' ? expected : expected.toReversed())
    }
  })

  it.each(['playerA', 'playerB'] as const)('does not move a foremost singleton backward for %s', (ownerId) => {
    const initial = createTestManager()
    const [source] = findCardIds(initial.state, ownerId, CARD_ID.MIST_RETURNING_MESSENGER)
    const [rear] = findCardIds(initial.state, ownerId, CARD_ID.TIDEWAY_SCOUT)
    const [enemy] = findCardIds(initial.state, ownerId === 'playerA' ? 'playerB' : 'playerA', CARD_ID.TIDEWAY_SCOUT)
    for (const ids of [[source], [rear, enemy, source], [source, rear]]) {
      const board = ownerId === 'playerA' ? ids : ids.toReversed()
      const manager = configureManager(initial, {
        board: board.map((cardId) => ({ cardId })), activePlayerId: ownerId,
      })
      expect(() => GameManager.activateAbility(manager, source, 'rally')).toThrow(/すでに/)
    }
  })

  it('rejects rally outside its controller main phase and during pending combat', () => {
    const initial = createTestManager()
    const [source, front] = findCardIds(initial.state, 'playerA', CARD_ID.MIST_RETURNING_MESSENGER, 2)
    const manager = configureManager(initial, { board: [{ cardId: front }, { cardId: source }] })
    for (const state of [
      { ...manager.state, phase: 'battle' as const },
      { ...manager.state, activePlayerId: 'playerB' as const },
      GameManager.attackGroup(manager, 0, 1).state,
    ]) {
      expect(() => GameManager.activateAbility(GameManager.from(state), source, 'rally')).toThrow(/メインフェイズ/)
    }
  })

  it('lets humans rally again after another creature changes the group order', () => {
    const initial = createTestManager()
    const [source, other] = findCardIds(initial.state, 'playerA', CARD_ID.MIST_RETURNING_MESSENGER, 2)
    let manager = configureManager(initial, { board: [{ cardId: other }, { cardId: source }] })
    manager = GameManager.activateAbility(manager, source, 'rally')
    manager = GameManager.activateAbility(manager, other, 'rally')
    manager = GameManager.activateAbility(manager, source, 'rally')
    expect(manager.state.board.creatures.map(({ cardId }) => cardId)).toEqual([source, other])
  })

  it.each(['playerA', 'playerB'] as const)('lets the AI rally into a winning attack for %s', (ownerId) => {
    const initial = withHandSize(createTestManager(), ownerId, 0)
    const enemyId = ownerId === 'playerA' ? 'playerB' : 'playerA'
    const [source] = findCardIds(initial.state, ownerId, CARD_ID.MIST_RETURNING_MESSENGER)
    const [front] = findCardIds(initial.state, ownerId, CARD_ID.TIDEWAY_SCOUT)
    const [blocker] = findCardIds(initial.state, enemyId, CARD_ID.GREAT_TREE_GUARDIAN)
    const ids = [source, blocker, front]
    if (ownerId === 'playerB') ids.reverse()
    const manager = configureManager(initial, {
      board: ids.map((cardId) => ({ cardId })),
      activePlayerId: ownerId, mana: { [ownerId]: 0 }, hp: { [enemyId]: 1 },
    })
    const originalState = structuredClone(manager.state)
    const action = new GameAI().chooseAction(manager)
    expect(action).toEqual({ type: 'activateAbility', sourceCardId: source, abilityType: 'rally' })
    const moved = GameManager.applyAction(manager, action!)
    const group = GameManager.getBoardGroups(moved).find((candidate) => candidate.ownerId === ownerId)!
    const won = GameManager.finishCombat(GameManager.attackGroup(moved, group.startIndex, group.endIndex))
    expect(GameManager.getWinner(won)).toBe(ownerId)
    expect(manager.state).toEqual(originalState)
  })

})

describe('end-turn abilities', () => {
  it('pays installment mana or destroys the creature without a refund', () => {
    const initial = createExpansionTestManager()
    const [mephistopheles] = findCardIds(
      initial.state,
      'playerA',
      CARD_ID.MEPHISTOPHELES,
    )
    let manager = configureManager(initial, {
      board: [{ cardId: mephistopheles }],
      phase: 'cleanup',
      mana: { playerA: 2 },
    })
    expect(
      GameManager.getEndTurnInstallmentResolution(manager, 'playerA'),
    ).toEqual({ mana: 0, destroyedCardIds: [] })
    manager = GameManager.passPhase(manager)
    expect(manager.state.board.creatures).toContainEqual(
      expect.objectContaining({ cardId: mephistopheles }),
    )
    expect(manager.state.players.playerA.mana).toBe(0)

    manager = configureManager(initial, {
      board: [{ cardId: mephistopheles }],
      phase: 'cleanup',
      mana: { playerA: 1 },
    })
    expect(
      GameManager.getEndTurnInstallmentResolution(manager, 'playerA'),
    ).toEqual({ mana: 1, destroyedCardIds: [mephistopheles] })
    manager = GameManager.passPhase(manager)
    expect(manager.state.board.creatures).toHaveLength(0)
    expect(manager.state.players.playerA.discard).toContain(mephistopheles)
    expect(manager.state.players.playerA.mana).toBe(1)
  })
})
