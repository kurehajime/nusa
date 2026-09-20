import { motion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import {
  CARD_BY_DEFINITION_ID,
  THEME_DECK_BY_ID,
  type CardDefinitionId,
  type CardColor,
  type ThemeDeckId,
} from '../game'
import { PLAYER_IMAGE_BY_DECK_ID } from './playerImages'
import CardView from './CardView'

type ScenarioProgressDialogProps = {
  opponentDeckIds: readonly ThemeDeckId[]
  currentBattleIndex: number
  result: 'intro' | 'win' | 'loss'
  rewardChoices?: readonly CardDefinitionId[]
  playerCardDefinitionIds?: readonly CardDefinitionId[]
  onConfirm: (rewardId?: CardDefinitionId) => void
}

const DECK_COLOR_VALUES = {
  red: '#6f3028',
  blue: '#2b5278',
  green: '#315d42',
} satisfies Record<CardColor, string>

const ScenarioProgressDialog = ({
  opponentDeckIds,
  currentBattleIndex,
  result,
  rewardChoices = [],
  playerCardDefinitionIds = [],
  onConfirm,
}: ScenarioProgressDialogProps) => {
  const [selectedRewardId, setSelectedRewardId] = useState<CardDefinitionId | null>(null)
  const playerWon = result === 'win'
  const scenarioComplete =
    playerWon && currentBattleIndex === opponentDeckIds.length - 1
  const animateResultTitle = result !== 'intro' && !scenarioComplete
  const hasRewards = playerWon && !scenarioComplete && rewardChoices.length > 0
  const rewardSelected = selectedRewardId !== null && rewardChoices.includes(selectedRewardId)
  const nextBattleIndex =
    result === 'intro'
      ? currentBattleIndex
      : playerWon && !scenarioComplete
        ? currentBattleIndex + 1
        : null
  const nextOpponent =
    nextBattleIndex === null
      ? null
      : THEME_DECK_BY_ID[opponentDeckIds[nextBattleIndex]]
  const defeatedOpponent = THEME_DECK_BY_ID[opponentDeckIds[currentBattleIndex]]
  const title =
    result === 'intro'
      ? 'シナリオ開始'
      : scenarioComplete
        ? '全勝'
        : playerWon
          ? '勝利'
          : '敗北'
  const description =
    result === 'intro' && nextOpponent
      ? `最初の対戦相手は「${nextOpponent.name}」`
      : scenarioComplete
        ? 'すべての対戦相手を撃破しました'
        : playerWon
          ? `「${defeatedOpponent.name}」を倒した`
          : 'お疲れ様でした'

  return (
    <motion.div
      className="game-result-overlay scenario-result-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <motion.section
        className={`scenario-result-dialog ${hasRewards ? 'scenario-result-with-rewards' : ''}`}
        data-result={scenarioComplete ? 'complete' : result}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scenario-result-title"
        aria-describedby="scenario-result-description"
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.06, duration: 0.34, ease: 'easeOut' }}
      >
        <header className="scenario-result-header">
          <h2 id="scenario-result-title" aria-label={animateResultTitle ? title : undefined}>
            {animateResultTitle
              ? [...title].map((letter) => (
                  <span key={letter} className="scenario-result-letter" aria-hidden="true">
                    {letter}
                  </span>
                ))
              : title}
          </h2>
          <span id="scenario-result-description">{description}</span>
        </header>
        <ol className="scenario-opponent-track" aria-label="対戦相手一覧">
          {opponentDeckIds.map((deckId, index) => {
            const deck = THEME_DECK_BY_ID[deckId]
            const mainColor = deck.colors[0]
            const subColor = deck.colors[1] ?? mainColor
            const defeated =
              index < currentBattleIndex ||
              (playerWon && index === currentBattleIndex)
            const next = index === nextBattleIndex
            const failed = result === 'loss' && index === currentBattleIndex
            const stateLabel = defeated
              ? '撃破済み'
              : next
                ? '次の対戦相手'
                : failed
                  ? '敗北した相手'
                  : '未対戦'

            return (
              <li
                key={deckId}
                className={[
                  'scenario-opponent',
                  defeated ? 'scenario-opponent-defeated' : '',
                  next ? 'scenario-opponent-next' : '',
                  failed ? 'scenario-opponent-failed' : '',
                ].filter(Boolean).join(' ')}
                aria-current={next ? 'step' : undefined}
                aria-label={`${index + 1}戦目 ${deck.name} ${stateLabel}`}
              >
                <span className="scenario-opponent-state" aria-hidden="true">
                  {next ? '次の対戦' : failed ? 'COMの勝利' : '\u00a0'}
                </span>
                <span
                  className="scenario-opponent-icon"
                  style={
                    {
                      '--scenario-main-color': DECK_COLOR_VALUES[mainColor],
                      '--scenario-sub-color': DECK_COLOR_VALUES[subColor],
                    } as CSSProperties
                  }
                >
                  <img
                    src={PLAYER_IMAGE_BY_DECK_ID[deckId]}
                    alt=""
                    aria-hidden="true"
                  />
                  {defeated && (
                    <span className="scenario-opponent-cross" aria-hidden="true">
                      ×
                    </span>
                  )}
                </span>
                <span className="scenario-opponent-order">Battle {index + 1}</span>
                <strong>{deck.name}</strong>
              </li>
            )
          })}
        </ol>
        {hasRewards && (
          <section className="scenario-rewards" aria-labelledby="scenario-reward-title">
            <h3 id="scenario-reward-title">勝利報酬</h3>
            <div className="scenario-reward-choices" role="group" aria-label="報酬カード">
              {rewardChoices.map((definitionId) => {
                const card = CARD_BY_DEFINITION_ID[definitionId]!
                const copies = playerCardDefinitionIds.filter((id) => id === definitionId).length
                return (
                  <button
                    key={definitionId}
                    className="scenario-reward-choice"
                    type="button"
                    aria-pressed={selectedRewardId === definitionId}
                    aria-label={`${card.name}を2枚追加（現在${copies}枚）`}
                    onClick={() => setSelectedRewardId(definitionId)}
                  >
                    <CardView card={card} nestedInButton mobileDetailPlacement="top" />
                    <strong>{card.name}</strong>
                    <span>{copies}枚 → {copies + 2}枚</span>
                    <span className="scenario-reward-selection">
                      {selectedRewardId === definitionId ? '選択中' : '＋2枚'}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )}
        <button
          className="scenario-result-confirm"
          type="button"
          autoFocus={!hasRewards}
          disabled={hasRewards && !rewardSelected}
          onClick={() => onConfirm(hasRewards && rewardSelected ? selectedRewardId : undefined)}
        >
          {result === 'intro'
            ? '対戦開始'
            : nextBattleIndex === null
              ? 'OK'
              : '次の対戦へ'}
        </button>
      </motion.section>
    </motion.div>
  )
}

export default ScenarioProgressDialog
