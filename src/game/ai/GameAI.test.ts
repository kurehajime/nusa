import { describe, expect, it } from 'vitest'
import { CARD_DEFINITION_IDS, CARD_BY_DEFINITION_ID } from '../cards'
import { GameManager } from '../GameManager'
import { THEME_DECK_BY_ID, THEME_DECK_IDS } from '../themeDecks'
import type { CardInstanceId, GameState, PlayerId } from '../types'
import {
  AI_DIFFICULTY_IGNORED_HAND_COUNT,
  AiTurnActionMemory,
  GameAI,
} from './GameAI'
import {
  AI_EVALUATION_PARAMETERS,
  evaluateBase,
  evaluateBattleEntry,
  evaluateCoherentMainPlan,
  getDeployableHandValue,
  getPlunderFutureDeployableHandValue,
} from './evaluation'
import {
  AI_SCORE_EPSILON,
  areScoresEquivalent,
  isMeaningfullyGreater,
  isMeaningfullyLess,
} from './scoreComparison'

const KEEP_ORDER_RANDOM = () => 1 - Number.EPSILON
const CARD_ID = CARD_DEFINITION_IDS

const createTestManager = (): GameManager => GameManager.create(KEEP_ORDER_RANDOM)

const withState = (
  manager: GameManager,
  update: (state: GameState) => GameState,
): GameManager => GameManager.from(update(manager.state))

const findCardId = (
  state: GameState,
  ownerId: PlayerId,
  definitionId: string,
): CardInstanceId => {
  const instance = Object.values(state.cards).find(
    (candidate) =>
      candidate.ownerId === ownerId &&
      candidate.card.definitionId === definitionId,
  )
  if (!instance) {
    throw new Error(`Expected ${definitionId} for ${ownerId}.`)
  }
  return instance.id
}

const createDeferredAttackDecisionManager = (): GameManager => {
  const initial = createTestManager()
  const assassin = findCardId(
    initial.state,
    'playerA',
    CARD_ID.CRIMSON_BLADE_INFILTRATOR,
  )
  const capturer = findCardId(
    initial.state,
    'playerB',
    CARD_ID.VINE_SNARE_HUNTER,
  )
  const boardCardIds = new Set([assassin, capturer])
  const preparePlayer = (playerId: PlayerId) => {
    const player = initial.state.players[playerId]
    return {
      ...player,
      hp: playerId === 'playerA' ? 20 : 18,
      mana: playerId === 'playerA' ? 0 : 1,
      deck: player.deck.filter((cardId) => !boardCardIds.has(cardId)),
      hand: player.hand.filter((cardId) => !boardCardIds.has(cardId)),
      discard: player.discard.filter((cardId) => !boardCardIds.has(cardId)),
      exile: player.exile.filter((cardId) => !boardCardIds.has(cardId)),
    }
  }

  return GameManager.from({
    ...initial.state,
    turn: 2,
    phase: 'battle',
    activePlayerId: 'playerB',
    hasAttackedThisTurn: false,
    hasDiscardedThisTurn: false,
    pendingCombat: null,
    players: {
      playerA: preparePlayer('playerA'),
      playerB: preparePlayer('playerB'),
    },
    board: {
      creatures: [assassin, capturer].map((cardId) => ({
        cardId,
        summonedTurn: 1,
      })),
    },
  })
}

const createMiningDilemmaManager = (): GameManager => {
  const manager = createTestManager()
  const playerAttacker = findCardId(
    manager.state,
    'playerB',
    CARD_ID.BEACON_HEAVY_CAVALRY,
  )
  const miner = findCardId(
    manager.state,
    'playerA',
    CARD_ID.GEODE_MINER,
  )
  const minerAttacker = findCardId(
    manager.state,
    'playerB',
    CARD_ID.SPARK_SWORDSMAN,
  )
  const boardCardIds = new Set([playerAttacker, miner, minerAttacker])
  const preparePlayer = (playerId: PlayerId) => {
    const player = manager.state.players[playerId]
    return {
      ...player,
      deck: player.deck.filter((cardId) => !boardCardIds.has(cardId)),
      hand: player.hand.filter((cardId) => !boardCardIds.has(cardId)),
      discard: player.discard.filter((cardId) => !boardCardIds.has(cardId)),
    }
  }

  return GameManager.from({
    ...manager.state,
    turn: 10,
    phase: 'battle',
    activePlayerId: 'playerA',
    hasAttackedThisTurn: false,
    pendingCombat: null,
    players: {
      playerA: preparePlayer('playerA'),
      playerB: preparePlayer('playerB'),
    },
    board: {
      creatures: [playerAttacker, miner, minerAttacker].map((cardId) => ({
        cardId,
        summonedTurn: 9,
      })),
    },
  })
}

