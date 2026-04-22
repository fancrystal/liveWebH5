export function getSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
}

export function mergeStreams(...streams: (MediaStream | null)[]): MediaStream {
  const tracks: MediaStreamTrack[] = []
  streams.forEach(s => s?.getTracks().forEach(t => tracks.push(t)))
  return new MediaStream(tracks)
}
