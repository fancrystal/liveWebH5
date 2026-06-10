import { defineStore } from 'pinia'
import { ref } from 'vue'
import { filterRealDevices } from '@/utils/browser'
import { useStreamStore } from '@/stores/streamStore'
import type { CloudFile, VideoInsertMode } from '@/types/cloudDrive'

export const useMediaStore = defineStore('media', () => {
  const streamStore = useStreamStore()
  const cameraStream = ref<MediaStream | null>(null)
  const micStream = ref<MediaStream | null>(null)
  const screenStream = ref<MediaStream | null>(null)

  const isCameraOn = ref(false)
  const isMicOn = ref(false)
  const isScreenSharing = ref(false)
  const isCameraVisible = ref(true)  // PiP window visibility

  /**
   * Camera PiP layout — stored as percentages of the UI canvas container so the
   * mixer can apply the same proportions to the output canvas regardless of its
   * UI size. CameraPreview.vue is responsible for converting screen pixels to
   * percentages (see CameraPreview's watchEffect block).
   *
   * Defaults position the PiP roughly at the top-right corner, ~22% width.
   */
  interface CameraPipPct { xPct: number; yPct: number; wPct: number; hPct: number }
  const cameraPip = ref<CameraPipPct>({ xPct: 0.77, yPct: 0.015, wPct: 0.22, hPct: 0.124 })
  function updateCameraPip(patch: Partial<CameraPipPct>) {
    cameraPip.value = { ...cameraPip.value, ...patch }
  }

  /** Whether the camera PiP is currently maximized to fill the full canvas area. */
  const isCameraMaximized = ref(false)
  /** Saved PiP position before maximizing, so we can restore it. */
  let _savedPip: CameraPipPct | null = null

  function maximizeCamera() {
    if (isCameraMaximized.value) return
    _savedPip = { ...cameraPip.value }
    isCameraMaximized.value = true
    updateCameraPip({ xPct: 0, yPct: 0, wPct: 1, hPct: 1 })
  }

  function restoreCamera() {
    if (!isCameraMaximized.value) return
    isCameraMaximized.value = false
    if (_savedPip) {
      updateCameraPip(_savedPip)
      _savedPip = null
    }
  }

  const videoDevices = ref<MediaDeviceInfo[]>([])
  const audioDevices = ref<MediaDeviceInfo[]>([])
  const activeVideoDeviceId = ref<string>('')
  const activeAudioDeviceId = ref<string>('')

  async function loadDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices()
    videoDevices.value = filterRealDevices(devices.filter(d => d.kind === 'videoinput'))
    audioDevices.value = filterRealDevices(devices.filter(d => d.kind === 'audioinput'))
  }

  async function toggleCamera() {
    if (isCameraOn.value) {
      cameraStream.value?.getVideoTracks().forEach(t => t.stop())
      cameraStream.value = null
      isCameraOn.value = false
      isCameraVisible.value = false
    } else {
      // Give the hardware a moment to release before re-acquiring
      await new Promise(r => setTimeout(r, 80))
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: activeVideoDeviceId.value || undefined },
      })
      cameraStream.value = stream
      isCameraOn.value = true
      isCameraVisible.value = true
    }
  }

  async function toggleMic() {
    if (isMicOn.value) {
      micStream.value?.getAudioTracks().forEach(t => t.stop())
      micStream.value = null
      isMicOn.value = false
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: activeAudioDeviceId.value || undefined,
          sampleRate: streamStore.config.sampleRate,
        },
      })
      micStream.value = stream
      isMicOn.value = true
    }
  }

  async function switchCamera(deviceId: string) {
    activeVideoDeviceId.value = deviceId
    if (!isCameraOn.value) return
    cameraStream.value?.getVideoTracks().forEach(t => t.stop())
    cameraStream.value = null
    await new Promise(r => setTimeout(r, 80))
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
      cameraStream.value = stream
      isCameraVisible.value = true
    } catch (e) {
      // The old stream is already stopped — leaving isCameraOn=true would show
      // a frozen/black PiP with no way to recover except a confusing double-toggle.
      isCameraOn.value      = false
      isCameraVisible.value = false
      // eslint-disable-next-line no-console
      console.error('[mediaStore] switchCamera failed:', e)
    }
  }

  async function switchMic(deviceId: string) {
    activeAudioDeviceId.value = deviceId
    if (!isMicOn.value) return
    micStream.value?.getAudioTracks().forEach(t => t.stop())
    micStream.value = null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          sampleRate: streamStore.config.sampleRate,
        },
      })
      micStream.value = stream
    } catch (e) {
      // Old mic is stopped — reflect reality so the mic button shows "off"
      isMicOn.value = false
      // eslint-disable-next-line no-console
      console.error('[mediaStore] switchMic failed:', e)
    }
  }

  async function startScreenShare() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    screenStream.value = stream
    isScreenSharing.value = true
    stream.getVideoTracks()[0].onended = () => {
      stopScreenShare()
    }
  }

  function stopScreenShare() {
    screenStream.value?.getTracks().forEach(t => t.stop())
    screenStream.value = null
    isScreenSharing.value = false
  }

  function toggleCameraVisibility() {
    isCameraVisible.value = !isCameraVisible.value
  }

  // ── Video insert (cloud drive playback) ────────────────────────────────────
  /** The <video> element currently playing the inserted video. */
  const videoInsertEl   = ref<HTMLVideoElement | null>(null)
  /** Current insert display mode. */
  const videoInsertMode = ref<VideoInsertMode>('pip')
  /** The cloud file being inserted, or null when not inserting. */
  const videoInsertFile = ref<CloudFile | null>(null)
  /** Whether a video insert is currently active. */
  const isVideoInserting = ref(false)

  /**
   * Video insert PiP layout — stored as percentages of the UI canvas container,
   * exactly like cameraPip, so the StreamMixer can use the same proportions on
   * the output canvas regardless of resolution.
   * Default: bottom-right corner, ~30% width, auto height (set by VideoInsertPreview).
   */
  interface VideoPipPct { xPct: number; yPct: number; wPct: number; hPct: number }
  const videoPip = ref<VideoPipPct>({ xPct: 0.68, yPct: 0.65, wPct: 0.30, hPct: 0.17 })
  function updateVideoPip(patch: Partial<VideoPipPct>) {
    videoPip.value = { ...videoPip.value, ...patch }
  }

  /**
   * Start inserting a cloud video into the stream.
   * Creates a hidden <video> element that the StreamMixer will draw from.
   */
  function startVideoInsert(file: CloudFile, mode: VideoInsertMode = 'pip') {
    // Tear down the previous element first, detaching the onended hook before
    // stopping to avoid a re-entrant stopVideoInsert() call from the old element.
    const old = videoInsertEl.value
    if (old) {
      old.onended = null
      old.pause()
      old.src = ''
      old.remove()
      videoInsertEl.value = null
    }
    isVideoInserting.value = false

    const v = document.createElement('video')
    // crossOrigin MUST be set before src to prevent canvas tainting.
    // Setting src first triggers a CORS-unaware request; drawImage on the
    // resulting canvas will throw SecurityError on captureStream().
    // Note: blob: URLs are same-origin — crossOrigin='anonymous' is harmless for them.
    v.crossOrigin = 'anonymous'
    v.src         = file.downloadUrl
    v.autoplay    = true
    v.muted       = false          // audio is routed through useAudioPipeline
    v.playsInline = true
    v.loop        = false
    // Hidden from UI — the preview component (VideoInsertPreview.vue) renders its
    // own <video> with the same src URL.  ctx.drawImage() works fine with
    // display:none elements so the mixer is unaffected.
    v.style.display = 'none'
    document.body.appendChild(v)
    v.play().catch(() => {})

    // Do NOT auto-stop on ended — let the video pause on the last frame.
    // The user closes it manually via the "停止插播" button.

    videoInsertEl.value    = v
    videoInsertMode.value  = mode
    videoInsertFile.value  = file
    isVideoInserting.value = true
  }

  // Track blob URL so we can revoke it when the insert ends
  let _blobUrl: string | null = null

  /** Stop the current video insert and clean up the <video> element. */
  function stopVideoInsert() {
    if (videoInsertEl.value) {
      videoInsertEl.value.pause()
      videoInsertEl.value.src = ''
      videoInsertEl.value.remove()
      videoInsertEl.value = null
    }
    // Revoke blob URL to free memory (only set when using local file insert)
    if (_blobUrl) {
      URL.revokeObjectURL(_blobUrl)
      _blobUrl = null
    }
    videoInsertFile.value  = null
    isVideoInserting.value = false
  }

  /**
   * Insert a local File (e.g. mp4 dragged or picked by the user) into the stream.
   * Uses createObjectURL so no upload or network is needed — great for testing
   * the insert pipeline before the cloud drive API is wired up.
   */
  function startLocalFileInsert(file: File, mode: VideoInsertMode = 'pip') {
    // Revoke any previous blob URL first
    if (_blobUrl) { URL.revokeObjectURL(_blobUrl); _blobUrl = null }

    const blobUrl = URL.createObjectURL(file)
    _blobUrl = blobUrl

    // Reuse startVideoInsert logic by constructing a minimal CloudFile-like object
    const localCloudFile: CloudFile = {
      id:          `local-${Date.now()}`,
      name:        file.name,
      type:        'video',
      downloadUrl: blobUrl,
      coverUrl:    '',
      duration:    '',
      size:        `${(file.size / 1024 / 1024).toFixed(1)} MB`,
      width:       0,
      height:      0,
      mediaType:   file.type,
      creatorName: '',
      createTime:  '',
    }

    // For local blob URLs, crossOrigin must NOT be set (blob URLs are same-origin,
    // setting crossOrigin causes a CORS preflight that always fails for blob URLs).
    const old = videoInsertEl.value
    if (old) { old.onended = null; old.pause(); old.src = ''; old.remove(); videoInsertEl.value = null }
    isVideoInserting.value = false

    const v = document.createElement('video')
    // Do NOT set crossOrigin for blob: URLs — they are same-origin by definition
    v.src         = blobUrl
    v.autoplay    = true
    v.muted       = false
    v.playsInline = true
    v.loop        = false
    // Off-screen (not display:none) so captureStream() produces real frames
    v.style.display = 'none'
    document.body.appendChild(v)
    v.play().catch(() => {})

    // Do NOT auto-stop on ended — pause on last frame, user closes manually.

    videoInsertEl.value    = v
    videoInsertMode.value  = mode
    videoInsertFile.value  = localCloudFile
    isVideoInserting.value = true
  }

  /** Toggle between fullscreen and pip modes during an active insert. */
  function switchVideoInsertMode() {
    videoInsertMode.value = videoInsertMode.value === 'pip' ? 'fullscreen' : 'pip'
  }

  return {
    cameraStream, micStream, screenStream,
    isCameraOn, isMicOn, isScreenSharing, isCameraVisible,
    videoDevices, audioDevices, activeVideoDeviceId, activeAudioDeviceId,
    cameraPip, updateCameraPip, isCameraMaximized, maximizeCamera, restoreCamera,
    loadDevices, toggleCamera, toggleMic, switchCamera, switchMic,
    startScreenShare, stopScreenShare, toggleCameraVisibility,
    // video insert
    videoInsertEl, videoInsertMode, videoInsertFile, isVideoInserting,
    startVideoInsert, startLocalFileInsert, stopVideoInsert, switchVideoInsertMode,
    videoPip, updateVideoPip,
  }
})
