import { ref } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useToast } from '@/composables/useToast'
import { supportsRTMP } from '@/utils/browser'
import type { NetQuality } from '@/types/stream'

// ─── Reconnect ───────────────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS = 4
const RECONNECT_BASE_MS      = 3_000

// ─── 30-min WebM cycle (Risk 2) ──────────────────────────────────────────────
// Restarting MediaRecorder on the SAME WebSocket sends a new WebM EBML header
// mid-stream, which confuses ffmpeg and causes Opus parse errors ("packet header
// error", "file ended prematurely"). Fix: close and reopen the WebSocket so that
// rtmp-relay launches a fresh ffmpeg process for each clean WebM stream.
const RECORDER_RESTART_MS    = 30 * 60 * 1_000   // 30 min
const PLANNED_RESTART_DELAY  = 300                // ms to flush final chunk before closing

// ─── Backpressure thresholds (Risk 3) ────────────────────────────────────────
// WebSocket.bufferedAmount tracks bytes queued in the browser's TCP send buffer.
// Live streaming drops stale frames rather than let viewers receive old content.
const HIGH_WATER_MARK   = 2 * 1024 * 1024    // 2 MB  — drop chunk, mark POOR
const WARN_WATER_MARK   = 512 * 1024          // 512 KB — mark DEGRADED
const LOW_WATER_MARK    = 64 * 1024           // 64 KB  — mark GOOD

// ─── Weak-network recovery ───────────────────────────────────────────────────
// If the buffer stays > HIGH_WATER_MARK for this long we trigger a planned
// reconnect, which drops the stale TCP buffer and gives ffmpeg a fresh stream.
const POOR_SUSTAIN_MS        = 8_000   // 8 s of sustained POOR before recovery reconnect
const RECOVERY_THROTTLE_MS   = 60_000  // at most one recovery reconnect per minute

/**
 * RTMP publisher: MediaRecorder → WebSocket → server-side ffmpeg → RTMP.
 *
 * Improvements over naïve implementation:
 *
 * [Risk 2] 30-min planned WebSocket cycle
 *   Instead of restarting MediaRecorder on the same socket (corrupt ffmpeg input),
 *   we close and reopen the WebSocket, letting ffmpeg start fresh.
 *
 * [Risk 3] Backpressure-aware sending
 *   We check socket.bufferedAmount before every chunk. Above HIGH_WATER_MARK we
 *   drop the chunk (live content must stay real-time). Sustained overflow triggers
 *   a planned reconnect to flush the stale TCP buffer.
 *
 * [Weak net] Recovery strategy
 *   - DEGRADED (512KB–2MB buffer): reduce no data but warn user
 *   - POOR (> 2MB buffer): drop chunks; after 8 s trigger reconnect to flush
 *   - Recovery: reconnect immediately (no exponential backoff) → fresh stream
 */
