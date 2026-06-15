import { ref } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useToast } from '@/composables/useToast'
import type { NetQuality } from '@/types/stream'

// ─── ICE servers ────────────────────────────────────────────────────────────
// Google STUN is blocked in mainland China; prefer domestic servers first.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },    // Xiaomi — reliable in CN
  { urls: 'stun:stun.qq.com:3478' },         // Tencent — reliable in CN
  { urls: 'stun:stun.l.google.com:19302' },  // fallback for non-CN environments
]

// ─── Reconnect ────────────────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS     = 4
const RECONNECT_BASE_MS          = 3_000

// ─── Weak-network / ICE disconnect (Risk — new) ──────────────────────────────
// 'disconnected' ICE state is transient: NAT rebinding, brief packet loss, or
// Wi-Fi handoff often resolve within a few seconds.  We wait before intervening.
const ICE_DISCONNECTED_GRACE_MS  = 5_000   // wait before reconnecting on 'disconnected'

// ─── Stats-based adaptive bitrate ────────────────────────────────────────────
const STATS_POLL_MS              = 5_000   // getStats() interval
// Require N consecutive same-quality samples before changing state (hysteresis)
const QUALITY_STABLE_THRESHOLD   = 2

// Packet-loss and RTT thresholds (fractionLost is 0–255 RTCP scale → divide by 255)
const LOSS_POOR      = 0.10    // > 10% loss → poor
const LOSS_DEGRADED  = 0.02    // 2–10% loss → degraded
const RTT_POOR_MS    = 300     // > 300 ms RTT → poor
const RTT_DEGRADED_MS= 100     // 100–300 ms RTT → degraded

// Bitrate multipliers applied to streamStore.config.videoBitrate
const BITRATE_MULT: Record<NetQuality, number> = {
  good:     1.0,
  degraded: 0.60,
  poor:     0.30,
}
// Frame-rate cap under poor network (reduces encoder work / packet load)
const MAX_FPS_POOR = 15

/**
 * WHIP-based WebRTC publisher.
 * POST SDP offer → 201 + SDP answer → ICE + SRTP media path → stream.
 *
 * Improvements:
 *
 * [Weak net — ICE disconnected]
 *   'disconnected' often self-heals (NAT timeout, Wi-Fi handoff).  We wait
 *   ICE_DISCONNECTED_GRACE_MS before reconnecting, resetting backoff (this is
 *   a transient state, not a repeated failure).
 *
 * [Weak net — adaptive bitrate]
 *   Every 5 s we poll RTCP stats (fractionLost + roundTripTime from
 *   remote-inbound-rtp).  After QUALITY_STABLE_THRESHOLD consecutive samples
 *   in the new quality band we call sender.setParameters() to adjust maxBitrate
 *   and maxFramerate in-flight — no reconnect needed.
 *
 * [Hysteresis]
 *   Quality only changes after N stable samples to avoid thrashing between
 *   bands during momentary loss spikes.
 */
