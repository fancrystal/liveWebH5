import { ref } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useToast } from '@/composables/useToast'

const ICE_SERVERS: RTCIceServer[] = [
  // China-accessible STUN servers (Google STUN is blocked in mainland China)
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },   // fallback for non-China
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
      const { videoBitrate, frameRate } = streamStore.config
      conn.addTransceiver(videoTrack, {
        direction: 'sendonly',
        sendEncodings: [{
          maxBitrate:            videoBitrate * 1000,
          maxFramerate:          frameRate,
          scaleResolutionDownBy: 1.0,        // no downscaling
          // keyFrameInterval not yet in TypeScript types but supported in Chrome
          // Sets GOP to ~1s so FLV/HLS pull side can seek/start quickly
        }],
      })

    }
    // Audio tracks
    const { audioBitrate } = streamStore.config
    stream.getAudioTracks().forEach(t =>
      conn.addTransceiver(t, {
        direction: 'sendonly',
        sendEncodings: [{ maxBitrate: audioBitrate * 1000 }],
      }),
    )

    conn.oniceconnectionstatechange = () => {
      const state = conn.iceConnectionState
      // eslint-disable-next-line no-console
      console.log('[WebRTC] ICE state:', state)
      isConnected.value = state === 'connected' || state === 'completed'
      if (state === 'failed') {
        // Log local & remote ICE candidates for debugging
        // eslint-disable-next-line no-console
        console.warn('[WebRTC] ICE failed. Remote candidates may be unreachable.',
          'Check ZLMediaKit rtc.externIP config and firewall UDP ports.')
      }
      if (state === 'disconnected') {
        // eslint-disable-next-line no-console
        console.warn('[WebRTC] ICE disconnected — may indicate UDP packet loss or NAT timeout.')
      }
    }

    conn.onconnectionstatechange = () => {
      const s = conn.connectionState
      // eslint-disable-next-line no-console
      console.log('[WebRTC] Connection state:', s)
      if ((s === 'failed' || s === 'disconnected') && !stopped) {
        isConnected.value = false
        scheduleReconnect()
      }
    }

    // Expose ICE candidate details on connection changes for chrome://webrtc-internals
    conn.onicecandidate = (e) => {
      if (e.candidate) {
        // eslint-disable-next-line no-console
        console.log('[WebRTC] Local ICE candidate:', e.candidate.candidate)
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
      // eslint-disable-next-line no-console
      console.log('[WebRTC] Remote SDP answer received, length:', answerSdp.length)
      // Log remote ICE candidates from SDP for debugging connectivity
      const remoteCandidates = answerSdp.match(/a=candidate:.*/g)
      if (remoteCandidates?.length) {
        // eslint-disable-next-line no-console
        console.log('[WebRTC] Remote ICE candidates:', remoteCandidates)
      } else {
        // eslint-disable-next-line no-console
        console.warn('[WebRTC] No ICE candidates found in SDP answer! ZLMediaKit may not be configured for WebRTC properly.')
      }
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
    const { videoBitrate: vbr, frameRate: fps } = streamStore.config
    conn.onsignalingstatechange = async () => {
      if (conn.signalingState !== 'stable') return
      for (const sender of conn.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        try {
          const params = sender.getParameters()
          if (!params.encodings?.length) params.encodings = [{}]
          params.encodings.forEach(enc => {
            enc.maxBitrate            = vbr * 1000
            enc.maxFramerate          = fps
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