export function useRTMP() {
  const streamStore = useStreamStore()
  const toast       = useToast()

  const ws          = ref<WebSocket | null>(null)
  const recorder    = ref<MediaRecorder | null>(null)
  const isConnected = ref(false)
  const error       = ref<string | null>(null)
  const netQuality  = ref<NetQuality>('good')

  // WS endpoint: env var takes priority; fallback auto-matches page protocol
  // so an HTTPS page always uses wss:// (avoids Mixed Content errors).
  const WS_ENDPOINT = import.meta.env.VITE_RTMP_WS_URL
    || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/rtmp-relay`

  const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'

  // ── Internal state ──────────────────────────────────────────────────────────
  let activeStream:         MediaStream | null = null
  let reconnectTimer:       ReturnType<typeof setTimeout> | null = null
  let restartTimer:         ReturnType<typeof setTimeout> | null = null
  let reconnectCount        = 0
  let stopped               = false
  let isPlannedRestart      = false      // set before intentional WS close

  // Backpressure tracking (reset per-socket in startRecorder)
  let poorSinceMs:          number | null = null  // when buffered first exceeded HIGH
  let lastRecoveryReconnect = 0                   // timestamp — throttle recovery reconnects

  // ─── Network quality ────────────────────────────────────────────────────────

  function setNetQuality(q: NetQuality) {
    if (netQuality.value === q) return          // no change, skip reactive update
    const prev = netQuality.value
    netQuality.value = q
    // eslint-disable-next-line no-console
    console.log(`[RTMP] network quality: ${prev} → ${q}`)
    if (q === 'degraded') toast.warn('网络质量下降，推流可能出现轻微延迟')
    if (q === 'poor')     toast.error('网络较差，正在丢弃部分帧以维持实时性')
    if (q === 'good' && prev !== 'good') toast.success('网络已恢复，推流正常')
  }

  // ─── MediaRecorder ──────────────────────────────────────────────────────────

  function startRecorder(stream: MediaStream, socket: WebSocket) {
    if (recorder.value?.state !== 'inactive') {
      recorder.value?.stop()
    }
    // Reset backpressure state for each new socket
    poorSinceMs = null

    const mimeType = getSupportedMimeType()
    if (VERBOSE_LOG) {
      // eslint-disable-next-line no-console
      console.log('[RTMP] startRecorder', {
        mimeType,
        videoTracks: stream.getVideoTracks().map(t => ({
          label: t.label, readyState: t.readyState, settings: t.getSettings(),
        })),
        videoBitrate: streamStore.config.videoBitrate,
        audioBitrate: streamStore.config.audioBitrate,
      })
    }

    const rec = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: streamStore.config.videoBitrate * 1_000,
      audioBitsPerSecond: streamStore.config.audioBitrate * 1_000,
    })
    recorder.value = rec

    // Throttled diagnostics
    let chunkBytes   = 0
    let chunkCount   = 0
    let lastChunkLog = performance.now()

    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return
      if (socket.readyState !== WebSocket.OPEN) {
        if (VERBOSE_LOG) {
          // eslint-disable-next-line no-console
          console.warn('[RTMP] socket not OPEN, dropping chunk', { state: socket.readyState })
        }
        return
      }

      // ── Backpressure guard (Risk 3) ─────────────────────────────────────────
      const buffered = socket.bufferedAmount
      const now      = Date.now()

      if (buffered > HIGH_WATER_MARK) {
        // Buffer overflowing — drop this chunk (stale live content is worse than gaps)
        if (poorSinceMs === null) {
          poorSinceMs = now
          setNetQuality('poor')
          // eslint-disable-next-line no-console
          console.warn('[RTMP] Buffer overflow — dropping chunks.',
            'buffered=' + (buffered / 1024).toFixed(0) + 'KB')
        }

        // Sustained overflow → trigger recovery reconnect to flush stale TCP buffer
        if (
          now - poorSinceMs >= POOR_SUSTAIN_MS &&
          now - lastRecoveryReconnect > RECOVERY_THROTTLE_MS &&
          !isPlannedRestart
        ) {
          lastRecoveryReconnect = now
          // eslint-disable-next-line no-console
          console.warn('[RTMP] Sustained poor network for',
            ((now - poorSinceMs) / 1000).toFixed(1) + 's — recovery reconnect')
          toast.warn('网络持续较差，正在重连以清空积压缓冲...')
          isPlannedRestart = true           // reconnect immediately, no backoff
          socket.close(1000, 'network-recovery')
        }
        return    // always drop the chunk when buffer is overflowing
      }

      // Buffer draining: update quality
      poorSinceMs = null
      if (buffered > WARN_WATER_MARK) {
        setNetQuality('degraded')
      } else if (buffered < LOW_WATER_MARK) {
        setNetQuality('good')
      }
      // ────────────────────────────────────────────────────────────────────────

      socket.send(e.data)

      chunkBytes += e.data.size
      chunkCount += 1
      const perfNow = performance.now()
      if (VERBOSE_LOG && perfNow - lastChunkLog >= 1_000) {
        // eslint-disable-next-line no-console
        console.log('[RTMP] chunks/s', {
          chunks: chunkCount,
          kbps:   ((chunkBytes * 8) / 1_000).toFixed(0),
          wsBuffered: buffered,
          quality: netQuality.value,
        })
        chunkBytes   = 0
        chunkCount   = 0
        lastChunkLog = perfNow
      }
    }

    rec.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.error('[RTMP] MediaRecorder error', e)
    }
    rec.start(100)
  }

  /**
   * Schedule a planned WebSocket cycle every 30 min (Risk 2 fix).
   *
   * We close the WebSocket instead of calling recorder.stop()+start() on the
   * same socket. This gives rtmp-relay/ffmpeg a clean restart:
   *   1. requestData()  — flush any buffered recorder data
   *   2. 300 ms delay   — let final chunk clear the TCP buffer
   *   3. ws.close(1000) — server sees clean EOF, ffmpeg exits cleanly
   *   4. onclose        — isPlannedRestart=true → immediate reconnect, no backoff
   *   5. new WebSocket  — new ffmpeg process, fresh WebM stream
   */
  function scheduleRecorderRestart() {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      if (stopped || !ws.value || ws.value.readyState !== WebSocket.OPEN) return
      // eslint-disable-next-line no-console
      console.log('[RTMP] 30-min planned restart: cycling WebSocket for clean ffmpeg stream')
      recorder.value?.requestData()                // flush pending encoder data
      setTimeout(() => {
        if (!stopped && ws.value) {
          isPlannedRestart = true
          ws.value.close(1000, 'planned-restart')
        }
      }, PLANNED_RESTART_DELAY)
    }, RECORDER_RESTART_MS)
  }

  function getSupportedMimeType(): string {
    const candidates = [
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ]
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
  }

  // ─── WebSocket lifecycle ─────────────────────────────────────────────────────

  function _connect(stream: MediaStream) {
    const { rtmpUrl } = streamStore.config
    if (!rtmpUrl) { error.value = 'RTMP 推流地址未配置'; return }

    const url = `${WS_ENDPOINT}?rtmp=${encodeURIComponent(rtmpUrl)}`
    // RTMP URLs usually embed the stream key — never log them in full.
    // eslint-disable-next-line no-console
    console.log('[RTMP] connecting WS', {
      endpoint: WS_ENDPOINT,
      attempt:  reconnectCount,
      ...(VERBOSE_LOG ? { url } : {}),
    })
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    ws.value = socket

    socket.onopen = () => {
      // eslint-disable-next-line no-console
      console.log('[RTMP] WS open')
      isConnected.value = true
      reconnectCount    = 0
      error.value       = null
      setNetQuality('good')
      startRecorder(stream, socket)
      scheduleRecorderRestart()
    }

    socket.onerror = (e) => {
      // eslint-disable-next-line no-console
      console.error('[RTMP] WS error', e)
      error.value = 'WebSocket 连接失败'
    }

    socket.onclose = (e) => {
      // eslint-disable-next-line no-console
      console.warn('[RTMP] WS close', {
        code: e.code, reason: e.reason, wasClean: e.wasClean, isPlannedRestart,
      })
      isConnected.value = false
      if (recorder.value?.state !== 'inactive') recorder.value?.stop()
      recorder.value = null

      if (stopped) return

      if (isPlannedRestart) {
        // Planned restart (30-min cycle or network-recovery):
        // reconnect immediately with NO exponential backoff.
        // The 500 ms delay lets the server clean up its ffmpeg process.
        isPlannedRestart = false
        // eslint-disable-next-line no-console
        console.log('[RTMP] Planned restart: reconnecting immediately (no backoff)')
        setTimeout(() => {
          if (!stopped && activeStream) _connect(activeStream)
        }, 500)
        return
      }

      // Unexpected disconnect → exponential backoff
      if (!e.wasClean) {
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
        toast.error('RTMP 推流多次重连失败，请检查网络或推流地址')
        error.value = '推流断线，重连次数已达上限'
        setNetQuality('poor')
      }
      return
    }

    const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectCount)
    reconnectCount++
    toast.warn(
      `RTMP 推流中断，${Math.round(delay / 1_000)} 秒后重连` +
      `（第 ${reconnectCount}/${MAX_RECONNECT_ATTEMPTS} 次）`,
    )

    reconnectTimer = setTimeout(() => {
      if (stopped || !activeStream) return
      ws.value?.close()
      ws.value = null
      _connect(activeStream)
    }, delay)
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Start publishing. Throws on synchronous validation failure (unsupported
   * browser / missing RTMP URL) so the caller can roll back its live state —
   * a silent return here would leave the UI stuck in "直播中" with no stream.
   */
  function publish(stream: MediaStream) {
    if (!supportsRTMP()) {
      const msg = '当前浏览器不支持 RTMP 推流（请使用 Chrome / Edge 或切换到 WebRTC 模式）'
      error.value = msg
      throw new Error(msg)
    }
    if (!streamStore.config.rtmpUrl) {
      const msg = 'RTMP 推流地址未配置'
      error.value = msg
      throw new Error(msg)
    }
    stopped          = false
    reconnectCount   = 0
    isPlannedRestart = false
    poorSinceMs      = null
    activeStream     = stream
    error.value      = null
    _connect(stream)
  }

  function stop() {
    stopped = true
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (restartTimer)   { clearTimeout(restartTimer);   restartTimer   = null }
    if (recorder.value?.state !== 'inactive') recorder.value?.stop()
    ws.value?.close()
    recorder.value    = null
    ws.value          = null
    activeStream      = null
    isConnected.value = false
    netQuality.value  = 'good'
  }

  return { isConnected, error, netQuality, publish, stop }
}
