<script setup lang="ts">
import { ref, provide, onMounted, watch, nextTick } from 'vue'
import TopBar from '@/components/layout/TopBar.vue'
import LeftToolbar from '@/components/layout/LeftToolbar.vue'
import BottomBar from '@/components/layout/BottomBar.vue'
import RightPanel from '@/components/layout/RightPanel.vue'
import WhiteboardTabs from '@/components/whiteboard/WhiteboardTabs.vue'
import WhiteboardCanvas from '@/components/whiteboard/WhiteboardCanvas.vue'
import CameraPreview from '@/components/camera/CameraPreview.vue'
import StreamSettings from '@/components/stream/StreamSettings.vue'
import DocViewer from '@/components/document/DocViewer.vue'
import DocSidebar from '@/components/document/DocSidebar.vue'
import ScreenSharePreview from '@/components/media/ScreenSharePreview.vue'
import CoStreamGrid from '@/components/costream/CoStreamGrid.vue'
import ToastNotification from '@/components/ui/ToastNotification.vue'
import DeviceCheck from '@/components/setup/DeviceCheck.vue'
import CloudDrivePanel from '@/components/cloud/CloudDrivePanel.vue'
import VideoInsertBar from '@/components/cloud/VideoInsertBar.vue'
import VideoInsertPreview from '@/components/cloud/VideoInsertPreview.vue'

import { useStreamStore } from '@/stores/streamStore'
import { useMediaStore } from '@/stores/mediaStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useCoStreamStore } from '@/stores/coStreamStore'
import { useStreamMixer } from '@/composables/useStreamMixer'
import { useWebRTC } from '@/composables/useWebRTC'
import { useRTMP } from '@/composables/useRTMP'
import { useCoStream } from '@/composables/useCoStream'
import { useNetworkMonitor } from '@/composables/useNetworkMonitor'
import { useToast } from '@/composables/useToast'
import { useAudioMixer } from '@/composables/useAudioMixer'
import { isSafari, supportsRTMP } from '@/utils/browser'
import { signalService } from '@/services/SignalService'
import { useRoomStore } from '@/stores/roomStore'

/** Verbose diagnostic logging, toggled by VITE_VERBOSE_LOG. */
const VERBOSE_LOG = import.meta.env.VITE_VERBOSE_LOG === 'true'
/** Prefixed console logger; only emits when VERBOSE_LOG is on. */
function log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log('[App]', ...args)
}

/** false = device check page, true = main live interface */
const deviceCheckDone = ref(false)

function handleDeviceCheckDone(payload: {
  cameraStream: MediaStream | null
  micStream:    MediaStream | null
  cameraDeviceId: string
  micDeviceId:    string
}) {
  // Directly inject the already-open streams — no need to re-acquire hardware
  if (payload.cameraDeviceId) mediaStore.activeVideoDeviceId = payload.cameraDeviceId
  if (payload.micDeviceId)    mediaStore.activeAudioDeviceId = payload.micDeviceId

  if (payload.cameraStream) {
    mediaStore.cameraStream = payload.cameraStream
    mediaStore.isCameraOn   = true
  }
  if (payload.micStream) {
    mediaStore.micStream = payload.micStream
    mediaStore.isMicOn   = true
  }

  deviceCheckDone.value = true
}

const streamStore    = useStreamStore()
const mediaStore     = useMediaStore()
const wbStore        = useWhiteboardStore()
const coStreamStore  = useCoStreamStore()
const roomStore      = useRoomStore()
const showSettings   = ref(false)

/** Auth bootstrap gate: 'loading' → exchange in flight; 'error' → expired/used link. */
const authState    = ref<'loading' | 'ready' | 'error'>('loading')
const authErrorMsg = ref('')

function reloadPage() {
  window.location.reload()
}

const coStream = useCoStream()

// Provide coStream controls to RightPanel
provide('coStream', coStream)
const whiteboardCanvasEl = ref<HTMLCanvasElement | null>(null)
const docViewerRef = ref<{ loadFile: (f: File) => void; getVisibleCanvas: () => HTMLCanvasElement | null } | null>(null)

function onCanvasDragOver(e: DragEvent) { e.preventDefault() }
function onCanvasDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (!file) return
  if (file.type === 'application/pdf') {
    wbStore.setActiveMode('document')
    nextTick(() => docViewerRef.value?.loadFile(file))
  }
}

