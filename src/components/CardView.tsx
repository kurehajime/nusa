import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import CardFoil from './CardFoil'
import CardSurface from './CardSurface'
import {
  describeAbility,
  formatAbility,
  type Card,
  type CreatureStatModifier,
} from '../game'

type CardViewProps = {
  artAttackAnimation?: CardArtAttackAnimation
  card: Card | null
  compact?: boolean
  detailOpen?: boolean
  faceDown?: boolean
  flashFoilOnMount?: boolean
  jitterArt?: boolean
  label?: string
  mobileDetailPlacement?: 'top' | 'bottom'
  nestedInButton?: boolean
  statModifier?: CreatureStatModifier
}

type CardArtAttackAnimation = {
  id: number
  direction: 'left' | 'right'
  tiltDegrees: number
}

const COLOR_LABELS = {
  red: '赤',
  blue: '青',
  green: '緑',
} as const

const KIND_LABELS = {
  creature: 'クリーチャー',
  spell: '魔法',
} as const

const SPELL_DURATION_LABELS = {
  immediate: '起動',
  untilTurnEnd: '配置',
  untilNextTurnStart: '配置',
} as const

const STAT_ICON_URLS = {
  attack: `${import.meta.env.BASE_URL}step.svg`,
  defense: `${import.meta.env.BASE_URL}guard.svg`,
  march: `${import.meta.env.BASE_URL}attack.svg`,
} as const

const CARD_ART_URLS = import.meta.glob<string>('../assets/cards/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
})

const getCardArtUrl = (card: Card): string | undefined =>
  CARD_ART_URLS[`../assets/cards/${card.definitionId}.png`]

type DetailPlacement = 'top' | 'right' | 'bottom' | 'left'

type DetailPosition = {
  placement: DetailPlacement
  top: number
  left: number
  maxHeight?: number
}

const DETAIL_GAP = 10
const VIEWPORT_PADDING = 12

