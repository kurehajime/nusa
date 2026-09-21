import { useEffect, useMemo, useState } from 'react'
import { GameManager } from '../game'
import type { TitleDemoFrame } from '../game/titleDemo'
import BattleScene from './BattleScene'

const TitleDemo = () => {
  const [frame, setFrame] = useState<TitleDemoFrame | null>(null)

  useEffect(() => {
    const worker = new Worker(new URL('./titleDemo.worker.ts', import.meta.url), { type: 'module' })
    let timer: ReturnType<typeof setTimeout> | undefined
    let waiting = true
    let disposed = false

    const step = () => {
      if (disposed || document.hidden || waiting) return
      waiting = true
      worker.postMessage('step')
    }

    worker.onmessage = ({ data }: MessageEvent<TitleDemoFrame>) => {
      if (disposed) return
      waiting = false
      setFrame(data)
      if (!document.hidden) {
        const delay = data.finished ? 3_000 : data.state.pendingCombat !== null ? 650 : 850
        timer = setTimeout(step, delay)
      }
    }

    const onVisibilityChange = () => {
      clearTimeout(timer)
      if (!document.hidden) step()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      worker.terminate()
    }
  }, [])

  const manager = useMemo(() => frame === null ? null : GameManager.from(frame.state), [frame])
  if (frame === null || manager === null) return null
  const attack = frame.lastAction?.type === 'attackGroup' ? frame.lastAction : null

  return (
    <div className="title-demo" aria-hidden="true" inert data-match={frame.matchNumber} data-action={frame.actionCount}>
      <BattleScene
        key={frame.matchNumber}
        as="div"
        layoutId={`title-demo-${frame.matchNumber}`}
        manager={manager}
        playerDeckId={frame.deckIds.playerA}
        comDeckId={frame.deckIds.playerB}
        attackAnimation={attack === null ? null : {
          id: frame.actionCount,
          ownerId: frame.lastActor,
          startIndex: attack.startIndex,
          endIndex: attack.endIndex,
        }}
      />
    </div>
  )
}

export default TitleDemo
