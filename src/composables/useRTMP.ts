import { ref } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useToast } from '@/composables/useToast'
import { supportsRTMP } from '@/utils/browser'

const MAX_RECONNECT_ATTEMPTS = 4
const RECONNECT_BASE_MS      = 3000
// Restart MediaRecorder every 30 min to prevent WebM timestamp accumulation
// causing Opus audio parse errors in long-running streams
const RECORDER_RESTART_MS    = 30 * 60 * 1000

/**
 * RTMP publisher via MediaRecorder → WebSocket → server-side ffmpeg pipeline.
 * Server receives WebM chunks and pipes to: ffmpeg -i pipe:0 -f flv rtmp://...
 */
export function useRTMP() {
  const streamStore = useStreamStore()
  const toast       = useToast()

  const ws          = ref<WebSocket | null>(null)
  const recorder    = ref<MediaRecorder | null>(null)
  const isConnected = ref(false)
  const error       = ref<string | null>(null)

  const WS_ENDPOINT = import.meta.env.VITE_RTMP_WS_URL ?? 'ws://localhost:8080/rtmp-relay'

  let activeStream:    MediaStream | null = null
  let reconnectTimer:  ReturnType<typeof setTimeout> | null = null
  let restartTimer:    ReturnType<typeof setTimeout> | null = null
  let reconnectCount   = 0
  let stopped          = false

  function startRecorder(stream: MediaStream, socket: WebSocket) {
    // Stop previous recorder if any (for periodic restarts)
    if (recorder.value && recorder.value.state !== 'inactive') {
      recorder.value.stop()
    }

    const mimeType = getSupportedMimeType()
    const rec = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: streamStore.config.videoBitrate * 1000,
      audioBitsPerSecond: streamStore.config.audioBitrate * 1000,
    })
    recorder.value = rec

    rec.ondataavailable = (e) => {
      if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(e.data)
      }
    }

    rec.start(100)
  }

  function scheduleRecorderRestart(stream: MediaStream, socket: WebSocket) {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      if (stopped || socket.readyState !== WebSocket.OPEN) return
      // Seamless restart: new recorder picks up immediately
      startRecorder(stream, socket)
      scheduleRecorderRestart(stream, socket)
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

  function _connect(stream: MediaStream) {
    const { rtmpUrl } = streamStore.config
    if (!rtmpUrl) { error.value = 'RTMP 推流地址未配置'; return }

    const url    = `${WS_ENDPOINT}?rtmp=${encodeURIComponent(rtmpUrl)}`
    const socket = new WebSocket(url)
    ws.value     = socket

    socket.onopen = () => {
      isConnected.value = true
      reconnectCount    = 0

      startRecorder(stream, socket)

      // Periodically restart MediaRecorder to reset WebM timestamps,
      // preventing Opus audio corruption in long-running streams
      scheduleRecorderRestart(stream, socket)
    }

    socket.onerror = () => {
      error.value = 'WebSocket 连接失败'
    }

    socket.onclose = (e) => {
      isConnected.value = false
      recorder.value?.stop()
      recorder.value = null

      if (!stopped && !e.wasClean) {
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
        toast.error('RTMP 推流多次重连失败，请检查网络或推流地址')
        error.value = '推流断线，重连次数已达上限'
      }
      return
    }

    const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectCount)
    reconnectCount++

    toast.warn(`RTMP 推流中断，${Math.round(delay / 1000)} 秒后尝试重连（第 ${reconnectCount} 次）`)

    reconnectTimer = setTimeout(() => {
      if (stopped || !activeStream) return
      ws.value?.close()
      ws.value = null
      _connect(activeStream)
    }, delay)
  }

  function publish(stream: MediaStream) {
    if (!supportsRTMP()) {
      error.value = '当前浏览器不支持 RTMP 推流（请使用 Chrome / Edge）'
      toast.warn('Safari 不支持 RTMP 推流，请切换到 WebRTC 模式')
      return
    }

    stopped        = false
    reconnectCount = 0
    activeStream   = stream
    error.value    = null
    _connect(stream)
  }

  function stop() {
    stopped = true
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (restartTimer)   { clearTimeout(restartTimer);   restartTimer   = null }
    recorder.value?.stop()
    ws.value?.close()
    recorder.value    = null
    ws.value          = null
    activeStream      = null
    isConnected.value = false
  }

  return { isConnected, error, publish, stop }
}
