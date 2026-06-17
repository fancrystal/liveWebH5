export type StreamMode = 'webrtc' | 'rtmp'

export type LiveStatus = 'preview' | 'live' | 'ended'

/**
 * Real-time network quality assessed by each push-stream composable.
 * - good:     low loss, low latency — full bitrate
 * - degraded: moderate loss/latency — bitrate reduced to ~60%
 * - poor:     high loss/latency or buffer overflow — bitrate at ~30%, chunks dropped
 */
export type NetQuality = 'good' | 'degraded' | 'poor'

export interface StreamConfig {
  mode: StreamMode
  rtmpUrl: string
  whipUrl: string
  resolution: '1280x720' | '1920x1080' | '854x480' | '720x1280' | '1080x1920' | '480x854'
  frameRate: 15 | 24 | 30
  videoBitrate: number  // kbps
  audioBitrate: 64 | 128 | 192
  sampleRate: 44100 | 48000
}

export interface StreamState {
  status: LiveStatus
  isStreaming: boolean
  duration: number        // seconds
  viewerCount: number
  networkQuality: 0 | 1 | 2 | 3 | 4  // 0=unknown, 1=poor, 4=excellent
  config: StreamConfig
}

export interface MixerLayer {
  id: string
  type: 'whiteboard' | 'camera' | 'screen' | 'document'
  zIndex: number
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}
