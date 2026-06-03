import { ref, shallowRef } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'
import { useCoStreamStore } from '@/stores/coStreamStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useStreamStore } from '@/stores/streamStore'
import { computeCoStreamLayout } from '@/utils/coStreamLayout'

/**
 * Composites whiteboard canvas + camera PiP + screen share +
 * co-stream participant videos into one MediaStream.
 */
export function useStreamMixer() {
  const mediaStore    = useMediaStore()
  const coStreamStore = useCoStreamStore()
  const wbStore       = useWhiteboardStore()
  const streamStore   = useStreamStore()

  const outputCanvas = shallowRef<HTMLCanvasElement | null>(null)
  const outputStream = shallowRef<MediaStream | null>(null)
  const isRunning    = ref(false)

  let camVideo:         HTMLVideoElement | null = null
  let screenVideo:      HTMLVideoElement | null = null
  /** peerId → HTMLVideoElement */
  const participantVideos = new Map<string, HTMLVideoElement>()
  // Use a Web Worker for the draw timer so Chrome background-tab throttling
  // (which slows setInterval to ~1s in hidden tabs) doesn't drop stream framerate.
  let drawWorker: Worker | null = null

  // ---- Diagnostic logging (throttled to ~1Hz) ----
  // Set VITE_VERBOSE_LOG=true in .env to enable the per-tick / per-PiP snapshots.
  // Lifecycle events (start/stop) are always logged.
  const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'
  let tickCount   = 0
  let lastLogTime = 0
  const LOG_INTERVAL_MS = 1000

  function createVideoEl(stream: MediaStream): HTMLVideoElement {
    const v = document.createElement('video')
    v.srcObject = stream
    v.autoplay  = true
    v.muted     = true
    v.playsInline = true
    v.play().catch(() => {})
    return v
  }

  function start(
    whiteboardCanvas: HTMLCanvasElement,
    width = 1280,
    height = 720,
    docCanvasGetter: () => HTMLCanvasElement | null = () => null,
    videoInsertGetter: () => HTMLVideoElement | null = () => null,
  ): MediaStream {
    if (isRunning.value) stop()
    const canvas = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height
    outputCanvas.value = canvas
    const ctx = canvas.getContext('2d')!

    const TARGET_FPS = streamStore.config.frameRate
    const FRAME_MS   = 1000 / TARGET_FPS

    isRunning.value = true

    // Pre-create screenVideo so it's ready before the first frame
    if (mediaStore.isScreenSharing && mediaStore.screenStream) {
      screenVideo = createVideoEl(mediaStore.screenStream)
    }
    if (mediaStore.isCameraOn && mediaStore.cameraStream) {
      camVideo = createVideoEl(mediaStore.cameraStream)
    }

    // eslint-disable-next-line no-console
    console.log('[Mixer] start()', {
      output: { width, height },
      whiteboardCanvas: {
        width: whiteboardCanvas.width,
        height: whiteboardCanvas.height,
        clientWidth: whiteboardCanvas.clientWidth,
        clientHeight: whiteboardCanvas.clientHeight,
      },
      hasCamera: mediaStore.isCameraOn,
      hasScreen: mediaStore.isScreenSharing,
      hasMic: !!mediaStore.micStream,
    })

    function draw() {
      if (!isRunning.value) return
      tickCount++

      // Throttled diagnostic snapshot (once per second, only when verbose)
      const now = performance.now()
      const shouldLog = VERBOSE_LOG && now - lastLogTime >= LOG_INTERVAL_MS
      if (shouldLog) {
        lastLogTime = now
        // eslint-disable-next-line no-console
        console.log('[Mixer] tick', {
          ticks: tickCount,
          mode: wbStore.activeMode,
          wbCanvas: { w: whiteboardCanvas.width, h: whiteboardCanvas.height },
          cam: camVideo ? {
            ready: camVideo.readyState,
            vw: camVideo.videoWidth,
            vh: camVideo.videoHeight,
          } : null,
          screen: screenVideo ? {
            ready: screenVideo.readyState,
            vw: screenVideo.videoWidth,
            vh: screenVideo.videoHeight,
          } : null,
          guests: coStreamStore.participantList.length,
        })
      }

      // 1. White background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      // 2. Whiteboard / document content
      if (wbStore.activeMode === 'document') {
        // Document mode: render PDF page canvas (object-fit:contain with dark bg)
        const docCanvas = docCanvasGetter()
        if (docCanvas) {
          try {
            ctx.fillStyle = '#2a2a2a'
            ctx.fillRect(0, 0, width, height)
            // Scale PDF canvas to fit output maintaining aspect ratio
            const dw = docCanvas.width
            const dh = docCanvas.height
            const scale = Math.min(width / dw, height / dh)
            const dstW  = Math.round(dw * scale)
            const dstH  = Math.round(dh * scale)
            const dstX  = Math.round((width  - dstW) / 2)
            const dstY  = Math.round((height - dstH) / 2)
            ctx.drawImage(docCanvas, dstX, dstY, dstW, dstH)
          } catch { /* not ready */ }
        }
        // Also draw whiteboard annotation overlay on top of PDF
        try { ctx.drawImage(whiteboardCanvas, 0, 0, width, height) } catch { /* not ready */ }
      } else {
        // Whiteboard / screen-share mode
        // Fabric.js uses two stacked canvases:
        //   lower-canvas — committed strokes and objects
        //   upper-canvas — in-progress drawing preview (active path during freehand)
        // We must draw both or the live stroke won't appear in the stream.
        try { ctx.drawImage(whiteboardCanvas, 0, 0, width, height) } catch { /* not ready */ }
        try {
          const upperCanvas = whiteboardCanvas.nextElementSibling as HTMLCanvasElement | null
          if (upperCanvas?.tagName === 'CANVAS') {
            ctx.drawImage(upperCanvas, 0, 0, width, height)
          }
        } catch { /* upper canvas not ready */ }
      }

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

      // 3.5 Video insert — FULLSCREEN mode only
      // Drawn here so it covers whiteboard/screen-share but stays UNDER
      // co-stream participants (step 4) and camera PiP (step 5).
      const insertEl   = videoInsertGetter()
      const insertMode = mediaStore.videoInsertMode
      const insertReady = insertEl instanceof HTMLVideoElement
        && insertEl.readyState >= 2
        && insertEl.videoWidth > 0

      if (insertReady && insertMode === 'fullscreen') {
        try { ctx.drawImage(insertEl, 0, 0, width, height) } catch { /* not ready */ }
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

      // 4.5 Video insert — PIP mode
      // Drawn AFTER co-stream so it appears on top of participant tiles,
      // and BEFORE camera PiP so the camera stays the topmost overlay.
      // Position/size mirrors the UI exactly via mediaStore.videoPip percentages.
      if (insertReady && insertMode === 'pip') {
        const vPip = mediaStore.videoPip
        const pipX = Math.round(vPip.xPct * width)
        const pipY = Math.round(vPip.yPct * height)
        const pipW = Math.round(vPip.wPct * width)
        const pipH = Math.round(vPip.hPct * height)
        const r    = 8

        ctx.save()
        ctx.beginPath()
        ctx.roundRect(pipX, pipY, pipW, pipH, r)
        ctx.clip()
        try { ctx.drawImage(insertEl!, pipX, pipY, pipW, pipH) } catch { /* not ready */ }
        ctx.restore()

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth   = 2
        ctx.beginPath()
        ctx.roundRect(pipX, pipY, pipW, pipH, r)
        ctx.stroke()
      }

      // 5. Camera PiP — position/size mirrors the UI exactly
      if (mediaStore.isCameraOn && mediaStore.cameraStream) {
        if (!camVideo || camVideo.srcObject !== mediaStore.cameraStream) {
          camVideo = createVideoEl(mediaStore.cameraStream)
        }
        if (camVideo.readyState >= 2) {
          // mediaStore.cameraPip is stored as percentages of the UI canvas
          // container, so multiplying by output dimensions yields a PiP that
          // mirrors the UI proportions regardless of UI canvas size.
          const pip = mediaStore.cameraPip
          const px  = Math.round(pip.xPct * width)
          const py  = Math.round(pip.yPct * height)
          const pw  = Math.round(pip.wPct * width)
          const ph  = Math.round(pip.hPct * height)

          if (shouldLog) {
            // eslint-disable-next-line no-console
            console.log('[Mixer] cam PiP', {
              outputWH: { w: width, h: height },
              pip,
              dst: { px, py, pw, ph },
              warn: (pw > width * 0.6 || ph > height * 0.6) ? 'PIP_TOO_LARGE' : undefined,
            })
          }

          // Draw with object-fit:cover to avoid stretching non-16:9 cameras
          const vw = camVideo.videoWidth  || pw
          const vh = camVideo.videoHeight || ph
          const videoAspect  = vw / vh
          const targetAspect = pw / ph
          let sx: number, sy: number, sw: number, sh: number
          if (videoAspect > targetAspect) {
            // Video is wider — crop left/right
            sh = vh
            sw = sh * targetAspect
            sx = (vw - sw) / 2
            sy = 0
          } else {
            // Video is taller — crop top/bottom
            sw = vw
            sh = sw / targetAspect
            sx = 0
            sy = (vh - sh) / 2
          }

          const radius = 6
          // Clip to rounded rect — matches CSS border-radius: 8px on CameraPreview
          ctx.save()
          ctx.beginPath()
          ctx.roundRect(px, py, pw, ph, radius)
          ctx.clip()
          // Draw horizontally flipped (mirrors the CSS scaleX(-1) on the <video>)
          ctx.translate(px + pw, py)
          ctx.scale(-1, 1)
          ctx.drawImage(camVideo, sx, sy, sw, sh, 0, 0, pw, ph)
          ctx.restore()

          // Border — matches CSS border: 2px solid rgba(255,255,255,0.12)
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'
          ctx.lineWidth   = 2
          ctx.beginPath()
          ctx.roundRect(px, py, pw, ph, radius)
          ctx.stroke()
        }
      } else {
        camVideo = null
      }

    }

    // Use a Web Worker timer instead of setInterval/rAF.
    // Chrome throttles both to ~1s intervals when the tab is hidden (background tab),
    // which causes the stream to drop to ~1fps overnight or when the page is not focused.
    // Web Workers run at full speed regardless of tab visibility.
    drawWorker = new Worker('/timer-worker.js')
    drawWorker.onmessage = (e) => { if (e.data.type === 'tick') draw() }
    drawWorker.postMessage({ type: 'start', interval: FRAME_MS })

    // Assemble output stream
    const tracks: MediaStreamTrack[] = []
    const videoTrack = canvas.captureStream(TARGET_FPS).getVideoTracks()[0]
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
    if (drawWorker) {
      drawWorker.postMessage({ type: 'stop' })
      drawWorker.terminate()
      drawWorker = null
    }
    // Only stop the canvas video track — mic tracks belong to mediaStore and must not be stopped here
    outputStream.value?.getVideoTracks().forEach(t => t.stop())
    outputStream.value   = null
    outputCanvas.value   = null
    camVideo    = null
    screenVideo = null
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
