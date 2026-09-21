import { advanceTitleDemoMatch, createTitleDemoMatch, getTitleDemoFrame } from '../game/titleDemo'

let match = createTitleDemoMatch()

self.onmessage = (event: MessageEvent<'step'>) => {
  if (event.data !== 'step') return
  match = advanceTitleDemoMatch(match)
  self.postMessage(getTitleDemoFrame(match))
}

self.postMessage(getTitleDemoFrame(match))
