import {
  findCreatureIndex,
  getCreatureAt,
  getCreatureOwnerAt,
  getFrontIndex,
  getGroupAt,
  getRallyDestinationIndex,
  isAdjacentToEnemyPlayer,
  isGroupFlankedByEnemies,
  getOpponentId,
} from './boardQueries'
import type {
  ActivatedAbilityOption,
  ActivatedAbilityResolution,
  ActivatedAbilityType,
  CardInstanceId,
  CreatureCard,
  CreatureStatModifier,
  EffectiveCreatureStats,
  GameState,
  KeepUpManaContribution,
  KeywordAbility,
  KeywordAbilityType,
  PlayerId,
} from './types'

const NO_STAT_MODIFIER: CreatureStatModifier = { attack: 0, defense: 0 }

type AbilityByType<T extends KeywordAbilityType> = Extract<KeywordAbility, { type: T }>

type CreatureRuleContext = {
  state: GameState
  boardIndex: number
  cardId: CardInstanceId
  card: CreatureCard
  ownerId: PlayerId
}

type AbilityHandler<TAbility extends KeywordAbility = KeywordAbility> = {
  getAttackOverride?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => number | null
  getPositionStatModifier?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => CreatureStatModifier
  getKeepUpManaContribution?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => KeepUpManaContribution | null
  getSummonCostModifier?: (
    ability: TAbility,
    context: CreatureRuleContext,
    summoningPlayerId: PlayerId,
    insertIndex: number,
    summoningCard: CreatureCard,
  ) => number
  getOpponentMarchCost?: (
    ability: TAbility,
    context: CreatureRuleContext,
    movingPlayerId: PlayerId,
  ) => number
  getEndTurnManaCost?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => number
  getPlayerDamageManaGain?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => number
  getActivatedAbility?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => ActivatedAbilityOption
  getKeepUpPlayerDamage?: (ability: TAbility, context: CreatureRuleContext) => number
  getAttackDeckDiscardCount?: (attackPower: number) => number
  getActivatedResolution?: (
    ability: TAbility,
    context: CreatureRuleContext,
  ) => ActivatedAbilityResolution
  preventsDestructionRefund?: boolean
}

type AbilityHandlerMap = {
  [TAbility in KeywordAbilityType]: AbilityHandler<AbilityByType<TAbility>>
}

const createActivatedOption = (
  context: CreatureRuleContext,
  abilityType: ActivatedAbilityType,
  label: string,
  condition: boolean,
  reason: string,
): ActivatedAbilityOption => {
  const isActiveCreature =
    context.state.phase === 'main' &&
    context.state.pendingCombat === null &&
    context.state.activePlayerId === context.ownerId
  return {
    sourceCardId: context.cardId,
    abilityType,
    label,
    enabled: isActiveCreature && condition,
    ...(!isActiveCreature
      ? { reason: '自分のメインフェイズに使用できます。' }
      : condition
        ? {}
        : { reason }),
  }
}

