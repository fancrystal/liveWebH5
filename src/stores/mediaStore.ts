import { defineStore } from 'pinia'
import { ref } from 'vue'
import { filterRealDevices } from '@/utils/browser'

export const useMediaStore = defineStore('media', () => {
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
        audio: { deviceId: activeAudioDeviceId.value || undefined },
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
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } })
    cameraStream.value = stream
    isCameraVisible.value = true
  }

  async function switchMic(deviceId: string) {
    activeAudioDeviceId.value = deviceId
    if (!isMicOn.value) return
    micStream.value?.getAudioTracks().forEach(t => t.stop())
    micStream.value = null
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } })
    micStream.value = stream
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

  return {
    cameraStream, micStream, screenStream,
    isCameraOn, isMicOn, isScreenSharing, isCameraVisible,
    videoDevices, audioDevices, activeVideoDeviceId, activeAudioDeviceId,
    cameraPip, updateCameraPip,
    loadDevices, toggleCamera, toggleMic, switchCamera, switchMic,
    startScreenShare, stopScreenShare, toggleCameraVisibility,
  }
})