const getRulesText = (card: Card): string => {
  if (card.kind === 'creature') {
    return card.abilities.map(formatAbility).join(' / ')
  }
  return card.text
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

const formatModifier = (value: number): string => `${value > 0 ? '+' : ''}${value}`

type CardFaceProps = {
  artAttackAnimation?: CardArtAttackAnimation
  card: Card
  colorLabel: string
  jitterArt?: boolean
  statModifier?: CreatureStatModifier
}

const CardFace = ({
  artAttackAnimation,
  card,
  colorLabel,
  jitterArt = false,
  statModifier,
}: CardFaceProps) => {
  const artId = useId().replaceAll(':', '')
  const artClipId = `card-art-clip-${artId}`
  const artColorFilterId = `card-art-color-${artId}`
  const artJitterFilterId = `card-art-jitter-${artId}`
  const frameSketchFilterId = `card-frame-sketch-${artId}`
  const costSketchFilterId = `card-cost-sketch-${artId}`
  const artUrl = getCardArtUrl(card)
  const isSpell = card.kind === 'spell'
  const typeLabel = isSpell
    ? `${KIND_LABELS.spell}・${SPELL_DURATION_LABELS[card.duration]}`
    : `${KIND_LABELS.creature}・${colorLabel}`
  const hasAttackModifier = statModifier !== undefined && statModifier.attack !== 0
  const hasDefenseModifier = statModifier !== undefined && statModifier.defense !== 0
  const modifiers: Array<{
    iconUrl: string
    label: string
    type: 'attack' | 'defense'
  }> = []
  if (hasAttackModifier) {
    modifiers.push({
      iconUrl: STAT_ICON_URLS.attack,
      label: formatModifier(statModifier.attack),
      type: 'attack',
    })
  }
  if (hasDefenseModifier) {
    modifiers.push({
      iconUrl: STAT_ICON_URLS.defense,
      label: formatModifier(statModifier.defense),
      type: 'defense',
    })
  }

  return (
    <svg
      className="card-face"
      style={{
        '--card-frame-filter': `url(#${frameSketchFilterId})`,
        '--card-cost-filter': `url(#${costSketchFilterId})`,
      } as CSSProperties}
      viewBox="0 0 500 700"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <filter
          id={costSketchFilterId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.035 0.045"
            numOctaves="2"
            seed="7"
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale="22"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <filter
          id={frameSketchFilterId}
          x="-5%"
          y="-10%"
          width="110%"
          height="120%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.018 0.035"
            numOctaves="2"
            seed="7"
            result="grain"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="grain"
            scale="7"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <clipPath id={artClipId}>
          <rect x="28" y="86" width="444" height="259" rx="9" />
        </clipPath>
        <filter id={artColorFilterId} colorInterpolationFilters="sRGB">
          <feFlood className="card-face-art-color" result="art-color" />
          <feComposite in="art-color" in2="SourceAlpha" operator="in" />
        </filter>
        {jitterArt && (
          <filter id={artJitterFilterId} colorInterpolationFilters="sRGB">
            <feFlood className="card-face-art-color" result="art-color" />
            <feComposite
              in="art-color"
              in2="SourceAlpha"
              operator="in"
              result="colored-art"
            />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.03"
              numOctaves="2"
              seed="1"
              result="noise"
            >
              <animate
                attributeName="seed"
                values="1;2;3;4;5;6;7;8;9;10"
                dur="0.8s"
                repeatCount="indefinite"
                calcMode="discrete"
              />
            </feTurbulence>
            <feDisplacementMap in="colored-art" in2="noise" scale="12" />
          </filter>
        )}
      </defs>

      <rect className="card-face-base" x="2" y="2" width="496" height="696" rx="18" />

      <rect className="card-face-art-background" x="25" y="83" width="450" height="265" rx="12" />
      {artUrl && (
        <image
          key={artAttackAnimation?.id ?? 'idle'}
          className={`card-face-art-image ${artAttackAnimation ? `card-face-art-attacking-${artAttackAnimation.direction}` : ''}`}
          style={
            {
              '--card-art-attack-tilt': `${artAttackAnimation?.tiltDegrees ?? 0}deg`,
            } as CSSProperties
          }
          href={artUrl}
          x="28"
          y="86"
          width="444"
          height="259"
          preserveAspectRatio="xMidYMid meet"
          clipPath={`url(#${artClipId})`}
          filter={`url(#${jitterArt ? artJitterFilterId : artColorFilterId})`}
        />
      )}
      <rect className="card-face-art-frame" x="25" y="83" width="450" height="265" rx="12" />

      <circle className="card-face-cost-circle" cx="55" cy="54" r="40" />
      <text className="card-face-cost-text" x="55" y="57">
        {card.cost}
      </text>
      <foreignObject x="110" y="20" width="365" height="60">
        <div className="card-face-name">{card.name}</div>
      </foreignObject>

      {modifiers.map((modifier, index) => (
        <g
          key={modifier.type}
          className={`card-face-modifier card-face-modifier-${modifier.type}`}
          transform={`translate(${modifiers.length === 1 ? 426 : 354 + index * 96} 150)`}
        >
          <circle r="46" />
          <image
            href={modifier.iconUrl}
            x="-39"
            y="-24"
            width="48"
            height="48"
            preserveAspectRatio="xMidYMid meet"
          />
          <text x="24" y="3">
            {modifier.label}
          </text>
        </g>
      ))}

      <rect className="card-face-type-band" x="25" y="362" width="450" height="48" rx="8" />
      <text className="card-face-type-text" x="45" y="387">
        {typeLabel}
      </text>

      <rect
        className="card-face-rules-frame"
        x="25"
        y="424"
        width="450"
        height={isSpell ? 255 : 163}
        rx="10"
      />
      <foreignObject x="43" y="440" width="414" height={isSpell ? 223 : 131}>
        <div
          className={`card-face-rules ${card.kind === 'creature' ? 'card-face-rules-creature' : ''}`}
        >
          {getRulesText(card)}
        </div>
      </foreignObject>

      {card.kind === 'creature' ? (
        <g className="card-face-stats">
          {[
            { label: '攻撃', iconUrl: STAT_ICON_URLS.attack, value: card.attack, x: 25 },
            { label: '守備', iconUrl: STAT_ICON_URLS.defense, value: card.defense, x: 180 },
            { label: '進軍', iconUrl: STAT_ICON_URLS.march, value: card.march, x: 335 },
          ].map(({ label, iconUrl, value, x }) => (
            <g key={label} transform={`translate(${x} 601)`}>
              <rect width="140" height="78" rx="8" />
              <image
                className="card-face-stat-icon"
                href={iconUrl}
                x="10"
                y="10"
                width="58"
                height="58"
                preserveAspectRatio="xMidYMid meet"
              />
              <text className="card-face-stat-value" x="108" y="40">
                {value}
              </text>
            </g>
          ))}
        </g>
      ) : null}
    </svg>
  )
}

const CardView = ({
  artAttackAnimation,
  card,
  compact = false,
  detailOpen = false,
  faceDown = false,
  flashFoilOnMount = false,
  jitterArt = false,
  label,
  mobileDetailPlacement = 'bottom',
  nestedInButton = false,
  statModifier,
}: CardViewProps) => {
  const cardRef = useRef<HTMLElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const detailId = useId()
  const [showDetail, setShowDetail] = useState(false)
  const [detailPinned, setDetailPinned] = useState(false)
  const [detailPosition, setDetailPosition] = useState<DetailPosition | null>(null)
  const detailVisible = showDetail || detailOpen || detailPinned

  const openDetail = useCallback(() => {
    setDetailPosition(null)
    setShowDetail(true)
  }, [])

  const closeDetail = useCallback(() => {
    setShowDetail(false)
  }, [])

  const togglePinnedDetail = useCallback(() => {
    if (nestedInButton) {
      return
    }
    setDetailPinned((pinned) => !pinned)
  }, [nestedInButton])

  const updateDetailPosition = useCallback(() => {
    const cardElement = cardRef.current
    const detailElement = detailRef.current
    if (!cardElement || !detailElement) {
      return
    }

    const cardRect = cardElement.getBoundingClientRect()
    const detailRect = detailElement.getBoundingClientRect()
    const availableRight = window.innerWidth - cardRect.right - DETAIL_GAP - VIEWPORT_PADDING
    const availableLeft = cardRect.left - DETAIL_GAP - VIEWPORT_PADDING
    const mobilePlacement = window.matchMedia('(max-width: 720px)').matches

    if (mobilePlacement) {
      const above = mobileDetailPlacement === 'top'
      const maxHeight = Math.max(0, above
        ? cardRect.top - DETAIL_GAP - VIEWPORT_PADDING
        : window.innerHeight - cardRect.bottom - DETAIL_GAP - VIEWPORT_PADDING)
      const detailHeight = Math.min(
        detailElement.scrollHeight + detailRect.height - detailElement.clientHeight,
        maxHeight,
      )
      const top = above
        ? Math.max(VIEWPORT_PADDING, cardRect.top - DETAIL_GAP - detailHeight)
        : cardRect.bottom + DETAIL_GAP

      setDetailPosition({
        placement: mobileDetailPlacement,
        top,
        left: clamp(
          cardRect.left + (cardRect.width - detailRect.width) / 2,
          VIEWPORT_PADDING,
          window.innerWidth - detailRect.width - VIEWPORT_PADDING,
        ),
        maxHeight,
      })
      return
    }

    const detailHeight = Math.min(
      detailElement.scrollHeight + detailRect.height - detailElement.clientHeight,
      window.innerHeight - VIEWPORT_PADDING * 2,
    )
    const availableBottom = window.innerHeight - cardRect.bottom - DETAIL_GAP - VIEWPORT_PADDING

    let placement: DetailPlacement
    let top: number
    let left: number

    if (availableRight >= detailRect.width) {
      placement = 'right'
      top = cardRect.top + (cardRect.height - detailHeight) / 2
      left = cardRect.right + DETAIL_GAP
    } else if (availableLeft >= detailRect.width) {
      placement = 'left'
      top = cardRect.top + (cardRect.height - detailHeight) / 2
      left = cardRect.left - detailRect.width - DETAIL_GAP
    } else if (availableBottom >= detailHeight) {
      placement = 'bottom'
      top = cardRect.bottom + DETAIL_GAP
      left = cardRect.left + (cardRect.width - detailRect.width) / 2
    } else {
      placement = 'top'
      top = cardRect.top - detailHeight - DETAIL_GAP
      left = cardRect.left + (cardRect.width - detailRect.width) / 2
    }

    setDetailPosition({
      placement,
      top: clamp(top, VIEWPORT_PADDING, window.innerHeight - detailHeight - VIEWPORT_PADDING),
      left: clamp(left, VIEWPORT_PADDING, window.innerWidth - detailRect.width - VIEWPORT_PADDING),
    })
  }, [mobileDetailPlacement])

  useLayoutEffect(() => {
    if (!detailVisible) {
      return
    }

    updateDetailPosition()
    window.addEventListener('resize', updateDetailPosition)
    window.addEventListener('scroll', updateDetailPosition, true)

    return () => {
      window.removeEventListener('resize', updateDetailPosition)
      window.removeEventListener('scroll', updateDetailPosition, true)
    }
  }, [detailVisible, updateDetailPosition])

  useEffect(() => {
    if (!detailPinned) {
      return
    }

    const closePinnedDetail = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !cardRef.current?.contains(event.target)
      ) {
        setDetailPinned(false)
      }
    }

    document.addEventListener('pointerdown', closePinnedDetail, true)
    return () => document.removeEventListener('pointerdown', closePinnedDetail, true)
  }, [detailPinned])

  useEffect(() => {
    if (!nestedInButton) {
      return
    }

    const button = cardRef.current?.closest('button')
    let animationFrameId: number | null = null
    const stopTrackingPosition = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      updateDetailPosition()
    }
    const trackPosition = () => {
      updateDetailPosition()
      animationFrameId = window.requestAnimationFrame(trackPosition)
    }
    const startTrackingPosition = () => {
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(trackPosition)
      }
    }

    button?.addEventListener('focus', openDetail)
    button?.addEventListener('blur', closeDetail)
    button?.addEventListener('transitionrun', startTrackingPosition)
    button?.addEventListener('transitionend', stopTrackingPosition)
    button?.addEventListener('transitioncancel', stopTrackingPosition)

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }
      button?.removeEventListener('focus', openDetail)
      button?.removeEventListener('blur', closeDetail)
      button?.removeEventListener('transitionrun', startTrackingPosition)
      button?.removeEventListener('transitionend', stopTrackingPosition)
      button?.removeEventListener('transitioncancel', stopTrackingPosition)
    }
  }, [closeDetail, nestedInButton, openDetail, updateDetailPosition])

  if (faceDown) {
    return (
      <article className={`card-view card-back ${compact ? 'card-compact' : ''}`}>
        <div className="card-back-emblem" aria-hidden="true" />
      </article>
    )
  }

  if (!card) {
    return (
      <article className={`card-view card-empty ${compact ? 'card-compact' : ''}`}>
        <div className="card-empty-label">{label ?? ''}</div>
      </article>
    )
  }

  const colorClass = card.kind === 'spell' ? 'neutral' : card.color
  const colorLabel = card.kind === 'spell' ? '属性なし' : COLOR_LABELS[card.color]
  const hasAttackModifier = statModifier !== undefined && statModifier.attack !== 0
  const hasDefenseModifier = statModifier !== undefined && statModifier.defense !== 0
  const hasStatModifier = hasAttackModifier || hasDefenseModifier
  const modifierLabel = [
    hasAttackModifier ? `攻撃力補正${formatModifier(statModifier.attack)}` : null,
    hasDefenseModifier ? `防御力補正${formatModifier(statModifier.defense)}` : null,
  ]
    .filter((modifier): modifier is string => modifier !== null)
    .join('、')

  return (
    <article
      ref={cardRef}
      className={`card-view card-front card-${colorClass} ${card.foil ? 'card-foil' : ''} ${compact ? 'card-compact' : ''}`}
      aria-describedby={detailVisible ? detailId : undefined}
      aria-label={`${card.name}${hasStatModifier ? `、${modifierLabel}` : ''}`}
      tabIndex={nestedInButton ? undefined : 0}
      onBlur={closeDetail}
      onFocus={openDetail}
      onClick={togglePinnedDetail}
      onPointerEnter={openDetail}
      onPointerLeave={closeDetail}
    >
      <CardSurface cardRef={cardRef} foil={card.foil === true}>
        <CardFace
          artAttackAnimation={artAttackAnimation}
          card={card}
          colorLabel={colorLabel}
          jitterArt={jitterArt}
          statModifier={statModifier}
        />
        {card.foil && <CardFoil flashOnMount={flashFoilOnMount} />}
      </CardSurface>
      {detailVisible &&
        createPortal(
          <div
            ref={detailRef}
            id={detailId}
            className={`card-detail-popover card-detail-${colorClass} card-detail-popover-${detailPosition?.placement ?? 'right'}`}
            role="tooltip"
            style={{
              top: detailPosition?.top ?? 0,
              left: detailPosition?.left ?? 0,
              maxHeight: detailPosition?.maxHeight,
              visibility: detailPosition === null ? 'hidden' : 'visible',
            }}
          >
            <header className="card-title-row">
              <span className="card-color-cost">
                <span className="card-color">{colorLabel}</span>
                <span className="card-cost" aria-label={`コスト ${card.cost}`}>
                  {card.cost}
                </span>
              </span>
              <span className="card-kind">{KIND_LABELS[card.kind]}</span>
            </header>
            <h3>{card.name}</h3>
            {card.kind === 'creature' && (
              <dl className="card-stats">
                <div>
                  <dt>攻</dt>
                  <dd>{card.attack}</dd>
                </div>
                <div>
                  <dt>防</dt>
                  <dd>{card.defense}</dd>
                </div>
                <div>
                  <dt>進</dt>
                  <dd>{card.march}</dd>
                </div>
              </dl>
            )}
            {card.kind === 'creature' ? (
              card.abilities.length > 0 && (
                <dl className="card-ability-descriptions">
                  {card.abilities.map((ability, index) => (
                    <div key={`${ability.type}-${index}`}>
                      <dt>{formatAbility(ability)}</dt>
                      <dd>{describeAbility(ability)}</dd>
                    </div>
                  ))}
                </dl>
              )
            ) : (
              <p className="card-rules">{getRulesText(card)}</p>
            )}
          </div>,
          document.body,
        )}
    </article>
  )
}

export default CardView
