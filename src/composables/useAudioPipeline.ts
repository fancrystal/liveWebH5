/**
 * useAudioPipeline — persistent Web Audio mixing graph for the stream output.
 *
 * Why a persistent pipeline instead of swapping MediaStream tracks:
 *   - RTCPeerConnection senders bind the track at publish time; swapping tracks
 *     on the output MediaStream afterwards does NOT change what viewers hear.
 *   - MediaRecorder errors/stops when the recorded stream's track set changes.
 *
 * So the output stream carries ONE audio track for its entire life — the
 * destination of this graph — and audio sources (mic / video insert / screen
 * share) connect and disconnect dynamically:
 *
 *   mic        ──┐
 *   insert el  ──┼──► destNode ──► output track (never replaced)
 *   screen     ──┘        └ insert is also routed to ctx.destination
 *                           so the host hears the inserted video locally
 *
 * Module-level singleton: the AudioContext lives for the whole app session.
 * createMediaElementSource() can only ever be called once per media element
 * (Chrome keeps the binding even after a context closes), so element sources
 * are cached in a WeakMap and reused across live sessions.
 */

interface SourceHandle {
  /** Disconnect this source from the destination (and local monitor). */
  disconnect: () => void
}

let audioCtx: AudioContext | null = null
let destNode: MediaStreamAudioDestinationNode | null = null

/** Cached element sources — createMediaElementSource is one-shot per element. */
const elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

let micHandle:    SourceHandle | null = null
let insertHandle: SourceHandle | null = null
let screenHandle: SourceHandle | null = null

function ensureGraph(): { ctx: AudioContext; dest: MediaStreamAudioDestinationNode } {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new AudioContext()
    destNode = audioCtx.createMediaStreamDestination()
  }
  // All call paths are user-gesture driven, but resume defensively in case the
  // browser suspended the context (e.g. autoplay policy on early creation).
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return { ctx: audioCtx, dest: destNode! }
}

function connectStream(stream: MediaStream): SourceHandle | null {
  if (stream.getAudioTracks().length === 0) return null
  try {
    const { ctx, dest } = ensureGraph()
    const source = ctx.createMediaStreamSource(stream)
    const gain   = ctx.createGain()
    gain.gain.value = 1.0
    source.connect(gain)
    gain.connect(dest)
    return {
      disconnect: () => {
        try { source.disconnect() } catch { /* already disconnected */ }
        try { gain.disconnect() }   catch { /* already disconnected */ }
      },
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[AudioPipeline] connectStream failed:', e)
    return null
  }
}

function connectElement(el: HTMLMediaElement): SourceHandle | null {
  try {
    const { ctx, dest } = ensureGraph()
    let source = elementSources.get(el)
    if (!source) {
      source = ctx.createMediaElementSource(el)
      elementSources.set(el, source)
    }
    const gain = ctx.createGain()
    gain.gain.value = 1.0
    source.connect(gain)
    gain.connect(dest)
    // Local monitor: once captured, the element no longer plays through the
    // speakers on its own — route it back so the host can hear the insert.
    gain.connect(ctx.destination)
    return {
      disconnect: () => {
        try { source!.disconnect() } catch { /* already disconnected */ }
        try { gain.disconnect() }    catch { /* already disconnected */ }
      },
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[AudioPipeline] connectElement failed:', e)
    return null
  }
}

export function useAudioPipeline() {
  /**
   * The single audio track carried by the output stream for its entire life.
   * Lazily creates the graph on first call.
   */
  function getOutputTrack(): MediaStreamTrack | null {
    const { dest } = ensureGraph()
    return dest.stream.getAudioTracks()[0] ?? null
  }

  /** Route the microphone stream into the mix (null disconnects). */
  function setMic(stream: MediaStream | null) {
    micHandle?.disconnect()
    micHandle = stream ? connectStream(stream) : null
  }

  /** Route an inserted video element's audio into the mix (null disconnects). */
  function setInsert(el: HTMLMediaElement | null) {
    insertHandle?.disconnect()
    insertHandle = el ? connectElement(el) : null
  }

  /** Route screen-share (system/tab) audio into the mix (null disconnects). */
  function setScreen(stream: MediaStream | null) {
    screenHandle?.disconnect()
    screenHandle = stream ? connectStream(stream) : null
  }

  return { getOutputTrack, setMic, setInsert, setScreen }
}
