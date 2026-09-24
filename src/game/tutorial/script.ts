import { CARD_DEFINITION_IDS as C } from '../cards'
import { THEME_DECK_IDS } from '../themeDecks'
import type { GameDeckLists, PlayerId } from '../types'

export type TutorialAction =
  | { type: 'selectCard'; card: string }
  | { type: 'summonCreature'; card: string; besidePlayer: PlayerId }
  | { type: 'attackGroup'; card: string }
  | { type: 'endTurn' }

export type TutorialTarget =
  | { kind: 'handCard'; card: string }
  | { kind: 'summonSlot'; besidePlayer: PlayerId }
  | { kind: 'attackGroup'; card: string }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'endTurn' }

export type TutorialStep = {
  id: string
  actor: PlayerId
  message: string
  target: TutorialTarget
  action: TutorialAction
}

// A short introductory script. Array order is the draw order, including duplicates.
export const TUTORIAL = {
  playerDeckId: THEME_DECK_IDS.RED_TOTAL_ASSAULT,
  comDeckId: THEME_DECK_IDS.BLUE_MOBILE_INTERCEPT,
  freeBattleDifficulty: 'easy' as const,
  decks: {
    playerA: [
      C.SPARK_SWORDSMAN, C.SPARK_SWORDSMAN, C.BURNING_VANGUARD,
      C.BEACON_HEAVY_CAVALRY, C.FIREBALL_ASSAULT,
      C.SPARK_SWORDSMAN, C.SOLITARY_PEAK_SWORDSMAN, C.BURNING_VANGUARD,
      C.SPARK_SWORDSMAN, C.BEACON_HEAVY_CAVALRY, C.FIREBALL_ASSAULT,
      C.SOLITARY_PEAK_SWORDSMAN, C.BURNING_VANGUARD, C.SPARK_SWORDSMAN,
      C.EXHAUSTED_VOLCANO_DRAGON, C.BEACON_HEAVY_CAVALRY,
      C.SPARK_SWORDSMAN, C.FIREBALL_ASSAULT, C.BURNING_VANGUARD,
      C.EXHAUSTED_VOLCANO_DRAGON,
    ],
    playerB: [
      C.TIDEWAY_SCOUT, C.TIDEWAY_SCOUT, C.SPRAY_HERALD,
      C.AZURE_WAVE_VOYAGER, C.TRANSFER,
      C.TIDEWAY_SCOUT, C.SURGING_DUELIST, C.SPRAY_HERALD,
      C.TIDEWAY_SCOUT, C.AZURE_WAVE_VOYAGER, C.TRANSFER,
      C.SURGING_DUELIST, C.SPRAY_HERALD, C.TIDEWAY_SCOUT,
      C.EPHEMERAL_DEEP_WHALE, C.AZURE_WAVE_VOYAGER,
      C.TIDEWAY_SCOUT, C.TRANSFER, C.SPRAY_HERALD,
      C.EPHEMERAL_DEEP_WHALE,
    ],
  } satisfies GameDeckLists,
  cards: {
    firstAlly: { playerId: 'playerA', deckIndex: 0 },
    firstEnemy: { playerId: 'playerB', deckIndex: 0 },
  } satisfies Record<string, { playerId: PlayerId; deckIndex: number }>,
  steps: [
    {
      id: 'select-first-ally', actor: 'playerA',
      message: '手札の「山賊」を選ぼう。',
      target: { kind: 'handCard', card: 'firstAlly' },
      action: { type: 'selectCard', card: 'firstAlly' },
    },
    {
      id: 'place-first-ally', actor: 'playerA',
      message: '「配置」を押そう。山賊はマナを2使って配置できるよ。',
      target: { kind: 'summonSlot', besidePlayer: 'playerA' },
      action: { type: 'summonCreature', card: 'firstAlly', besidePlayer: 'playerA' },
    },
    {
      id: 'attack-first-group', actor: 'playerA',
      message: '矢印のボタンで攻撃しよう。攻撃が終わると相手のターンになるよ。',
      target: { kind: 'attackGroup', card: 'firstAlly' },
      action: { type: 'attackGroup', card: 'firstAlly' },
    },
    {
      id: 'opponent-summon', actor: 'playerB',
      message: '相手もカードを配置するよ。',
      target: { kind: 'summonSlot', besidePlayer: 'playerB' },
      action: { type: 'summonCreature', card: 'firstEnemy', besidePlayer: 'playerB' },
    },
    {
      id: 'opponent-end-turn', actor: 'playerB',
      message: '相手がターンを終了。次はあなたの手札とマナが補充されるよ。',
      target: { kind: 'player', playerId: 'playerB' },
      action: { type: 'endTurn' },
    },
  ] satisfies TutorialStep[],
}
