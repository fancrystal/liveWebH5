import { onUnmounted } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useToast } from '@/composables/useToast'

interface StatsSnapshot {
  bytesSent: number
  packetsSent: number
  packetsLost: number
  timestamp: number
}

/**
 * Polls RTCPeerConnection.getStats() every 2 s.
 * Updates streamStore.networkQuality (0–4) and fires toast warnings.
 */
export function useNetworkMonitor() {
  const streamStore = useStreamStore()
  const toast       = useToast()

  let pc:        RTCPeerConnection | null = null
  let timer:     ReturnType<typeof setInterval> | null = null
  let prev:      StatsSnapshot | null = null
  let lastLevel  = 4
  let warnCooldown = 0   // timestamp of last warning toast

  function qualityFromStats(
    rttMs:       number,
    lossRate:    number,   // 0–1
  ): 0 | 1 | 2 | 3 | 4 {
    if (rttMs < 100 && lossRate < 0.01) return 4
    if (rttMs < 200 && lossRate < 0.03) return 3
    if (rttMs < 400 && lossRate < 0.08) return 2
    if (rttMs < 800 && lossRate < 0.15) return 1
    return 0
  }

  async function poll() {
    if (!pc) return
    try {
      const reports = await pc.getStats()
      let rttMs       = 0
      let bytesSent   = 0
      let packetsSent = 0
      let packetsLost = 0
      let ts          = Date.now()

      reports.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded') {
          rttMs = Math.round((r.currentRoundTripTime ?? 0) * 1000)
        }
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          bytesSent   = r.bytesSent   ?? 0
          packetsSent = r.packetsSent ?? 0
        }
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
          packetsLost = r.packetsLost ?? 0
        }
      })

      let lossRate = 0
      if (prev) {
        const deltaSent = Math.max(1, packetsSent - prev.packetsSent)
        const deltaLost = Math.max(0, packetsLost - prev.packetsLost)
        lossRate = deltaLost / deltaSent
      }

      prev = { bytesSent, packetsSent, packetsLost, timestamp: ts }

      const level = qualityFromStats(rttMs, lossRate)
      streamStore.setNetworkQuality(level)

      // Show warning toast at most once every 30 s
      if (level <= 1 && lastLevel >= 2 && Date.now() - warnCooldown > 30_000) {
        toast.warn(`网络质量较差（RTT ${rttMs}ms，丢包 ${Math.round(lossRate * 100)}%），推流可能卡顿`)
        warnCooldown = Date.now()
      }
      if (level === 0 && lastLevel >= 1 && Date.now() - warnCooldown > 10_000) {
        toast.error('网络连接极差，请检查网络后重试')
        warnCooldown = Date.now()
      }
      lastLevel = level
    } catch {
      // pc may have been closed
    }
  }

  function start(peerConnection: RTCPeerConnection) {
    stop()
    pc          = peerConnection
    prev        = null
    lastLevel   = 4
    warnCooldown = 0
    timer = setInterval(poll, 2000)
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null }
    pc   = null
    prev = null
    streamStore.setNetworkQuality(0)
  }

  onUnmounted(stop)

  return { start, stop }
}
