import { describe, expect, it } from 'vitest'
import { assertValidGameState, GameManager } from './GameManager'
import { advanceTitleDemoMatch, createTitleDemoMatch, getTitleDemoFrame } from './titleDemo'

const seededRandom = () => {
  let seed = 12345
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

describe('title background demo', () => {
  it('chooses different decks and sends a valid serializable game to the renderer', () => {
    const match = createTitleDemoMatch(seededRandom())
    expect(match.deckIds.playerA).not.toBe(match.deckIds.playerB)
    const frame = structuredClone(getTitleDemoFrame(match))
    expect(() => assertValidGameState(frame.state)).not.toThrow()
    expect(frame.matchNumber).toBe(1)
    expect(frame.actionCount).toBe(0)
    expect(frame.finished).toBe(false)
    expect(frame).not.toHaveProperty('ais')
  })

  it('plays both seats, resolves combat, and starts another match after the result', () => {
    const random = seededRandom()
    let match = createTitleDemoMatch(random)
    const actors = new Set<string>()
    let sawCombat = false
    for (let step = 0; step < 1000 && !getTitleDemoFrame(match).finished; step += 1) {
      const wasResolving = match.manager.state.pendingCombat !== null
      match = advanceTitleDemoMatch(match, random)
      actors.add(match.lastActor)
      if (wasResolving) {
        sawCombat = true
        expect(match.lastAction?.type).toBe('finishCombat')
        expect(match.manager.state.pendingCombat).toBeNull()
      }
    }
    expect(actors).toEqual(new Set(['playerA', 'playerB']))
    expect(sawCombat).toBe(true)
    expect(GameManager.getWinner(match.manager)).not.toBeNull()
    expect(getTitleDemoFrame(match).finished).toBe(true)

    const next = advanceTitleDemoMatch(match, random)
    expect(next.matchNumber).toBe(2)
    expect(next.actionCount).toBe(0)
    expect(next.lastAction).toBeNull()
    expect(next.ais.playerA).not.toBe(match.ais.playerA)
    expect(next.ais.playerB).not.toBe(match.ais.playerB)
    expect(GameManager.getWinner(next.manager)).toBeNull()
    expect(() => assertValidGameState(next.manager.state)).not.toThrow()
  }, 20_000)

  it('moves on when an unusually long match reaches the action limit', () => {
    const match = { ...createTitleDemoMatch(seededRandom()), actionCount: 1000 }
    expect(getTitleDemoFrame(match).finished).toBe(true)
    expect(advanceTitleDemoMatch(match, seededRandom()).matchNumber).toBe(2)
  })

  it('moves on when a defensive match reaches the turn limit', () => {
    const match = createTitleDemoMatch(seededRandom())
    match.manager = GameManager.from({ ...match.manager.state, turn: 200 })
    expect(getTitleDemoFrame(match).finished).toBe(true)
    expect(advanceTitleDemoMatch(match, seededRandom()).matchNumber).toBe(2)
  })
})
