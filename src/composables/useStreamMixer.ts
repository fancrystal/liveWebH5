import { ref, shallowRef } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'
import { useCoStreamStore } from '@/stores/coStreamStore'
import { computeCoStreamLayout } from '@/utils/coStreamLayout'

/**
 * Composites whiteboard canvas + camera PiP + screen share +
 * co-stream participant videos into one MediaStream.
 */
export function useStreamMixer() {
  const mediaStore    = useMediaStore()
  const coStreamStore = useCoStreamStore()

  const outputCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const outputStream = shallowRef<MediaStream | null>(null)
  const isRunning    = ref(false)

  let camVideo:    HTMLVideoElement | null = null
  let screenVideo: HTMLVideoElement | null = null
  /** peerId → HTMLVideoElement */
  const participantVideos = new Map<string, HTMLVideoElement>()
  let animFrameId = 0

  function createVideoEl(stream: MediaStream): HTMLVideoElement {
    const v = document.createElement('video')
    v.srcObject = stream
    v.autoplay  = true
    v.muted     = true
    v.playsInline = true
    v.play().catch(() => {})
    return v
  }

  function start(whiteboardCanvas: HTMLCanvasElement, width = 1280, height = 720): MediaStream {
    if (isRunning.value) stop()
    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    outputCanvas.value = canvas
    const ctx = canvas.getContext('2d')!

    isRunning.value = true

    function draw() {
      if (!isRunning.value) return

      // 1. White background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      // 2. Whiteboard / document content
      try { ctx.drawImage(whiteboardCanvas, 0, 0, width, height) } catch { /* not ready */ }

      // 3. Screen share (full overlay when active)
      if (mediaStore.isScreenSharing && mediaStore.screenStream) {
        if (!screenVideo || screenVideo.srcObject !== mediaStore.screenStream) {
          screenVideo = createVideoEl(mediaStore.screenStream)
        }
        if (screenVideo.readyState >= 2) {
          ctx.drawImage(screenVideo, 0, 0, width, height)
        }
      } else {
        screenVideo = null
      }

      // 4. Co-stream participants (adaptive grid at bottom-left)
      const guests = coStreamStore.participantList
      if (guests.length > 0) {
        const cells = computeCoStreamLayout(guests.length, width, height)

        // Clean up stale video elements
        participantVideos.forEach((_, id) => {
          if (!guests.find(p => p.id === id)) {
            participantVideos.get(id)?.remove()
            participantVideos.delete(id)
          }
        })

        guests.forEach((p, i) => {
          const cell = cells[i]
          if (!cell) return

          if (p.stream) {
            let vid = participantVideos.get(p.id)
            if (!vid || vid.srcObject !== p.stream) {
              vid = createVideoEl(p.stream)
              participantVideos.set(p.id, vid)
            }
            if (vid.readyState >= 2) {
              ctx.drawImage(vid, cell.x, cell.y, cell.w, cell.h)
            } else {
              drawPlaceholder(ctx, cell, p.nickname)
            }
          } else {
            drawPlaceholder(ctx, cell, p.nickname)
          }

          // Cell border
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'
          ctx.lineWidth   = 2
          ctx.strokeRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2)

          // Name label
          const labelH = 22
          ctx.fillStyle = 'rgba(0,0,0,0.55)'
          ctx.fillRect(cell.x, cell.y + cell.h - labelH, cell.w, labelH)
          ctx.fillStyle = '#ffffff'
          ctx.font      = `12px sans-serif`
          ctx.textAlign    = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(
            p.nickname,
            cell.x + cell.w / 2,
            cell.y + cell.h - labelH / 2,
          )
        })

        // Reset text align for subsequent draws
        ctx.textAlign    = 'left'
        ctx.textBaseline = 'alphabetic'
      }

      // 5. Camera PiP (bottom-right, 22% width)
      if (mediaStore.isCameraOn && mediaStore.cameraStream) {
        if (!camVideo || camVideo.srcObject !== mediaStore.cameraStream) {
          camVideo = createVideoEl(mediaStore.cameraStream)
        }
        if (camVideo.readyState >= 2) {
          const pw = Math.round(width * 0.22)
          const ph = Math.round(pw * 9 / 16)
          const px = width - pw - 16
          const py = height - ph - 16
          ctx.save()
          ctx.translate(px + pw, py)
          ctx.scale(-1, 1)
          ctx.drawImage(camVideo, 0, 0, pw, ph)
          ctx.restore()

          ctx.strokeStyle = 'rgba(255,255,255,0.3)'
          ctx.lineWidth   = 2
          ctx.beginPath()
          ctx.roundRect(px, py, pw, ph, 6)
          ctx.stroke()
        }
      } else {
        camVideo = null
      }

      animFrameId = requestAnimationFrame(draw)
    }

    draw()

    // Assemble output stream
    const tracks: MediaStreamTrack[] = []
    const videoTrack = canvas.captureStream(30).getVideoTracks()[0]
    if (videoTrack) tracks.push(videoTrack)
    if (mediaStore.micStream) {
      mediaStore.micStream.getAudioTracks().forEach(t => tracks.push(t))
    }

    const stream = new MediaStream(tracks)
    outputStream.value = stream
    return stream
  }

  function drawPlaceholder(
    ctx: CanvasRenderingContext2D,
    cell: { x: number; y: number; w: number; h: number },
    nickname: string,
  ) {
    ctx.fillStyle = '#2a2a2a'
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
    ctx.fillStyle = '#555'
    ctx.font = `${Math.round(cell.h * 0.3)}px sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(nickname[0] ?? '?', cell.x + cell.w / 2, cell.y + cell.h / 2)
  }

  function stop() {
    isRunning.value = false
    cancelAnimationFrame(animFrameId)
    // Only stop the canvas video track — mic tracks belong to mediaStore and must not be stopped here
    outputStream.value?.getVideoTracks().forEach(t => t.stop())
    outputStream.value   = null
    outputCanvas.value   = null
    camVideo             = null
    screenVideo          = null
    participantVideos.forEach(v => v.remove())
    participantVideos.clear()
  }

  function updateAudio() {
    if (!outputStream.value) return
    outputStream.value.getAudioTracks().forEach(t => outputStream.value!.removeTrack(t))
    if (mediaStore.micStream) {
      mediaStore.micStream.getAudioTracks().forEach(t => outputStream.value!.addTrack(t))
    }
  }

  return { outputCanvas, outputStream, isRunning, start, stop, updateAudio }
}