const createDuplicateLethalDefenseManager = (): {
  manager: GameManager
  defenderIds: [CardInstanceId, CardInstanceId]
} => {
  const initial = createTestManager()
  const attackerId = findCardId(
    initial.state,
    'playerB',
    CARD_ID.EXHAUSTED_VOLCANO_DRAGON,
  )
  const defenderIds = Object.values(initial.state.cards)
    .filter(
      ({ ownerId, card }) =>
        ownerId === 'playerA' &&
        card.definitionId === CARD_ID.ROOTED_ANCIENT,
    )
    .map(({ id }) => id)
  if (defenderIds.length < 2) {
    throw new Error('Expected two defenders for the terminal-swing test.')
  }
  const selectedDefenders = defenderIds.slice(0, 2) as [
    CardInstanceId,
    CardInstanceId,
  ]
  const movedCardIds = new Set([attackerId, ...selectedDefenders])
  const deckFor = (playerId: PlayerId) =>
    Object.values(initial.state.cards)
      .filter(
        ({ id, ownerId }) => ownerId === playerId && !movedCardIds.has(id),
      )
      .map(({ id }) => id)

  return {
    manager: GameManager.from({
      ...initial.state,
      turn: 10,
      phase: 'main',
      activePlayerId: 'playerA',
      hasAttackedThisTurn: false,
      hasDiscardedThisTurn: false,
      pendingCombat: null,
      players: {
        playerA: {
          ...initial.state.players.playerA,
          hp: 2,
          mana: 4,
          deck: deckFor('playerA'),
          hand: selectedDefenders,
          discard: [],
          exile: [],
          placedSpell: null,
        },
        playerB: {
          ...initial.state.players.playerB,
          mana: 0,
          deck: deckFor('playerB'),
          hand: [],
          discard: [],
          exile: [],
          placedSpell: null,
        },
      },
      board: {
        creatures: [{ cardId: attackerId, summonedTurn: 9 }],
      },
    }),
    defenderIds: selectedDefenders,
  }
}

const createReturnFireDecisionManager = (
  adjacentGroupOwnerId: PlayerId,
): { manager: GameManager; returnFire: CardInstanceId } => {
  const initial = createTestManager()
  const returnFire = findCardId(
    initial.state,
    'playerA',
    CARD_ID.RETURN_FIRE,
  )
  const adjacentCreature = findCardId(
    initial.state,
    adjacentGroupOwnerId,
    CARD_ID.EXHAUSTED_VOLCANO_DRAGON,
  )
  const redDiscards = Object.values(initial.state.cards)
    .filter(
      ({ id, ownerId, card }) =>
        id !== adjacentCreature &&
        ownerId === 'playerA' &&
        card.kind === 'creature' &&
        card.color === 'red',
    )
    .slice(0, 4)
    .map(({ id }) => id)
  const movedCardIds = new Set([
    returnFire,
    adjacentCreature,
    ...redDiscards,
  ])
  const preparePlayer = (playerId: PlayerId) => ({
    ...initial.state.players[playerId],
    deck: Object.values(initial.state.cards)
      .filter(
        ({ id, ownerId }) =>
          ownerId === playerId && !movedCardIds.has(id),
      )
      .map(({ id }) => id),
    hand: playerId === 'playerA' ? [returnFire] : [],
    discard: playerId === 'playerA' ? redDiscards : [],
    exile: [],
    placedSpell: null,
  })

  return {
    returnFire,
    manager: GameManager.from({
      ...initial.state,
      turn: 10,
      activePlayerId: 'playerA',
      phase: 'main',
      hasAttackedThisTurn: false,
      hasDiscardedThisTurn: false,
      pendingCombat: null,
      players: {
        playerA: preparePlayer('playerA'),
        playerB: preparePlayer('playerB'),
      },
      board: {
        creatures: [{ cardId: adjacentCreature, summonedTurn: 9 }],
      },
    }),
  }
}

