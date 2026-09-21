import { useState } from 'react'
import type { CSSProperties } from 'react'
import {
  THEME_DECK_BY_ID,
  THEME_DECKS,
  type AiDifficulty,
  type CardColor,
  type ThemeDeck,
  type ThemeDeckId,
} from '../game'
import { getDeckBackgroundStyle } from './deckBackground'

export type BattleMode = 'scenario' | 'free'

export type GameSetupSelection =
  | {
    mode: 'scenario'
    playerDeckId: ThemeDeckId
    difficulty: AiDifficulty
  }
  | {
    mode: 'free'
    playerDeckId: ThemeDeckId
    comDeckId: ThemeDeckId
    difficulty: AiDifficulty
  }

type GameSetupProps = {
  mode: BattleMode
  initialPlayerDeckId: ThemeDeckId
  initialComDeckId: ThemeDeckId
  initialDifficulty: AiDifficulty
  onStart: (selection: GameSetupSelection) => void
  onBack: (selection: GameSetupSelection) => void
}

const AI_DIFFICULTIES: readonly {
  value: AiDifficulty
  label: string
}[] = [
    { value: 'easy', label: 'Easy' },
    { value: 'normal', label: 'Normal' },
    { value: 'hard', label: 'Hard' },
  ]

const COLOR_LABELS: Record<CardColor, string> = {
  red: '赤',
  blue: '青',
  green: '緑',
}

const DECK_COLOR_VALUES = {
  red: '#6f3028',
  blue: '#2b5278',
  green: '#315d42',
} satisfies Record<CardColor, string>

const isThemeDeckId = (value: string): value is ThemeDeckId =>
  Object.prototype.hasOwnProperty.call(THEME_DECK_BY_ID, value)

const DeckSummary = ({ deck }: { deck: ThemeDeck }) => (
  <div className="setup-deck-summary">
    <div className="setup-deck-heading">
      <strong>{deck.name}</strong>
    </div>
    <div className="setup-deck-colors" aria-label={deck.colors.map((color) => COLOR_LABELS[color]).join('・')}>
      {deck.colors.map((color) => (
        <span key={color} className="setup-deck-color">
          <span className={`setup-color-swatch setup-color-${color}`} aria-hidden="true" />
          {COLOR_LABELS[color]}
        </span>
      ))}
    </div>
    <p>{deck.description}</p>
  </div>
)

const DeckSelector = ({
  label,
  value,
  onChange,
}: {
  label: string
  value: ThemeDeckId
  onChange: (deckId: ThemeDeckId) => void
}) => {
  const deck = THEME_DECK_BY_ID[value] ?? THEME_DECKS[0]

  return (
    <fieldset className="setup-deck-fieldset">
      <legend>{label}</legend>
      <label className="setup-select-label">
        テーマデッキ
        <select
          value={value}
          onChange={(event) => {
            const deckId = event.currentTarget.value
            if (isThemeDeckId(deckId)) {
              onChange(deckId)
            }
          }}
        >
          {THEME_DECKS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}（{option.colors.map((color) => COLOR_LABELS[color]).join('・')}）
            </option>
          ))}
        </select>
      </label>
      <DeckSummary deck={deck} />
    </fieldset>
  )
}

const ScenarioDeckSelector = ({
  value,
  onChange,
}: {
  value: ThemeDeckId
  onChange: (deckId: ThemeDeckId) => void
}) => {
  const selectedDeck = THEME_DECK_BY_ID[value] ?? THEME_DECKS[0]

  return (
    <fieldset className="setup-scenario-fieldset">
      <legend>プレイヤーデッキ</legend>
      <div className="setup-scenario-decks">
        {THEME_DECKS.map((deck) => {
          const mainColor = deck.colors[0]
          const subColor = deck.colors[1] ?? mainColor

          return (
            <label
              key={deck.id}
              className="setup-scenario-deck-option"
              style={
                {
                  '--setup-deck-main-color': DECK_COLOR_VALUES[mainColor],
                  '--setup-deck-sub-color': DECK_COLOR_VALUES[subColor],
                } as CSSProperties
              }
            >
              <input
                type="radio"
                name="scenario-player-deck"
                value={deck.id}
                checked={deck.id === value}
                onChange={() => onChange(deck.id)}
              />
              <span className="setup-scenario-radio" aria-hidden="true" />
              <span className="setup-scenario-deck-label">
                <strong>{deck.name}</strong>
                <span>{deck.colors.map((color) => COLOR_LABELS[color]).join('・')}</span>
              </span>
            </label>
          )
        })}
      </div>
      <DeckSummary deck={selectedDeck} />
    </fieldset>
  )
}

const GameSetup = ({
  mode,
  initialPlayerDeckId,
  initialComDeckId,
  initialDifficulty,
  onStart,
  onBack,
}: GameSetupProps) => {
  const [playerDeckId, setPlayerDeckId] = useState<ThemeDeckId>(initialPlayerDeckId)
  const [comDeckId, setComDeckId] = useState<ThemeDeckId>(initialComDeckId)
  const [difficulty, setDifficulty] = useState<AiDifficulty>(initialDifficulty)
  const selection: GameSetupSelection = mode === 'scenario'
    ? { mode, playerDeckId, difficulty }
    : { mode, playerDeckId, comDeckId, difficulty }

  return (
    <main
      className="setup-shell setup-screen"
      style={getDeckBackgroundStyle(playerDeckId)}
    >
      <section className="setup-panel" aria-labelledby="game-setup-title">
        <header className="setup-header">
          <h1 id="game-setup-title">ゲーム準備</h1>
          <span>{mode === 'scenario' ? 'シナリオ' : 'フリーバトル'}</span>
        </header>
        <div className="setup-mode-panel">
          {mode === 'scenario' ? (
            <ScenarioDeckSelector value={playerDeckId} onChange={setPlayerDeckId} />
          ) : (
            <div className="setup-deck-grid">
              <DeckSelector
                label="プレイヤー"
                value={playerDeckId}
                onChange={setPlayerDeckId}
              />
              <DeckSelector label="COM" value={comDeckId} onChange={setComDeckId} />
            </div>
          )}
        </div>
        <fieldset className="setup-difficulty-fieldset">
          <legend>COM難易度</legend>
          <div className="setup-difficulty-options">
            {AI_DIFFICULTIES.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="com-difficulty"
                  value={option.value}
                  checked={difficulty === option.value}
                  onChange={() => setDifficulty(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="setup-actions">
          <button className="setup-back-button" type="button" onClick={() => onBack(selection)}>
            タイトルへ戻る
          </button>
          <button className="setup-start-button" type="button" onClick={() => onStart(selection)}>
            {mode === 'scenario' ? 'シナリオ開始' : 'ゲーム開始'}
          </button>
        </div>
      </section>
    </main>
  )
}

export default GameSetup
