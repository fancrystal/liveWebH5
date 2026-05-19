/**
 * Timer Web Worker
 * Runs setInterval off the main thread, immune to Chrome background tab throttling.
 * Main thread receives 'tick' messages and calls draw().
 *
 * Messages IN:
 *   { type: 'start', interval: number }  — start ticking every `interval` ms
 *   { type: 'stop' }                     — stop ticking
 *
 * Messages OUT:
 *   { type: 'tick' }
 */
let timer = null

self.onmessage = (e) => {
  if (e.data.type === 'start') {
    if (timer !== null) clearInterval(timer)
    const interval = e.data.interval || 33
    timer = setInterval(() => self.postMessage({ type: 'tick' }), interval)
  } else if (e.data.type === 'stop') {
    if (timer !== null) { clearInterval(timer); timer = null }
  }
}