describe('GameManager AI rule APIs', () => {
  it('only enumerates main actions that can be applied', () => {
    const manager = createTestManager()
    const actions = GameManager.getLegalActions(manager)

    expect(actions.length).toBeGreaterThan(1)
    expect(actions.at(-1)).toEqual({ type: 'passPhase' })
    actions.forEach((action) => {
      expect(() => GameManager.applyAction(manager, action)).not.toThrow()
    })
  })

  it('previews combat without advancing the turn or mutating the source state', () => {
    const manager = createTestManager()
    const cardId = manager.state.players.playerA.hand[0]
    const summoned = GameManager.summonCreature(manager, cardId, 0)
    const preview = GameManager.previewCombat(summoned, 0, 0)

    expect(preview.attackerId).toBe('playerA')
    expect(preview.playerDamage).toBe(1)
    expect(preview.attackerManaGain).toBe(0)
    expect(preview.nextState.turn).toBe(summoned.state.turn)
    expect(preview.nextState.activePlayerId).toBe('playerA')
    expect(preview.nextState.players.playerB.hp).toBe(19)
    expect(preview.nextState.pendingCombat).toBeNull()
    expect(summoned.state.players.playerB.hp).toBe(20)
    expect(summoned.state.pendingCombat).toBeNull()
  })

  it('stops combat resolution immediately when a player wins', () => {
    const manager = createTestManager()
    const cardId = manager.state.players.playerA.hand[0]
    const summoned = GameManager.summonCreature(manager, cardId, 0)
    const lethalState = withState(summoned, (state) => ({
      ...state,
      phase: 'battle',
      players: {
        ...state.players,
        playerB: { ...state.players.playerB, hp: 1 },
      },
    }))
    const resolved = GameManager.finishCombat(
      GameManager.attackGroup(lethalState, 0, 0),
    )

    expect(GameManager.getWinner(resolved)).toBe('playerA')
    expect(resolved.state.turn).toBe(lethalState.state.turn)
    expect(resolved.state.activePlayerId).toBe('playerA')
    expect(resolved.state.players.playerB.hp).toBe(0)
    expect(GameManager.getLegalActions(resolved)).toEqual([])
  })
})