const ABILITY_HANDLERS = {
  summoningSickness: {
    getAttackOverride: (_ability, context) =>
      getCreatureAt(context.state, context.boardIndex).summonedTurn ===
        context.state.turn
        ? 0
        : null,
  },
  vanish: {
    preventsDestructionRefund: true,
  },
  loneWarrior: {
    getPositionStatModifier: (ability, context) =>
      (context.boardIndex === 0 ||
        getCreatureOwnerAt(context.state, context.boardIndex - 1) !== context.ownerId) &&
        (context.boardIndex === context.state.board.creatures.length - 1 ||
          getCreatureOwnerAt(context.state, context.boardIndex + 1) !== context.ownerId)
        ? { attack: ability.attack, defense: ability.defense }
        : NO_STAT_MODIFIER,
  },
  withdraw: {
    getActivatedAbility: (_ability, context) =>
      createActivatedOption(context, 'withdraw', '解散', true, ''),
    getActivatedResolution: (_ability, context) => ({
      destination: 'discard',
      mana: context.card.cost,
    }),
  },
  assassin: {
    getPositionStatModifier: (ability, context) =>
      isAdjacentToEnemyPlayer(context.state, context.boardIndex)
        ? { attack: ability.attack, defense: 0 }
        : NO_STAT_MODIFIER,
  },
  counter: {},
  rally: {
    getActivatedAbility: (_ability, context) => {
      return createActivatedOption(
        context,
        'rally',
        '招集',
        getRallyDestinationIndex(context.state, context.boardIndex) !== context.boardIndex,
        'すでに最も前方の自グループの末尾にいます。',
      )
    },
    getActivatedResolution: (_ability, context) => ({
      destination: 'board',
      boardIndex: getRallyDestinationIndex(context.state, context.boardIndex),
    }),
  },
  beachhead: {
    getSummonCostModifier: (ability, context, summoningPlayerId, insertIndex, summoningCard) => {
      const frontInsertIndex = context.ownerId === 'playerA'
        ? context.boardIndex + 1
        : context.boardIndex
      return summoningPlayerId === context.ownerId &&
        summoningCard.color === context.card.color &&
        insertIndex === frontInsertIndex &&
        getFrontIndex(getGroupAt(context.state, context.boardIndex)) === context.boardIndex
        ? -ability.costReduction
        : 0
    },
  },
  capture: {
    getOpponentMarchCost: (ability, context, movingPlayerId) =>
      movingPlayerId === context.ownerId ? 0 : ability.marchTax,
  },
  mining: {
    getKeepUpManaContribution: (ability, context) => {
      const group = getGroupAt(context.state, context.boardIndex)
      if (!isGroupFlankedByEnemies(context.state, group)) {
        return null
      }
      return {
        amount: ability.mana,
        stackKey: `mining:${group.startIndex}-${group.endIndex}`,
      }
    },
  },
  rearguard: {
    getPositionStatModifier: (ability, context) => {
      const ownPlayerEdge = context.ownerId === 'playerA'
        ? 0
        : context.state.board.creatures.length - 1
      return context.boardIndex === ownPlayerEdge
        ? { attack: ability.attack, defense: ability.defense }
        : NO_STAT_MODIFIER
    },
  },
  installment: {
    getEndTurnManaCost: (ability) => ability.mana,
  },
  trickster: {
    getPositionStatModifier: (ability, context) => {
      const ownerHp = context.state.players[context.ownerId].hp
      const opponentHp = context.state.players[getOpponentId(context.ownerId)].hp
      if (ownerHp > opponentHp) {
        return { attack: ability.amount, defense: 0 }
      }
      if (ownerHp < opponentHp) {
        return { attack: 0, defense: ability.amount }
      }
      return NO_STAT_MODIFIER
    },
  },
  plunder: {
    getPlayerDamageManaGain: (ability) => ability.mana,
  },
  bombardment: {
    getKeepUpPlayerDamage: (ability) => ability.damage,
  },
  gluttony: {
    getAttackDeckDiscardCount: (attackPower) => attackPower,
  },
} satisfies AbilityHandlerMap

const getAbilityHandler = (ability: KeywordAbility): AbilityHandler =>
  ABILITY_HANDLERS[ability.type] as AbilityHandler

export const formatAbility = (ability: KeywordAbility): string => {
  switch (ability.type) {
    case 'gluttony':
      return '大喰い'
    case 'summoningSickness':
      return '召喚酔い'
    case 'vanish':
      return '消滅'
    case 'loneWarrior':
      return `一騎当千(+${ability.attack}/+${ability.defense})`
    case 'withdraw':
      return '解散'
    case 'assassin':
      return `刺客${ability.attack}`
    case 'counter':
      return '反撃'
    case 'rally':
      return '招集'
    case 'beachhead':
      return `橋頭堡${ability.costReduction}`
    case 'capture':
      return `捕獲${ability.marchTax}`
    case 'mining':
      return `採掘${ability.mana}`
    case 'rearguard':
      return `護衛(+${ability.attack}/+${ability.defense})`
    case 'installment':
      return `リボ払い${ability.mana}`
    case 'trickster':
      return `トリックスター${ability.amount}`
    case 'plunder':
      return `略奪${ability.mana}`
    case 'bombardment':
      return `砲撃${ability.damage}`
  }
}

