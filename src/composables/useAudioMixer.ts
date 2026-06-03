/**
 * useAudioMixer
 *
 * Mixes microphone audio and video-insert audio into a single MediaStreamTrack
 * using the Web Audio API.
 *
 * Usage:
 *   const mixer = useAudioMixer()
 *   const track = mixer.mix(micStream, videoEl)  // call when insert starts
 *   outputStream.addTrack(track)
 *   // ... later ...
 *   mixer.stop()  // call when insert ends or stream stops
 */

import { ref } from 'vue'

export function useAudioMixer() {
  let audioCtx:  AudioContext | null = null
  let destNode:  MediaStreamAudioDestinationNode | null = null
  // Guard against concurrent mix() calls while a previous AudioContext is
  // still closing (close() is async). If a new mix() arrives before the old
  // context has fully closed, we skip re-entrant cleanup.
  let isStopping = false

  const mixedTrack = ref<MediaStreamTrack | null>(null)
  const isActive   = ref(false)

  /**
   * Start mixing.
   * @param micStream  - The microphone MediaStream (may be null if mic is off)
   * @param videoEl    - The <video> element playing the inserted video
   * @returns The mixed audio track, or null if mixing is not possible
   */
  function mix(
    micStream: MediaStream | null,
    videoEl:   HTMLVideoElement,
  ): MediaStreamTrack | null {
    // Synchronously clear state before creating a new context, even if the
    // previous close() hasn't resolved yet — the old context will still close
    // asynchronously, we just stop referencing it.
    if (audioCtx && !isStopping) {
      isStopping = true
      const ctxToClose = audioCtx
      audioCtx = null
      destNode = null
      ctxToClose.close().catch(() => {}).finally(() => { isStopping = false })
    }

    mixedTrack.value = null
    isActive.value   = false

    try {
      audioCtx = new AudioContext()
      destNode = audioCtx.createMediaStreamDestination()

      // Route microphone → destination
      if (micStream && micStream.getAudioTracks().length > 0) {
        const micSource = audioCtx.createMediaStreamSource(micStream)
        const micGain   = audioCtx.createGain()
        micGain.gain.value = 1.0
        micSource.connect(micGain)
        micGain.connect(destNode)
      }

      // Route video audio → destination.
      // createMediaElementSource captures the element's audio and routes it
      // through the AudioContext; we must also connect to audioCtx.destination
      // so the host can hear the video locally.
      const videoSource = audioCtx.createMediaElementSource(videoEl)
      const videoGain   = audioCtx.createGain()
      videoGain.gain.value = 1.0
      videoSource.connect(videoGain)
      videoGain.connect(destNode)
      videoGain.connect(audioCtx.destination)

      const track = destNode.stream.getAudioTracks()[0] ?? null
      mixedTrack.value = track
      isActive.value   = true
      return track
    } catch (e: unknown) {
      // Surface the error — silent failure makes debugging very hard
      // eslint-disable-next-line no-console
      console.error('[AudioMixer] mix() failed:', e)
      stop()
      return null
    }
  }

  /** Stop mixing and release AudioContext resources. */
  function stop() {
    if (audioCtx) {
      isStopping = true
      const ctxToClose = audioCtx
      audioCtx = null
      ctxToClose.close().catch(() => {}).finally(() => { isStopping = false })
    }
    destNode         = null
    mixedTrack.value = null
    isActive.value   = false
  }

  return { mix, stop, mixedTrack, isActive }
}
