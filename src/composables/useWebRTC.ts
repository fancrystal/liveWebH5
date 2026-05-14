import { ref } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useToast } from '@/composables/useToast'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const MAX_RECONNECT_ATTEMPTS = 4
const RECONNECT_BASE_MS      = 3000

/**
 * WHIP-based WebRTC publisher.
 * POST SDP offer to WHIP endpoint → receive answer → ICE connect → stream.
 * Exposes the RTCPeerConnection for network monitoring.
 */
export function useWebRTC() {
  const streamStore = useStreamStore()
  const toast       = useToast()

  const pc          = ref<RTCPeerConnection | null>(null)
  const isConnected = ref(false)
  const error       = ref<string | null>(null)

  let activeStream:    MediaStream | null = null
  let reconnectTimer:  ReturnType<typeof setTimeout> | null = null
  let reconnectCount   = 0
  let stopped          = false

  async function _connect(stream: MediaStream) {
    const { whipUrl } = streamStore.config
    if (!whipUrl) { error.value = 'WHIP 推流地址未配置'; return }

    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.value = conn

    // Use addTransceiver instead of addTrack so we can set encoding constraints.
    // Without scaleResolutionDownBy=1 Chrome's bandwidth estimator silently
    // drops the resolution (e.g. 1280×720 → 320×180).
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      // 'detail' tells the encoder this is screen/document content,
      // preserving sharpness over motion-smoothing.
      videoTrack.contentHint = 'detail'
      conn.addTransceiver(videoTrack, {
        direction: 'sendonly',
        sendEncodings: [{
          maxBitrate:            4_000_000,  // 4 Mbps — enough for 1280×720@30
          maxFramerate:          30,
          scaleResolutionDownBy: 1.0,        // no downscaling
        }],
      })
    }
    // Audio tracks — no special constraints needed
    stream.getAudioTracks().forEach(t =>
      conn.addTransceiver(t, { direction: 'sendonly' }),
    )

    conn.oniceconnectionstatechange = () => {
      isConnected.value = conn.iceConnectionState === 'connected'
        || conn.iceConnectionState === 'completed'
    }

    conn.onconnectionstatechange = () => {
      const s = conn.connectionState
      if ((s === 'failed' || s === 'disconnected') && !stopped) {
        isConnected.value = false
        scheduleReconnect()
      }
    }

    const offer = await conn.createOffer()
    await conn.setLocalDescription(offer)

    // Wait for ICE gathering to complete (max 5 s)
    await Promise.race([
      new Promise<void>(resolve => {
        if (conn.iceGatheringState === 'complete') { resolve(); return }
        conn.onicegatheringstatechange = () => {
          if (conn.iceGatheringState === 'complete') resolve()
        }
      }),
      new Promise<void>(resolve => setTimeout(resolve, 5000)),
    ])

    let res: Response
    try {
      res = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: conn.localDescription!.sdp,
      })
    } catch (fetchErr) {
      conn.close()
      const isCors = fetchErr instanceof TypeError && String(fetchErr).includes('Failed to fetch')
      const msg = isCors
        ? `WHIP 连接失败：网络不通或服务器未设置 CORS（地址：${whipUrl}）`
        : `WHIP 请求异常：${fetchErr}`
      error.value = msg
      throw new Error(msg)
    }

    if (!res.ok) {
      conn.close()
      let detail = ''
      try { detail = await res.text() } catch { /* ignore */ }
      let msg: string
      if (res.status === 404) {
        msg = `WHIP 地址不存在 (404)。SRS 正确格式：/rtc/v1/whip/?app=live&stream=流名`
      } else if (res.status === 400) {
        msg = `WHIP 请求格式错误 (400)。请检查 URL 是否含 ?app=xxx&stream=xxx 参数。${detail ? '详情：' + detail : ''}`
      } else {
        msg = `WHIP 服务器返回 ${res.status}${detail ? '：' + detail : ''}`
      }
      error.value = msg
      throw new Error(msg)
    }

    let answerSdp: string
    try {
      answerSdp = await res.text()
      await conn.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (sdpErr) {
      conn.close()
      const msg = `SDP 协商失败：${sdpErr instanceof Error ? sdpErr.message : sdpErr}`
      error.value = msg
      throw new Error(msg)
    }
    reconnectCount = 0
    error.value    = null

    // After signaling is stable, enforce encoding params again.
    // Some SRS versions may renegotiate and reset the sender parameters.
    conn.onsignalingstatechange = async () => {
      if (conn.signalingState !== 'stable') return
      for (const sender of conn.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        try {
          const params = sender.getParameters()
          if (!params.encodings?.length) params.encodings = [{}]
          params.encodings.forEach(enc => {
            enc.maxBitrate            = 4_000_000
            enc.maxFramerate          = 30
            enc.scaleResolutionDownBy = 1.0
          })
          await sender.setParameters(params)
        } catch { /* older browsers may not support all fields */ }
      }
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
        toast.error('WebRTC 推流多次重连失败，请检查网络或推流地址')
        error.value = '推流断线，重连次数已达上限'
      }
      return
    }

    const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectCount)
    reconnectCount++

    toast.warn(`推流连接中断，${Math.round(delay / 1000)} 秒后尝试重连（第 ${reconnectCount} 次）`)

    reconnectTimer = setTimeout(async () => {
      if (stopped || !activeStream) return
      pc.value?.close()
      pc.value = null
      try {
        await _connect(activeStream)
        if (!stopped && pc.value) {
          toast.success('推流重连成功')
        }
      } catch {
        scheduleReconnect()
      }
    }, delay)
  }

  async function publish(stream: MediaStream) {
    stopped      = false
    reconnectCount = 0
    activeStream   = stream
    error.value  = null
    await _connect(stream)
  }

  function stop() {
    stopped = true
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    pc.value?.close()
    pc.value      = null
    activeStream  = null
    isConnected.value = false
  }

  return { pc, isConnected, error, publish, stop }
}