export const describeAbility = (ability: KeywordAbility): string => {
  switch (ability.type) {
    case 'gluttony':
      return 'このクリーチャーを含むグループが攻撃した時、自分の山札をグループの攻撃力と同じ枚数だけ上から捨てる。'
    case 'summoningSickness':
      return '召喚したターンは攻撃力0として扱う。'
    case 'vanish':
      return 'このクリーチャーが破壊された場合、通常の破壊によるマナ返還は発生しない。'
    case 'loneWarrior':
      return `このクリーチャーの所属するグループが1体の場合、攻撃力+${ability.attack}、防御力+${ability.defense}する。`
    case 'withdraw':
      return '起動型能力。このクリーチャーを破壊する。この能力による破壊では半分ではなく全額のマナが返還される。'
    case 'assassin':
      return `このクリーチャーの隣が敵プレイヤーの場合、攻撃力を+${ability.attack}する。`
    case 'counter':
      return 'このクリーチャーが先頭にいる場合、攻撃グループの先頭にいるクリーチャー1体へ、自身の攻撃力と同じ攻撃を与える。'
    case 'rally':
      return '起動型能力。最も前方にある自グループの末尾に移動する。'
    case 'beachhead':
      return `このクリーチャーがグループの先頭にいる場合、このクリーチャーの前に召喚する同じ色のクリーチャーの召喚コストは${ability.costReduction}軽減される。`
    case 'capture':
      return `このクリーチャーを越える際、必要な進軍距離を+${ability.marchTax}する。`
    case 'mining':
      return `このクリーチャーが所属するグループが敵クリーチャーまたは敵プレイヤーに囲まれている場合、自分のキープアップフェイズに追加で${ability.mana}マナを得る。同一グループ内の<<採掘>>は重複しない。`
    case 'rearguard':
      return `このクリーチャーが自プレイヤーに隣接する場合、攻撃力+${ability.attack}、防御力+${ability.defense}する。`
    case 'installment':
      return `自分のエンドフェイズにマナ${ability.mana}を支払う。足りない場合はこのクリーチャーを破壊する。この効果で破壊された場合はマナは返還されない。`
    case 'trickster':
      return `自プレイヤーのHPが相手より大きい場合は攻撃力を+${ability.amount}し、小さい場合は防御力を+${ability.amount}する。同じ場合は変わらない。`
    case 'plunder':
      return `このクリーチャーが所属するグループが敵プレイヤーに1以上のダメージを与えた場合、マナ${ability.mana}を得る。`
    case 'bombardment':
      return `自分のキープアップフェイズに発動する。相手プレイヤーに${ability.damage}ダメージを与える。シールドの影響は受けない。`
  }
}

export class CreatureRules {
  private readonly context: CreatureRuleContext

  constructor(state: GameState, boardIndex: number) {
    const creature = getCreatureAt(state, boardIndex)
    const instance = state.cards[creature.cardId]
    if (!instance || instance.card.kind !== 'creature') {
      throw new Error(`Board position ${boardIndex} does not contain a creature card.`)
    }
    this.context = {
      state,
      boardIndex,
      cardId: creature.cardId,
      card: instance.card,
      ownerId: instance.ownerId,
    }
  }

  static fromCardId(state: GameState, cardId: CardInstanceId): CreatureRules {
    const boardIndex = findCreatureIndex(state, cardId)
    if (boardIndex < 0) {
      throw new Error(`Creature card ${cardId} is not on the board.`)
    }
    return new CreatureRules(state, boardIndex)
  }

  get cardId(): CardInstanceId {
    return this.context.cardId
  }

  get ownerId(): PlayerId {
    return this.context.ownerId
  }

  private getAbilities(): KeywordAbility[] {
    return this.context.card.abilities
  }

  getPositionStatModifier(): CreatureStatModifier {
    const abilityModifier = this.getAbilities().reduce<CreatureStatModifier>(
      (total, ability) => {
        const modifier =
          getAbilityHandler(ability).getPositionStatModifier?.(ability, this.context) ??
          NO_STAT_MODIFIER
        return {
          attack: total.attack + modifier.attack,
          defense: total.defense + modifier.defense,
        }
      },
      NO_STAT_MODIFIER,
    )
    return abilityModifier
  }