describe('AI evaluation', () => {
  it('treats floating-point noise as an equal score', () => {
    const first = -19.3
    const second = -19.299999999999272

    expect(Math.abs(first - second)).toBeLessThan(AI_SCORE_EPSILON)
    expect(areScoresEquivalent(first, second)).toBe(true)
    expect(isMeaningfullyGreater(second, first)).toBe(false)
    expect(isMeaningfullyLess(first, second)).toBe(false)
    expect(isMeaningfullyGreater(first + 0.1, first)).toBe(true)
    expect(isMeaningfullyLess(first - 0.1, first)).toBe(true)
  })

  it('uses asymmetric terminal scores and zeros the other components', () => {
    const manager = createTestManager()
    const won = withState(manager, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerB: { ...state.players.playerB, hp: 0 },
      },
    }))
    const lost = withState(manager, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerA: { ...state.players.playerA, hp: 0 },
      },
    }))

    expect(evaluateBase(won, 'playerA')).toEqual({
      terminal: AI_EVALUATION_PARAMETERS.victory,
      hp: 0,
      mana: 0,
      boardMaterial: 0,
      handReserve: 0,
      deployableHand: 0,
      upkeepMana: 0,
      upkeepDamage: 0,
      marchControl: 0,
      myAttackPotential: 0,
      opponentAttackThreat: 0,
      total: AI_EVALUATION_PARAMETERS.victory,
    })
    expect(evaluateBase(lost, 'playerA').total).toBe(
      AI_EVALUATION_PARAMETERS.defeat,
    )
    expect(Math.abs(AI_EVALUATION_PARAMETERS.victory)).toBeGreaterThan(
      Math.abs(AI_EVALUATION_PARAMETERS.defeat),
    )
  })

  it('values AI creatures by printed cost and keeps a higher base spell reserve', () => {
    const manager = createTestManager()
    expect(AI_EVALUATION_PARAMETERS.creatureHandReserve).toBe(0.3)
    expect(AI_EVALUATION_PARAMETERS.spellHandReserve).toBe(2)
    expect(AI_EVALUATION_PARAMETERS.lifeDropletHoldMultiplier).toBe(0.5)
    const expectedReserve = manager.state.players.playerA.hand.reduce(
      (total, cardId) => {
        const card = manager.state.cards[cardId].card
        return (
          total +
          (card.kind === 'spell'
            ? AI_EVALUATION_PARAMETERS.spellHandReserve
            : card.cost * AI_EVALUATION_PARAMETERS.creatureHandReserve)
        )
      },
      0,
    )
    const opponentWithHand = withState(manager, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerB: {
          ...state.players.playerB,
          hand: state.players.playerB.deck.slice(0, 5),
          deck: state.players.playerB.deck.slice(5),
        },
      },
    }))

    expect(evaluateBase(manager, 'playerA').handReserve).toBeCloseTo(expectedReserve)
    expect(evaluateBase(opponentWithHand, 'playerA').handReserve).toBeCloseTo(
      expectedReserve,
    )

    const returnFire = findCardId(
      manager.state,
      'playerA',
      CARD_ID.RETURN_FIRE,
    )
    const playerACardIds = Object.values(manager.state.cards)
      .filter(({ ownerId }) => ownerId === 'playerA')
      .map(({ id }) => id)
    const spellOnlyHand = withState(manager, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerA: {
          ...state.players.playerA,
          deck: playerACardIds.filter((cardId) => cardId !== returnFire),
          hand: [returnFire],
          discard: [],
          exile: [],
          placedSpell: null,
        },
      },
    }))

    expect(evaluateBase(spellOnlyHand, 'playerA').handReserve).toBeCloseTo(
      AI_EVALUATION_PARAMETERS.spellHandReserve,
    )
  })

  it('adds life droplet hold value once for its accumulated blue discards', () => {
    const deck = [
      ...THEME_DECK_BY_ID[THEME_DECK_IDS.BLUE_GREEN_INTERCEPT].cardDefinitionIds,
    ]
    const transferIndex = deck.indexOf(CARD_ID.TRANSFER)
    deck[transferIndex] = CARD_ID.LIFE_DROPLET
    const initial = GameManager.create(KEEP_ORDER_RANDOM, {
      playerA: deck,
      playerB: deck,
    })
    const ownedCards = Object.values(initial.state.cards).filter(
      ({ ownerId }) => ownerId === 'playerA',
    )
    const lifeDroplets = ownedCards
      .filter(({ card }) => card.definitionId === CARD_ID.LIFE_DROPLET)
      .slice(0, 2)
      .map(({ id }) => id)
    const blueDiscards = ownedCards
      .filter(
        ({ card }) => card.kind === 'creature' && card.color === 'blue',
      )
      .slice(0, 2)
      .map(({ id }) => id)
    const movedCardIds = new Set([...lifeDroplets, ...blueDiscards])
    const manager = withState(initial, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerA: {
          ...state.players.playerA,
          deck: ownedCards
            .filter(({ id }) => !movedCardIds.has(id))
            .map(({ id }) => id),
          hand: lifeDroplets,
          discard: blueDiscards,
          exile: [],
          placedSpell: null,
        },
      },
    }))
    const baseSpellReserve =
      lifeDroplets.length * AI_EVALUATION_PARAMETERS.spellHandReserve
    const holdValue =
      blueDiscards.length *
      AI_EVALUATION_PARAMETERS.hp *
      AI_EVALUATION_PARAMETERS.lifeDropletHoldMultiplier

    expect(evaluateBase(manager, 'playerA').handReserve).toBe(
      baseSpellReserve + holdValue,
    )
    expect(
      evaluateBase(manager, 'playerA', new Set([lifeDroplets[0]])).handReserve,
    ).toBe(AI_EVALUATION_PARAMETERS.spellHandReserve + holdValue)
    expect(
      evaluateBase(manager, 'playerA', new Set(lifeDroplets)).handReserve,
    ).toBe(0)
  })

  it('does not value mana that abundance removes at turn end', () => {
    const initial = createTestManager()
    const abundance = findCardId(
      initial.state,
      'playerA',
      CARD_ID.ABUNDANCE,
    )
    const withAbundance = withState(initial, (state) => {
      const player = state.players.playerA
      return {
        ...state,
        players: {
          ...state.players,
          playerA: {
            ...player,
            mana: 4,
            deck: player.deck.filter((cardId) => cardId !== abundance),
            hand: player.hand.filter((cardId) => cardId !== abundance),
            discard: player.discard.filter((cardId) => cardId !== abundance),
            exile: player.exile.filter((cardId) => cardId !== abundance),
            placedSpell: { cardId: abundance, effectAmount: 2 },
          },
          playerB: {
            ...state.players.playerB,
            mana: 0,
          },
        },
      }
    })
    const withoutAbundance = withState(withAbundance, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerA: {
          ...state.players.playerA,
          discard: [...state.players.playerA.discard, abundance],
          placedSpell: null,
        },
      },
    }))

    expect(evaluateBase(withAbundance, 'playerA').mana).toBe(0)
    expect(evaluateBase(withoutAbundance, 'playerA').mana).toBe(4)
  })

  it('excludes ignored cards from hand reserve and deployable hand value', () => {
    const manager = createTestManager()
    const hand = manager.state.players.playerA.hand
    const ignoredHandCardIds = new Set(hand)

    expect(
      evaluateBase(manager, 'playerA', ignoredHandCardIds).handReserve,
    ).toBe(0)
    expect(
      getDeployableHandValue(manager, 'playerA', ignoredHandCardIds),
    ).toBe(0)
  })

  it('counts a shared lethal-defense swing only once in deployable hand value', () => {
    const { manager, defenderIds } = createDuplicateLethalDefenseManager()
    const oneDefender = withState(manager, (state) => ({
      ...state,
      players: {
        ...state.players,
        playerA: {
          ...state.players.playerA,
          hand: [defenderIds[0]],
          deck: [...state.players.playerA.deck, defenderIds[1]],
        },
      },
    }))

    expect(evaluateBattleEntry(manager, 'playerA').opponentAttackThreat).toBeGreaterThan(
      Math.abs(AI_EVALUATION_PARAMETERS.defeat) * 0.9,
    )
    expect(
      getDeployableHandValue(manager, 'playerA') -
        getDeployableHandValue(oneDefender, 'playerA'),
    ).toBeCloseTo(
      2 * AI_EVALUATION_PARAMETERS.creatureHandReserve,
    )
  })

  it('evaluates a multi-summon continuation through actual state transitions', () => {
    const { manager } = createDuplicateLethalDefenseManager()
    const passScore = evaluateBattleEntry(manager, 'playerA').total
    const firstAction = new GameAI().chooseAction(manager)

    expect(firstAction?.type).toBe('summonCreature')
    expect(evaluateCoherentMainPlan(manager, 'playerA').total).toBeGreaterThan(passScore)
  })

  it('keeps the total equal to the sum of its components', () => {
    const evaluation = GameAI.evaluate(createTestManager(), 'playerA')
    const { total, ...components } = evaluation

    expect(total).toBeCloseTo(
      Object.values(components).reduce((sum, value) => sum + value, 0),
    )
  })

  it('discounts its attack potential after passing the turn', () => {
    const battle = createDeferredAttackDecisionManager()
    const nextMain = GameManager.passPhase(GameManager.passPhase(battle))
    const attackPotential = evaluateBattleEntry(nextMain, 'playerB').myAttackPotential

    expect(nextMain.state.activePlayerId).toBe('playerA')
    expect(AI_EVALUATION_PARAMETERS.futureAttackPotentialMultiplier).toBe(0.75)
    expect(attackPotential).toBeCloseTo(0.75)
  })

  it('predicts the attack that benefits the opponent most even when mining survives', () => {
    const manager = createMiningDilemmaManager()
    const opponentBattle = withState(manager, (state) => ({
      ...state,
      activePlayerId: 'playerB',
    }))
    const playerAttack = GameManager.previewCombat(opponentBattle, 0, 0)
    const miningAttack = GameManager.previewCombat(opponentBattle, 2, 2)
    const afterPlayerAttack = GameManager.from(playerAttack.nextState)
    const afterMiningAttack = GameManager.from(miningAttack.nextState)

    expect(evaluateBase(manager, 'playerA').upkeepMana).toBe(1.2)
    expect(playerAttack.playerDamage).toBe(4)
    expect(miningAttack.destroyedCardIds).toHaveLength(1)
    expect(GameManager.getKeepUpManaBonus(afterPlayerAttack, 'playerA')).toBe(1)
    expect(GameManager.getKeepUpManaBonus(afterMiningAttack, 'playerA')).toBe(0)
    expect(evaluateBase(afterPlayerAttack, 'playerB').total).toBeGreaterThan(
      evaluateBase(afterMiningAttack, 'playerB').total,
    )

    const baseScore = evaluateBase(manager, 'playerA').total
    const expectedThreat = Math.max(
      baseScore - evaluateBase(afterPlayerAttack, 'playerA').total,
      0,
    )

    expect(evaluateBattleEntry(manager, 'playerA').opponentAttackThreat).toBeCloseTo(
      expectedThreat,
    )
  })

  it('removes an unpaid installment creature before evaluating the opponent attack', () => {
    const initial = GameManager.create(KEEP_ORDER_RANDOM, {
      playerA: [CARD_ID.MEPHISTOPHELES],
      playerB: [CARD_ID.BEACON_HEAVY_CAVALRY],
    })
    const mephistopheles = findCardId(
      initial.state,
      'playerA',
      CARD_ID.MEPHISTOPHELES,
    )
    const attacker = findCardId(
      initial.state,
      'playerB',
      CARD_ID.BEACON_HEAVY_CAVALRY,
    )
    const manager = GameManager.from({
      ...initial.state,
      players: {
        playerA: {
          ...initial.state.players.playerA,
          mana: 0,
          deck: initial.state.players.playerA.deck.filter(
            (cardId) => cardId !== mephistopheles,
          ),
          hand: [],
        },
        playerB: {
          ...initial.state.players.playerB,
          mana: 0,
          deck: initial.state.players.playerB.deck.filter(
            (cardId) => cardId !== attacker,
          ),
          hand: initial.state.players.playerB.hand.filter(
            (cardId) => cardId !== attacker,
          ),
        },
      },
      board: {
        creatures: [mephistopheles, attacker].map((cardId) => ({
          cardId,
          summonedTurn: 0,
        })),
      },
    })

    expect(
      GameManager.getEndTurnInstallmentResolution(manager, 'playerA')
        .destroyedCardIds,
    ).toEqual([mephistopheles])
    // Catapult's 6 attack deals 4 damage past the shield after the unpaid creature leaves.
    expect(evaluateBattleEntry(manager, 'playerA').opponentAttackThreat).toBe(17)
  })

  it('removes an unpaid installment creature even when the opponent cannot attack', () => {
    const initial = GameManager.create(KEEP_ORDER_RANDOM, {
      playerA: [CARD_ID.MEPHISTOPHELES],
      playerB: [CARD_ID.BEACON_HEAVY_CAVALRY],
    })
    const mephistopheles = findCardId(
      initial.state,
      'playerA',
      CARD_ID.MEPHISTOPHELES,
    )
    const manager = GameManager.from({
      ...initial.state,
      cards: {
        ...initial.state.cards,
        [mephistopheles]: {
          ...initial.state.cards[mephistopheles],
          card: {
            ...initial.state.cards[mephistopheles].card,
            cost: 2,
          },
        },
      },
      players: {
        ...initial.state.players,
        playerA: {
          ...initial.state.players.playerA,
          mana: 0,
          deck: initial.state.players.playerA.deck.filter(
            (cardId) => cardId !== mephistopheles,
          ),
          hand: [],
        },
      },
      board: {
        creatures: [{ cardId: mephistopheles, summonedTurn: 0 }],
      },
    })

    expect(evaluateBattleEntry(manager, 'playerA').opponentAttackThreat).toBe(
      manager.state.cards[mephistopheles].card.cost *
        AI_EVALUATION_PARAMETERS.boardMaterial,
    )
  })

  it('values only the hand cost newly enabled by plunder mana', () => {
    const initial = createTestManager()
    const costFourCard = findCardId(
      initial.state,
      'playerA',
      CARD_ID.BEACON_HEAVY_CAVALRY,
    )
    const player = initial.state.players.playerA
    const manager = GameManager.from({
      ...initial.state,
      players: {
        ...initial.state.players,
        playerA: {
          ...player,
          mana: 2,
          deck: [
            ...player.deck.filter((cardId) => cardId !== costFourCard),
            ...player.hand.filter((cardId) => cardId !== costFourCard),
          ],
          hand: [costFourCard],
        },
      },
    })

    expect(
      getPlunderFutureDeployableHandValue(manager, 'playerA', 2, 2),
    ).toBeCloseTo(4 * AI_EVALUATION_PARAMETERS.plunderFutureDeployableHand)
    expect(
      getPlunderFutureDeployableHandValue(manager, 'playerA', 0, 2),
    ).toBe(0)
  })
})

