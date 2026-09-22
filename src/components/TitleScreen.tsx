import type { ThemeDeckId } from '../game'
import type { BattleMode } from './GameSetup'
import CardView from './CardView'
import { getDeckBackgroundStyle } from './deckBackground'

type TitleScreenProps = {
  playerDeckId: ThemeDeckId
  onSelectMode: (mode: BattleMode) => void
}

const TitleScreen = ({ playerDeckId, onSelectMode }: TitleScreenProps) => (
  <main className="setup-shell title-screen" style={getDeckBackgroundStyle(playerDeckId)}>
    <div className="title-brand">
      <div className="title-card-back" aria-hidden="true">
        <CardView card={null} faceDown />
      </div>
      <h1 className="title-logo">nusa</h1>
    </div>
    <section className="setup-panel title-mode-panel" aria-labelledby="mode-selection-title">
      <h2 id="mode-selection-title">モード選択</h2>
      <button className="title-mode-button" type="button" onClick={() => onSelectMode('scenario')}>
        シナリオ
      </button>
      <button className="title-mode-button" type="button" onClick={() => onSelectMode('free')}>
        フリーバトル
      </button>
    </section>
  </main>
)

export default TitleScreen