  getEffectiveStats(): EffectiveCreatureStats {
    const modifier = this.getPositionStatModifier()
    const modifiedAttack = Math.max(0, this.context.card.attack + modifier.attack)
    const attackOverride = this.getAbilities().reduce<number | null>(
      (currentOverride, ability) =>
        currentOverride ??
        getAbilityHandler(ability).getAttackOverride?.(ability, this.context) ??
        null,
      null,
    )
    return {
      attack: attackOverride ?? modifiedAttack,
      defense: Math.max(0, this.context.card.defense + modifier.defense),
      march: this.context.card.march,
    }
  }

  getCounterAttack(): number {
    if (!this.getAbilities().some((ability) => ability.type === 'counter')) {
      return 0
    }
    const group = getGroupAt(this.context.state, this.context.boardIndex)
    const isFront = getFrontIndex(group) === this.context.boardIndex
    return isFront ? this.getEffectiveStats().attack : 0
  }

  getKeepUpManaModifier(): KeepUpManaContribution[] {
    const contributions: KeepUpManaContribution[] = []
    for (const ability of this.getAbilities()) {
      const contribution =
        getAbilityHandler(ability).getKeepUpManaContribution?.(ability, this.context) ?? null
      if (contribution !== null) contributions.push(contribution)
    }
    return contributions
  }

  getSummonCostModifier(
    summoningPlayerId: PlayerId,
    insertIndex: number,
    summoningCard: CreatureCard,
  ): number {
    return this.getAbilities().reduce(
      (total, ability) =>
        total +
        (getAbilityHandler(ability).getSummonCostModifier?.(
          ability,
          this.context,
          summoningPlayerId,
          insertIndex,
          summoningCard,
        ) ?? 0),
      0,
    )
  }

  getKeepUpPlayerDamage(): number {
    return this.getAbilities().reduce(
      (total, ability) => total +
        (getAbilityHandler(ability).getKeepUpPlayerDamage?.(ability, this.context) ?? 0),
      0,
    )
  }

  getAttackDeckDiscardCount(attackPower: number): number {
    return this.getAbilities().reduce(
      (total, ability) => total +
        (getAbilityHandler(ability).getAttackDeckDiscardCount?.(attackPower) ?? 0),
      0,
    )
  }

  getOpponentMarchCost(movingPlayerId: PlayerId): number {
    return this.getAbilities().reduce(
      (total, ability) =>
        total +
        (getAbilityHandler(ability).getOpponentMarchCost?.(
          ability,
          this.context,
          movingPlayerId,
        ) ?? 0),
      0,
    )
  }

  getEndTurnManaCost(): number {
    return this.getAbilities().reduce(
      (total, ability) =>
        total +
        (getAbilityHandler(ability).getEndTurnManaCost?.(
          ability,
          this.context,
        ) ?? 0),
      0,
    )
  }

  getPlayerDamageManaGain(): number {
    return this.getAbilities().reduce(
      (total, ability) =>
        total +
        (getAbilityHandler(ability).getPlayerDamageManaGain?.(
          ability,
          this.context,
        ) ?? 0),
      0,
    )
  }

  getActivatedActions(): ActivatedAbilityOption[] {
    const options = this.getAbilities().flatMap((ability) => {
      const option = getAbilityHandler(ability).getActivatedAbility?.(ability, this.context)
      return option ? [option] : []
    })
    return options.filter(
      (option, index) =>
        options.findIndex(({ abilityType }) => abilityType === option.abilityType) === index,
    )
  }

  getActivatedAbilityResolution(
    abilityType: ActivatedAbilityType,
  ): ActivatedAbilityResolution {
    const ability = this.getAbilities().find((candidate) => candidate.type === abilityType)
    const resolution = ability
      ? getAbilityHandler(ability).getActivatedResolution?.(ability, this.context)
      : undefined
    if (!resolution) {
      throw new Error(`Creature card ${this.context.cardId} does not have ${abilityType}.`)
    }
    return resolution
  }

  preventsDestructionRefund(): boolean {
    return this.getAbilities().some(
      (ability) => getAbilityHandler(ability).preventsDestructionRefund === true,
    )
  }
}
