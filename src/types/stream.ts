export type StreamMode = 'webrtc' | 'rtmp'

export type LiveStatus = 'preview' | 'live' | 'ended'

export interface StreamConfig {
  mode: StreamMode
  rtmpUrl: string
  whipUrl: string
  resolution: '1280x720' | '1920x1080' | '854x480'
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
