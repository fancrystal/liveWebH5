/**
 * RTMP publisher via MediaRecorder → WebSocket → server ffmpeg pipeline.
 */
export class RTMPService {
  private ws: WebSocket | null = null
  private recorder: MediaRecorder | null = null
  private wsEndpoint: string

  constructor(wsEndpoint: string) {
    this.wsEndpoint = wsEndpoint
  }

  publish(
    stream: MediaStream,
    rtmpUrl: string,
    options: { videoBitrate?: number; audioBitrate?: number } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.wsEndpoint}?rtmp=${encodeURIComponent(rtmpUrl)}`
      const ws = new WebSocket(url)
      this.ws = ws

      ws.onopen = () => {
        const mimeType = this.getSupportedMimeType()
        const rec = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: (options.videoBitrate ?? 2000) * 1000,
          audioBitsPerSecond: (options.audioBitrate ?? 128) * 1000,
        })
        this.recorder = rec

        rec.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }

        rec.start(100)
        resolve()
      }

      ws.onerror = () => reject(new Error('WebSocket 连接失败'))
    })
  }

  stop() {
    this.recorder?.stop()
    this.ws?.close()
    this.recorder = null
    this.ws = null
  }

  private getSupportedMimeType(): string {
    const types = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    return types.find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm'
  }
}