const mixer      = useStreamMixer()
const webrtc     = useWebRTC()
const rtmp       = useRTMP()
const netMon     = useNetworkMonitor()
const toast      = useToast()
const audioMixer = useAudioMixer()

// Cloud drive panel visibility
const showCloudDrive = ref(false)

onMounted(async () => {
  log('onMounted 开始 | 构建模式 =', import.meta.env.MODE, '| VERBOSE_LOG =', VERBOSE_LOG)

  // Exchange the one-time portal code for a session token (or reuse cookie /
  // dev env fallback). Block the UI until this resolves so an expired link
  // surfaces immediately instead of after device setup.
  try {
    log('开始鉴权 bootstrap()…')
    await roomStore.bootstrap()
    authState.value = 'ready'
    log('鉴权成功 → authState=ready | roomId =', roomStore.room.id || '(空)', '| token.length =', roomStore.token.length, '| userId =', roomStore.userId || '(空)')
  } catch (e) {
    authErrorMsg.value = e instanceof Error ? e.message : '登录失败，请刷新页面重试'
    authState.value = 'error'
    log('鉴权失败 → authState=error | 原因 =', authErrorMsg.value)
    return  // halt bootstrap — no signaling / device flow without a valid session
  }

  const browserOk = !(isSafari() || !supportsRTMP())
  log('浏览器能力检测 | isSafari =', isSafari(), '| supportsRTMP =', supportsRTMP(), '| RTMP 可用 =', browserOk)
  if (!browserOk) {
    toast.warn('当前浏览器不支持 RTMP 推流，推荐使用 WebRTC (WHIP) 模式')
  }

  // Connect to signaling server for whiteboard sync, chat, and co-streaming.
  // When VITE_SIGNAL_URL is empty (signaling backend not deployed), skip the
  // connection entirely — otherwise socket.io would fall back to the current
  // origin and spam failed wss attempts in the console.
  const signalUrl = (import.meta.env.VITE_SIGNAL_URL ?? '').trim()
  if (signalUrl) {
    const roomId = roomStore.room.id ?? 'default'
    const userId = 'host-' + Date.now()
    log('信令已配置，发起 socket.io 连接 →', signalUrl, '| roomId =', roomId, '| userId =', userId)
    signalService.connect(signalUrl, { roomId, userId, role: 'host' })
  } else {
    log('信令未配置 (VITE_SIGNAL_URL 为空)，跳过连接 — 聊天/连麦功能禁用')
  }

  log('onMounted 完成')
})

// ── Video insert audio mixing ────────────────────────────────────────────────
// When a video insert starts, mix the video's audio with the mic and replace
// the audio track in the output stream so viewers hear both.
// When the insert ends, restore the plain mic audio track.
watch(() => mediaStore.isVideoInserting, (inserting) => {
  if (!inserting) {
    // Always release the AudioContext — even if streaming hasn't started yet,
    // otherwise the AudioContext leaks when the user inserts then stops before
    // clicking "开始直播".
    audioMixer.stop()
    // Restore plain mic track only when a stream is active
    mixer.updateAudio()
    return
  }

  // Only wire audio into the output stream if streaming is active
  const outputStream = mixer.outputStream.value
  if (!outputStream || !mediaStore.videoInsertEl) return

  const mixedTrack = audioMixer.mix(
    mediaStore.micStream,
    mediaStore.videoInsertEl as HTMLVideoElement,
  )
  // Swap old audio tracks for the mixed track
  outputStream.getAudioTracks().forEach(t => outputStream.removeTrack(t))
  if (mixedTrack) outputStream.addTrack(mixedTrack)
})

// Start / stop network monitoring alongside WebRTC
watch(() => webrtc.pc.value, (conn) => {
  if (conn) netMon.start(conn)
  else netMon.stop()
})

// Provide canvas element ref so WhiteboardCanvas can expose its lower-canvas
provide('exposeWhiteboardCanvas', (el: HTMLCanvasElement) => {
  whiteboardCanvasEl.value = el
})

