export const PLAYER_IDS = ['playerA', 'playerB'] as const

export type PlayerId = (typeof PLAYER_IDS)[number]

export type CardColor = 'red' | 'blue' | 'green'

export type CardKind = 'creature' | 'spell'

export type Phase = 'keepUp' | 'main' | 'battle' | 'cleanup'

export type CardInstanceId = number

export type CardDefinitionId = `${string}-${string}-${string}-${string}-${string}`

export type KeywordAbility =
  | { type: 'betrayal' }
  | { type: 'summoningSickness' }
  | { type: 'vanish' }
  | { type: 'loneWarrior'; attack: number; defense: number }
  | { type: 'withdraw' }
  | { type: 'assassin'; attack: number }
  | { type: 'counter' }
  | { type: 'rally' }
  | { type: 'beachhead'; costReduction: number }
  | { type: 'capture'; marchTax: number }
  | { type: 'mining'; mana: number }
  | { type: 'rearguard'; attack: number; defense: number }
  | { type: 'installment'; mana: number }
  | { type: 'trickster'; amount: number }
  | { type: 'plunder'; mana: number }
  | { type: 'bombardment'; damage: number }
  | { type: 'gluttony' }

export type KeywordAbilityType = KeywordAbility['type']

export type ActivatedAbilityType = Extract<
  KeywordAbilityType,
  'withdraw' | 'rally'
>

export type CardBase = {
  definitionId: CardDefinitionId
  foil?: boolean
  name: string
  kind: CardKind
  cost: number
}

export type CreatureCard = CardBase & {
  kind: 'creature'
  color: CardColor
  attack: number
  defense: number
  march: number
  abilities: KeywordAbility[]
}

export type SpellDuration = 'immediate' | 'untilTurnEnd' | 'untilNextTurnStart'

export type SpellEffect =
  | { type: 'returnFire'; exileColor: 'red' }
  | { type: 'lifeDroplet'; exileColor: 'blue' }
  | { type: 'abundance'; exileColor: 'green' }
  | { type: 'fireballAssault' }
  | { type: 'transfer' }
  | { type: 'lifeCycle' }
  | { type: 'selfDestructOrder' }
  | { type: 'bribery' }
  | { type: 'cataclysm' }

export type SpellCard = CardBase & {
  kind: 'spell'
  duration: SpellDuration
  effect: SpellEffect
  text: string
}

export type Card = CreatureCard | SpellCard

export type CardInstance = Readonly<{
  id: CardInstanceId
  ownerId: PlayerId
  card: Card
}>

export type CreatureInstance = {
  cardId: CardInstanceId
  summonedTurn: number
}

export type DamageMarker = {
  cardId: CardInstanceId
  damage: number
}

export type CreatureStatModifier = {
  attack: number
  defense: number
}

export type EffectiveCreatureStats = {
  attack: number
  defense: number
  march: number
}

export type KeepUpManaContribution = {
  amount: number
  stackKey: string
}

export type SummonOption = {
  insertIndex: number
  requiredMarch: number
  effectiveCost: number
  canReach: boolean
  affordable: boolean
  canSummon: boolean
}

export type ActivatedAbilityOption = {
  sourceCardId: CardInstanceId
  abilityType: ActivatedAbilityType
  label: string
  enabled: boolean
  reason?: string
}

export type ActivatedAbilityResolution =
  | { destination: 'discard'; mana: number }
  | { destination: 'board'; boardIndex: number }

export type EffectiveBoardGroup = {
  ownerId: PlayerId
  startIndex: number
  endIndex: number
  attack: number
  defense: number
}

export type PendingCombat = {
  damageMarkers: DamageMarker[]
  destroyedCardIds: CardInstanceId[]
  destructionManaRefunds?: Partial<Record<CardInstanceId, number>>
  defendingPlayerId: PlayerId
  playerWasHit: boolean
  playerDamage: number
  attackerManaGain?: number
  endsTurnAfterResolution?: false
}

export type CombatPreview = {
  attackerId: PlayerId
  attackingGroup: { startIndex: number; endIndex: number }
  destroyedCardIds: CardInstanceId[]
  refundedMana: Partial<Record<PlayerId, number>>
  playerDamage: number
  attackerManaGain: number
  nextState: GameState
}

export type Board = {
  creatures: CreatureInstance[]
}

export type PlacedSpell = {
  cardId: CardInstanceId
  effectAmount: number
}

export type PlayerState = {
  id: PlayerId
  name: string
  hp: number
  mana: number
  deck: CardInstanceId[]
  hand: CardInstanceId[]
  discard: CardInstanceId[]
  exile: CardInstanceId[]
  placedSpell: PlacedSpell | null
}

export type GameDeckLists = Record<PlayerId, readonly CardDefinitionId[]>

export type GameState = {
  turn: number
  activePlayerId: PlayerId
  phase: Phase
  hasAttackedThisTurn: boolean
  hasDiscardedThisTurn: boolean
  pendingCombat: PendingCombat | null
  cards: Readonly<Record<CardInstanceId, CardInstance>>
  players: Record<PlayerId, PlayerState>
  board: Board
}

export type SpellTarget =
  | { kind: 'group'; startIndex: number; endIndex: number }
  | { kind: 'creature'; cardId: CardInstanceId }

export type PlaySpellAction = {
  type: 'playSpell'
  cardId: CardInstanceId
  target?: SpellTarget
}

export type GameAction =
  | { type: 'resolveKeepUp' }
  | { type: 'passPhase' }
  | { type: 'summonCreature'; cardId: CardInstanceId; insertIndex: number }
  | PlaySpellAction
  | { type: 'attackGroup'; startIndex: number; endIndex: number }
  | { type: 'finishCombat' }
  | {
      type: 'activateAbility'
      sourceCardId: CardInstanceId
      abilityType: ActivatedAbilityType
    }
  | { type: 'discardFromHand'; cardId: CardInstanceId }