describe('GameAI action selection', () => {
  it('uses the configured number of ignored hand cards for each difficulty', () => {
    expect(AI_DIFFICULTY_IGNORED_HAND_COUNT).toEqual({
      easy: 2,
      normal: 1,
      hard: 0,
    })
  })

  it('keeps ignored hand cards fixed for the turn and redraws them next turn', () => {
    const manager = createTestManager()
    const memory = new AiTurnActionMemory()
    let randomCallCount = 0
    const random = () => {
      randomCallCount += 1
      return 0
    }

    const first = memory.getIgnoredHandCardIds(manager, 2, random)
    const repeated = memory.getIgnoredHandCardIds(manager, 2, random)
    expect([...first]).toEqual(manager.state.players.playerA.hand.slice(0, 2))
    expect(repeated).toBe(first)
    expect(randomCallCount).toBe(2)

    const nextTurn = withState(manager, (state) => ({
      ...state,
      turn: state.turn + 1,
    }))
    memory.getIgnoredHandCardIds(nextTurn, 2, random)
    expect(randomCallCount).toBe(4)
  })

  it('cannot play or discard a hand card ignored by the selected difficulty', () => {
    const initial = createTestManager()
    const usefulAction = new GameAI().chooseAction(initial)
    expect(usefulAction?.type).toBe('summonCreature')
    if (usefulAction?.type !== 'summonCreature') {
      throw new Error('Expected the hard AI to find a useful summon.')
    }

    const singleCardHand = withState(initial, (state) => {
      const player = state.players.playerA
      return {
        ...state,
        players: {
          ...state.players,
          playerA: {
            ...player,
            deck: [
              ...player.hand.filter((cardId) => cardId !== usefulAction.cardId),
              ...player.deck,
            ],
            hand: [usefulAction.cardId],
          },
        },
      }
    })

    expect(
      new GameAI({ difficulty: 'easy', random: () => 0 }).chooseAction(
        singleCardHand,
      ),
    ).toEqual({ type: 'passPhase' })
    expect(new GameAI({ difficulty: 'hard' }).chooseAction(singleCardHand)?.type).toBe(
      'summonCreature',
    )
  })

  it('considers each physical card for rally only once per turn', () => {
    const manager = createTestManager()
    const [sourceCardId, otherCardId] = manager.state.players.playerA.hand
    const rallyAction = {
      type: 'activateAbility',
      sourceCardId,
      abilityType: 'rally',
    } as const
    const otherRallyAction = {
      ...rallyAction,
      sourceCardId: otherCardId,
    }
    const memory = new AiTurnActionMemory()

    expect(memory.allows(manager, rallyAction)).toBe(true)
    memory.remember(manager, rallyAction)
    expect(memory.allows(manager, rallyAction)).toBe(false)
    expect(memory.allows(manager, otherRallyAction)).toBe(true)

    const nextTurn = withState(manager, (state) => ({
      ...state,
      turn: state.turn + 1,
      activePlayerId: 'playerB',
    }))
    expect(memory.allows(nextTurn, rallyAction)).toBe(true)
  })

  it('completes a turn using only enumerated legal actions', () => {
    const ai = new GameAI()
    let manager = createTestManager()
    const startingPlayerId = manager.state.activePlayerId

    for (let actionCount = 0; actionCount < 10; actionCount += 1) {
      const action = ai.chooseAction(manager)
      expect(action).not.toBeNull()
      expect(GameManager.getLegalActions(manager)).toContainEqual(action)
      manager = GameManager.applyAction(manager, action!)

      if (manager.state.activePlayerId !== startingPlayerId) {
        break
      }
    }

    expect(manager.state.activePlayerId).not.toBe(startingPlayerId)
    expect(manager.state.phase).toBe('main')
  })

  it('chooses a useful summon during the main phase', () => {
    const action = new GameAI().chooseAction(createTestManager())

    expect(action?.type).toBe('summonCreature')
  })

  it('evaluates return fire after resolving its damage', () => {
    const { manager, returnFire } = createReturnFireDecisionManager('playerB')

    expect(new GameAI().chooseAction(manager)).toEqual({
      type: 'playSpell',
      cardId: returnFire,
    })
  })

  it('does not use return fire when resolving it would destroy its own group', () => {
    const { manager } = createReturnFireDecisionManager('playerA')

    expect(new GameAI().chooseAction(manager)).toEqual({ type: 'passPhase' })
  })

  it('chooses a lethal attack during the battle phase', () => {
    const manager = createTestManager()
    const cardId = manager.state.players.playerA.hand[0]
    const summoned = GameManager.summonCreature(manager, cardId, 0)
    const battle = withState(summoned, (state) => ({
      ...state,
      phase: 'battle',
      players: {
        ...state.players,
        playerB: { ...state.players.playerB, hp: 1 },
      },
    }))

    expect(new GameAI().chooseAction(battle)).toEqual({
      type: 'attackGroup',
      startIndex: 0,
      endIndex: 0,
    })
  })

  it('attacks now instead of valuing the same attack fully after passing', () => {
    expect(new GameAI().chooseAction(createDeferredAttackDecisionManager())).toEqual({
      type: 'attackGroup',
      startIndex: 1,
      endIndex: 1,
    })
  })

  it('passes when no battle attack is available', () => {
    const battle = GameManager.setPhase(createTestManager(), 'battle')

    expect(new GameAI().chooseAction(battle)).toEqual({ type: 'passPhase' })
  })
})

