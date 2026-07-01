import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { StreamState, StreamConfig, LiveStatus } from '@/types/stream'
import { WHIP_URL } from '@/config/env'

const DEFAULT_CONFIG: StreamConfig = {
  mode: 'webrtc',
  rtmpUrl: '',
  whipUrl: WHIP_URL || 'http://localhost:1985/rtc/v1/whip/?app=live&stream=test',
  resolution: '1280x720',
  frameRate: 30,
  videoBitrate: 2000,
  audioBitrate: 128,
  sampleRate: 48000,
}

export const useStreamStore = defineStore('stream', () => {
  const status = ref<LiveStatus>('preview')
  const isStreaming = ref(false)
  const duration = ref(0)
  const viewerCount = ref(0)
  const networkQuality = ref<StreamState['networkQuality']>(0)
  const config = ref<StreamConfig>({ ...DEFAULT_CONFIG })

  let durationTimer: ReturnType<typeof setInterval> | null = null

  const statusLabel = computed(() => {
    const map: Record<LiveStatus, string> = {
      preview: '预告中',
      live: '直播中',
      ended: '已结束',
    }
    return map[status.value]
  })

  const formattedDuration = computed(() => {
    const h = Math.floor(duration.value / 3600)
    const m = Math.floor((duration.value % 3600) / 60)
    const s = duration.value % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })

  function clearDurationTimer() {
    if (durationTimer) {
      clearInterval(durationTimer)
      durationTimer = null
    }
  }

  function startLive() {
    clearDurationTimer()   // guard against double-start leaking the old timer
    status.value = 'live'
    isStreaming.value = true
    duration.value = 0
    durationTimer = setInterval(() => { duration.value++ }, 1000)
  }

  function endLive() {
    status.value = 'ended'
    isStreaming.value = false
    clearDurationTimer()
  }

  function restorePreview() {
    status.value = 'preview'
    isStreaming.value = false
    duration.value = 0
    clearDurationTimer()   // handleEndLive() goes straight here, skipping endLive()
  }

  function updateConfig(partial: Partial<StreamConfig>) {
    config.value = { ...config.value, ...partial }
  }

  function setViewerCount(count: number) {
    viewerCount.value = count
  }

  function setNetworkQuality(quality: StreamState['networkQuality']) {
    networkQuality.value = quality
  }

  return {
    status, isStreaming, duration, viewerCount, networkQuality, config,
    statusLabel, formattedDuration,
    startLive, endLive, restorePreview, updateConfig, setViewerCount, setNetworkQuality,
  }
})