export function useWebRTC() {
  const streamStore = useStreamStore()
  const toast       = useToast()

  const pc          = ref<RTCPeerConnection | null>(null)
  const isConnected = ref(false)
  const error       = ref<string | null>(null)
  const netQuality  = ref<NetQuality>('good')

  // ── Internal state ──────────────────────────────────────────────────────────
  let activeStream:       MediaStream | null = null
  let reconnectTimer:     ReturnType<typeof setTimeout> | null = null
  let disconnectedTimer:  ReturnType<typeof setTimeout> | null = null
  let statsInterval:      ReturnType<typeof setInterval> | null = null
  let reconnectCount      = 0
  let stopped             = false
  let reconnecting        = false   // guard — prevent parallel scheduleReconnect() calls
  // WHIP resource URL returned in Location header after a successful POST.
  // Must be DELETE-d when stopping so the server releases the stream slot (prevents 406 on re-start).
  let whipResourceUrl:    string | null = null

  // Hysteresis state (reset per connection)
  let lastQualitySample:       NetQuality = 'good'
  let consecutiveSameQuality   = 0

  // ─── Network quality ────────────────────────────────────────────────────────

  function setNetQuality(q: NetQuality) {
    if (netQuality.value === q) return
    const prev = netQuality.value
    netQuality.value = q
    // eslint-disable-next-line no-console
    console.log(`[WebRTC] network quality: ${prev} → ${q}`)
    if (q === 'degraded') toast.warn('网络质量下降，推流码率已自动降低')
    if (q === 'poor')     toast.error('网络较差，推流码率已大幅降低，帧率已限制')
    if (q === 'good' && prev !== 'good') toast.success('网络已恢复，推流码率恢复正常')
  }

  function evaluateQuality(lossRate: number, rttMs: number): NetQuality {
    // rttMs === 0 means no RTCP report yet — ignore RTT until available
    if (lossRate > LOSS_POOR || (rttMs > RTT_POOR_MS && rttMs > 0))       return 'poor'
    if (lossRate > LOSS_DEGRADED || (rttMs > RTT_DEGRADED_MS && rttMs > 0)) return 'degraded'
    return 'good'
  }

  // ─── Stats-based adaptive bitrate ───────────────────────────────────────────

  async function pollAndAdapt(conn: RTCPeerConnection) {
    if (pc.value !== conn || conn.connectionState !== 'connected') return

    let lossRate = 0
    let rttMs    = 0

    try {
      const reports = await conn.getStats()
      reports.forEach((r: RTCStats) => {
        // remote-inbound-rtp carries RTCP Receiver Report data:
        //   fractionLost: packets lost / packets expected, scaled 0–255
        //   roundTripTime: seconds (via RTCP SR+RR NTP timestamp comparison)
        const report = r as unknown as Record<string, unknown>
        if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
          lossRate = ((report.fractionLost as number) ?? 0) / 255
          rttMs    = ((report.roundTripTime as number) ?? 0) * 1_000
        }
      })
    } catch {
      return   // connection may be torn down mid-poll
    }

    // Hysteresis: only act after QUALITY_STABLE_THRESHOLD identical samples
    const sample = evaluateQuality(lossRate, rttMs)
    if (sample === lastQualitySample) {
      consecutiveSameQuality++
    } else {
      lastQualitySample      = sample
      consecutiveSameQuality = 1
    }

    if (VERBOSE_LOG()) {
      // eslint-disable-next-line no-console
      console.log('[WebRTC] stats poll', {
        lossRate: (lossRate * 100).toFixed(1) + '%',
        rttMs:    rttMs.toFixed(0) + 'ms',
        sample,
        consecutive: consecutiveSameQuality,
      })
    }

    if (consecutiveSameQuality < QUALITY_STABLE_THRESHOLD) return

    const prevQuality = netQuality.value
    setNetQuality(sample)

    // Adjust encoding parameters if quality band changed
    if (sample !== prevQuality) {
      await applyBitrateForQuality(conn, sample)
    }
  }

  async function applyBitrateForQuality(conn: RTCPeerConnection, quality: NetQuality) {
    const { videoBitrate, frameRate } = streamStore.config
    const targetBps  = Math.round(videoBitrate * BITRATE_MULT[quality]) * 1_000
    const targetFps  = quality === 'poor' ? Math.min(frameRate, MAX_FPS_POOR) : frameRate

    // eslint-disable-next-line no-console
    console.log('[WebRTC] Adapting bitrate:', {
      quality,
      targetKbps: targetBps / 1_000,
      targetFps,
    })

    for (const sender of conn.getSenders()) {
      if (sender.track?.kind !== 'video') continue
      try {
        const params = sender.getParameters()
        if (!params.encodings?.length) continue
        params.encodings.forEach(enc => {
          enc.maxBitrate   = targetBps
          enc.maxFramerate = targetFps
          // Never let Chrome auto-downscale resolution
          enc.scaleResolutionDownBy = 1.0
        })
        await sender.setParameters(params)
      } catch { /* some browsers don't support all encoding fields */ }
    }
  }

  function startStatsPolling(conn: RTCPeerConnection) {
    stopStatsPolling()
    // Reset hysteresis for this connection
    lastQualitySample      = 'good'
    consecutiveSameQuality = 0
    statsInterval = setInterval(() => pollAndAdapt(conn), STATS_POLL_MS)
  }

  function stopStatsPolling() {
    if (statsInterval) { clearInterval(statsInterval); statsInterval = null }
  }

  function VERBOSE_LOG() {
    return import.meta.env.VITE_VERBOSE_LOG === 'true'
  }

  // ─── RTCPeerConnection ───────────────────────────────────────────────────────

  async function _connect(stream: MediaStream) {
    const { whipUrl } = streamStore.config
    if (!whipUrl) { error.value = 'WHIP 推流地址未配置'; return }

    // Clear any timers from a prior connection
    if (disconnectedTimer) { clearTimeout(disconnectedTimer); disconnectedTimer = null }
    stopStatsPolling()

    const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pc.value   = conn

    // ── Tracks ────────────────────────────────────────────────────────────────
    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      // 'detail' → encoder prioritises sharpness (whiteboard / text) over smoothness
      videoTrack.contentHint = 'detail'
      const { videoBitrate, frameRate } = streamStore.config
      conn.addTransceiver(videoTrack, {
        direction: 'sendonly',
        sendEncodings: [{
          maxBitrate:            videoBitrate * 1_000,
          maxFramerate:          frameRate,
          scaleResolutionDownBy: 1.0,   // disable Chrome's silent auto-downscale
        }],
      })
    }

    const { audioBitrate } = streamStore.config
    stream.getAudioTracks().forEach(t =>
      conn.addTransceiver(t, {
        direction: 'sendonly',
        sendEncodings: [{ maxBitrate: audioBitrate * 1_000 }],
      }),
    )

    // ── ICE state — handle transient disconnection with grace period ──────────
    conn.oniceconnectionstatechange = () => {
      if (pc.value !== conn) return   // superseded connection — ignore
      const iceState = conn.iceConnectionState
      // eslint-disable-next-line no-console
      console.log('[WebRTC] ICE state:', iceState)

      if (iceState === 'connected' || iceState === 'completed') {
        // Successfully (re-)connected — cancel any pending grace-period reconnect
        if (disconnectedTimer) { clearTimeout(disconnectedTimer); disconnectedTimer = null }
        isConnected.value = true
      }

      if (iceState === 'disconnected') {
        isConnected.value = false
        setNetQuality('poor')
        // eslint-disable-next-line no-console
        console.warn('[WebRTC] ICE disconnected — waiting',
          ICE_DISCONNECTED_GRACE_MS / 1_000 + 's for self-heal (NAT rebind / Wi-Fi handoff)')

        // Give ICE a chance to self-heal before we intervene
        disconnectedTimer = setTimeout(() => {
          disconnectedTimer = null
          if (pc.value !== conn) return         // already reconnected elsewhere
          if (conn.iceConnectionState !== 'disconnected' || stopped) return
          // Still disconnected after grace period → immediate reconnect, reset backoff
          // (this is a transient failure, not a repeated ICE/DTLS error)
          // eslint-disable-next-line no-console
          console.warn('[WebRTC] ICE did not self-heal — reconnecting immediately')
          conn.close()
          stopStatsPolling()
          reconnecting   = false
          reconnectCount = 0
          if (!stopped && activeStream) {
            _connect(activeStream).catch(scheduleReconnect)
          }
        }, ICE_DISCONNECTED_GRACE_MS)
      }

      if (iceState === 'failed') {
        // eslint-disable-next-line no-console
        console.warn('[WebRTC] ICE failed — check firewall UDP ports and STUN accessibility.' +
          ' ZLMediaKit: set rtc.externIP in config.ini')
      }
    }

    // ── Connection state — aggregate failure → backoff reconnect ─────────────
    conn.onconnectionstatechange = () => {
      if (pc.value !== conn) return
      const s = conn.connectionState
      // eslint-disable-next-line no-console
      console.log('[WebRTC] Connection state:', s)

      if (s === 'connected') {
        isConnected.value = true
        reconnectCount    = 0
        reconnecting      = false
        error.value       = null
        setNetQuality('good')
        startStatsPolling(conn)
      }

      // 'failed' = definitive ICE/DTLS failure (not transient) → exponential backoff
      if (s === 'failed' && !stopped && !reconnecting) {
        isConnected.value = false
        stopStatsPolling()
        scheduleReconnect()
      }
    }

    conn.onicecandidate = (e) => {
      if (e.candidate && VERBOSE_LOG()) {
        // eslint-disable-next-line no-console
        console.log('[WebRTC] Local ICE candidate:', e.candidate.candidate)
      }
    }

    // ── SDP offer / answer ───────────────────────────────────────────────────
    const offer = await conn.createOffer()
    await conn.setLocalDescription(offer)

    // Trickle ICE: wait for gathering to complete (or timeout) so the SDP
    // contains all candidates before we POST — improves connect success rate.
    await Promise.race([
      new Promise<void>(resolve => {
        if (conn.iceGatheringState === 'complete') { resolve(); return }
        conn.onicegatheringstatechange = () => {
          if (conn.iceGatheringState === 'complete') resolve()
        }
      }),
      new Promise<void>(resolve => setTimeout(resolve, 5_000)),
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
      stopStatsPolling()
      const isCors = fetchErr instanceof TypeError && String(fetchErr).includes('Failed to fetch')
      const msg = isCors
        ? `WHIP 连接失败：网络不通或 CORS 未配置（地址：${whipUrl}）`
        : `WHIP 请求异常：${fetchErr}`
      error.value = msg
      throw new Error(msg)
    }

    if (!res.ok) {
      conn.close()
      stopStatsPolling()
      let detail = ''
      try { detail = await res.text() } catch { /* ignore */ }
      const msg = res.status === 404
        ? `WHIP 地址不存在 (404)。SRS 格式：/rtc/v1/whip/?app=live&stream=名称`
        : res.status === 400
          ? `WHIP 请求格式错误 (400)${detail ? '：' + detail : ''}`
          : res.status === 406
            ? `WHIP 服务器拒绝推流 (406: ${detail || 'already publishing'})。请检查推流地址是否被占用，或稍候重试。`
            : `WHIP 服务器返回 ${res.status}${detail ? '：' + detail : ''}`
      error.value = msg
      throw new Error(msg)
    }

    // Save the resource URL (Location header) so we can DELETE it on stop()
    // to release the server-side session and prevent 406 on the next publish.
    const location = res.headers.get('Location')
    if (location) {
      whipResourceUrl = location.startsWith('http')
        ? location
        : new URL(location, whipUrl).href
    } else {
      whipResourceUrl = whipUrl   // fallback: some servers re-use the push URL
    }

    let answerSdp: string
    try {
      answerSdp = await res.text()
      // eslint-disable-next-line no-console
      console.log('[WebRTC] SDP answer received, length:', answerSdp.length)
      const remoteCandidates = answerSdp.match(/a=candidate:.*/g)
      if (remoteCandidates?.length) {
        // Candidate lines contain server-side IPs — only dump them when verbose.
        if (VERBOSE_LOG()) {
          // eslint-disable-next-line no-console
          console.log('[WebRTC] Remote ICE candidates:', remoteCandidates)
        }
      } else {
        // eslint-disable-next-line no-console
        console.warn('[WebRTC] No ICE candidates in SDP answer.' +
          ' ZLMediaKit may need rtc.externIP configured.')
      }
      await conn.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    } catch (sdpErr) {
      conn.close()
      stopStatsPolling()
      const msg = `SDP 协商失败：${sdpErr instanceof Error ? sdpErr.message : sdpErr}`
      error.value = msg
      throw new Error(msg)
    }

    // Re-enforce encoding params if server renegotiates after signaling stabilises
    const { videoBitrate: vbr, frameRate: fps } = streamStore.config
    conn.onsignalingstatechange = async () => {
      if (pc.value !== conn || conn.signalingState !== 'stable') return
      for (const sender of conn.getSenders()) {
        if (sender.track?.kind !== 'video') continue
        try {
          const params = sender.getParameters()
          if (!params.encodings?.length) params.encodings = [{}]
          params.encodings.forEach(enc => {
            enc.maxBitrate            = vbr * 1_000
            enc.maxFramerate          = fps
            enc.scaleResolutionDownBy = 1.0
          })
          await sender.setParameters(params)
        } catch { /* ignore — older browsers may not support all fields */ }
      }
    }
  }

  // ─── Reconnect ───────────────────────────────────────────────────────────────

  function scheduleReconnect() {
    if (stopped || reconnecting || reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
      if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
        toast.error('WebRTC 推流多次重连失败，请检查网络或推流地址')
        error.value = '推流断线，重连次数已达上限'
        setNetQuality('poor')
      }
      return
    }

    reconnecting = true
    const delay  = RECONNECT_BASE_MS * Math.pow(2, reconnectCount)
    reconnectCount++
    toast.warn(
      `推流连接中断，${Math.round(delay / 1_000)} 秒后重连` +
      `（第 ${reconnectCount}/${MAX_RECONNECT_ATTEMPTS} 次）`,
    )

    reconnectTimer = setTimeout(async () => {
      reconnecting = false
      if (stopped || !activeStream) return
      pc.value?.close()
      pc.value = null
      try {
        await _connect(activeStream)
        if (!stopped && pc.value) toast.success('推流重连成功')
      } catch {
        scheduleReconnect()
      }
    }, delay)
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  async function publish(stream: MediaStream) {
    stopped          = false
    reconnecting     = false
    reconnectCount   = 0
    activeStream     = stream
    error.value      = null
    whipResourceUrl  = null   // clear any stale resource URL from a previous session
    await _connect(stream)
  }

  function stop() {
    stopped = true
    if (reconnectTimer)    { clearTimeout(reconnectTimer);    reconnectTimer    = null }
    if (disconnectedTimer) { clearTimeout(disconnectedTimer); disconnectedTimer = null }
    stopStatsPolling()

    // Release the server-side WHIP session before closing the peer connection.
    // Without this DELETE the server keeps the slot occupied and returns 406
    // ("already publishing") the next time the host tries to go live.
    if (whipResourceUrl) {
      fetch(whipResourceUrl, { method: 'DELETE' }).catch(() => {})
      whipResourceUrl = null
    }

    pc.value?.close()
    pc.value          = null
    activeStream      = null
    isConnected.value = false
    netQuality.value  = 'good'
  }

  return { pc, isConnected, error, netQuality, publish, stop }
}