describe('full unplayable hand', () => {
  const createBlockedHand = () => {
    const initial = GameManager.create(KEEP_ORDER_RANDOM, {
      playerA: [CARD_ID.WORLD_SERPENT, CARD_ID.SPARK_SWORDSMAN, CARD_ID.WORLD_SERPENT, CARD_ID.SPARK_SWORDSMAN, CARD_ID.SPARK_SWORDSMAN],
      playerB: [CARD_ID.SPARK_SWORDSMAN],
    })
    return withState(initial, state => ({
      ...state, phase: 'main',
      players: { ...state.players, playerA: { ...state.players.playerA, mana: 0 } },
    }))
  }

  it('discards the highest cost card, breaking ties by hand order, only once', () => {
    const manager = createBlockedHand()
    const cardId = manager.state.players.playerA.hand[0]
    const ai = new GameAI()
    const action = ai.chooseAction(manager)
    expect(action).toEqual({ type: 'discardFromHand', cardId })
    const next = GameManager.applyAction(manager, action!)
    expect(next.state.players.playerA.hand).toHaveLength(4)
    expect(next.state.players.playerA.discard).toContain(cardId)
    expect(ai.chooseAction(next)).toEqual({ type: 'passPhase' })
  })

  it('does not discard when the turn discard has already been used', () => {
    const manager = withState(createBlockedHand(), state => ({ ...state, hasDiscardedThisTurn: true }))
    expect(new GameAI().chooseAction(manager)).toEqual({ type: 'passPhase' })
  })

  it('does not force a discard if a creature can be summoned', () => {
    const manager = withState(createBlockedHand(), state => ({
      ...state, players: { ...state.players, playerA: { ...state.players.playerA, mana: 2 } },
    }))
    expect(new GameAI().chooseAction(manager)?.type).toBe('summonCreature')
  })

  it('does not force a discard if a spell can be played', () => {
    const manager = withState(createBlockedHand(), state => {
      const cardId = state.players.playerA.hand[1]
      return { ...state, cards: { ...state.cards, [cardId]: {
        ...state.cards[cardId], card: CARD_BY_DEFINITION_ID[CARD_ID.CATACLYSM]!,
      } } }
    })
    expect(GameManager.getLegalMainActions(manager).some(action => action.type === 'playSpell')).toBe(true)
    expect(new GameAI().chooseAction(manager)?.type).not.toBe('discardFromHand')
  })

  it('excludes the ignored highest-cost card on normal difficulty', () => {
    const manager = createBlockedHand()
    expect(new GameAI({ difficulty: 'normal', random: () => 0 }).chooseAction(manager)).toEqual({
      type: 'discardFromHand', cardId: manager.state.players.playerA.hand[2],
    })
  })
})
