import type { ThemeDeckId } from '../game'
import type { BattleMode } from './GameSetup'
import { getDeckBackgroundStyle } from './deckBackground'
import TitleDemo from './TitleDemo'

type TitleScreenProps = {
  playerDeckId: ThemeDeckId
  onSelectMode: (mode: BattleMode) => void
}

const TitleScreen = ({ playerDeckId, onSelectMode }: TitleScreenProps) => (
  <main className="setup-shell title-screen" style={getDeckBackgroundStyle(playerDeckId)}>
    <TitleDemo />
    <h1 className="title-logo">nusa</h1>
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