async function handleStartLive() {
  // Ensure at least mic is available; camera is optional
  if (!mediaStore.isMicOn) {
    try { await mediaStore.toggleMic() } catch { /* no mic — continue anyway */ }
  }

  const canvas = whiteboardCanvasEl.value
  if (!canvas) {
    console.warn('[App] whiteboard canvas not ready')
    return
  }

  const [resW, resH] = streamStore.config.resolution.split('x').map(Number)
  const stream = mixer.start(
    canvas,
    resW ?? 1280,
    resH ?? 720,
    () => docViewerRef.value?.getVisibleCanvas() ?? null,
    () => mediaStore.videoInsertEl,
  )
  streamStore.startLive()

  try {
    if (streamStore.config.mode === 'webrtc') {
      await webrtc.publish(stream)
    } else {
      rtmp.publish(stream)
    }
  } catch (e) {
    // Restore to 'preview' state so the button shows "开始直播" again
    toast.error(`推流启动失败：${e instanceof Error ? e.message : '未知错误'}`)
    streamStore.restorePreview()
    mixer.stop()
  }
}

function handleEndLive() {
  webrtc.stop()
  rtmp.stop()
  mixer.stop()
  streamStore.restorePreview()  // go straight back to preview, skip 'ended'
}

function handleMainAction() {
  if (streamStore.status === 'live') {
    handleEndLive()
  } else {
    handleStartLive()
  }
}

// Provide actions to BottomBar
provide('onMainAction', handleMainAction)
provide('onOpenSettings', () => { showSettings.value = true })
</script>

<template>
  <!-- Auth gate: block until the portal code is exchanged for a token -->
  <div v-if="authState === 'loading'" class="auth-gate">
    <div class="auth-gate__spinner" />
    <p class="auth-gate__text">正在进入直播间…</p>
  </div>

  <div v-else-if="authState === 'error'" class="auth-gate auth-gate--error">
    <p class="auth-gate__title">无法进入直播间</p>
    <p class="auth-gate__text">{{ authErrorMsg }}</p>
    <button class="auth-gate__btn" @click="reloadPage">刷新页面</button>
  </div>

  <template v-else>
    <DeviceCheck v-if="!deviceCheckDone" @done="handleDeviceCheckDone" />

    <div v-else class="app-layout">
    <TopBar />

    <div class="app-layout__body">
      <!-- Whiteboard / screen mode: drawing toolbar -->
      <LeftToolbar v-show="wbStore.activeMode !== 'document'" />
      <!-- Document mode: doc list + page thumbnail sidebar -->
      <DocSidebar v-show="wbStore.activeMode === 'document'" />

      <div class="app-layout__canvas-area">
        <WhiteboardTabs v-show="wbStore.activeMode !== 'document'" />
        <div class="app-layout__canvas-wrap" @dragover="onCanvasDragOver" @drop="onCanvasDrop">
          <WhiteboardCanvas v-show="wbStore.activeMode === 'whiteboard' || wbStore.activeMode === 'screen' || wbStore.activeMode === 'document'" />
          <ScreenSharePreview v-if="wbStore.activeMode === 'screen' && mediaStore.isScreenSharing" />
          <DocViewer ref="docViewerRef" v-show="wbStore.activeMode === 'document'" />
          <!-- Co-stream participant grid overlay (always visible when there are guests) -->
          <CoStreamGrid v-if="coStreamStore.participantCount > 0" />
          <!-- Video insert UI preview (PiP or fullscreen overlay in canvas area) -->
          <VideoInsertPreview />
          <CameraPreview />
        </div>
        <BottomBar @open-cloud-drive="showCloudDrive = true" />
      </div>

      <RightPanel />
    </div>

    <StreamSettings
      v-model:visible="showSettings"
      @apply="() => {}"
    />

    <!-- Cloud drive file picker -->
    <CloudDrivePanel
      v-if="showCloudDrive"
      @close="showCloudDrive = false"
    />

    <!-- Floating control bar shown while a video insert is active -->
    <VideoInsertBar />

    <ToastNotification />
    </div>
  </template>
</template>

<style lang="scss" scoped>
.auth-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
  height: 100%;
  background: $color-bg-dark;
  color: rgba(255, 255, 255, 0.85);

  &__spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: auth-spin 0.8s linear infinite;
  }

  &__title {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  &__text {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.65);
    max-width: 320px;
    text-align: center;
    line-height: 1.6;
  }

  &__btn {
    margin-top: 8px;
    padding: 8px 28px;
    font-size: 14px;
    color: #fff;
    background: #3b82f6;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s ease;

    &:hover { background: #2563eb; }
    &:active { background: #1d4ed8; }
  }

  &--error &__text { color: #fca5a5; }
}

@keyframes auth-spin {
  to { transform: rotate(360deg); }
}

.app-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: $color-bg-dark;

  &__body {
    display: flex;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  &__canvas-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-width: 0;
  }

  &__canvas-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
}
</style>
