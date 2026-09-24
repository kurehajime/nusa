import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { getTutorialInstruction } from '../game/tutorial/controller'

type Props = {
  instruction: ReturnType<typeof getTutorialInstruction>
  settling: boolean
  onDismiss: () => void
}

const TutorialGuide = ({ instruction, settling, onDismiss }: Props) => {
  const markerRef = useRef<HTMLDivElement>(null)
  const targetKey = settling ? null : instruction?.targetKey

  useEffect(() => {
    if (!targetKey) return
    const target = document.querySelector<HTMLElement>(`[data-tutorial-target="${targetKey}"]`)
    const marker = markerRef.current
    if (!target || !marker) return
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    target.setAttribute('aria-describedby', 'tutorial-message')
    let frame = 0
    // Follow card motion as well as scroll and viewport changes, without React renders.
    const follow = () => {
      const rect = target.getBoundingClientRect()
      marker.style.left = `${rect.left - 4}px`
      marker.style.top = `${rect.top - 4}px`
      marker.style.width = `${rect.width + 8}px`
      marker.style.height = `${rect.height + 8}px`
      marker.style.visibility = rect.width && rect.height ? 'visible' : 'hidden'
      marker.dataset.arrow = rect.top > 48 ? 'top' : 'bottom'
      frame = requestAnimationFrame(follow)
    }
    follow()
    return () => {
      cancelAnimationFrame(frame)
      target.removeAttribute('aria-describedby')
    }
  }, [targetKey])

  return (
    <>
      <section className="tutorial-guide" aria-label="チュートリアル">
        <p id="tutorial-message" role="status" aria-live="polite">
          {instruction?.message ?? 'ここからは自由に対戦できるよ。相手のHPを0にしよう！'}
        </p>
        {!instruction && (
          <button type="button" onClick={onDismiss} aria-label="説明を閉じる">×</button>
        )}
      </section>
      {targetKey && createPortal(
        <div key={targetKey} ref={markerRef} className="tutorial-target-marker" aria-hidden="true">
          <span>▼</span>
        </div>, document.body,
      )}
    </>
  )
}

export default TutorialGuide
