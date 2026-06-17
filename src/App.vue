<script setup lang="ts">
import { ref, computed, provide, onMounted, watch, nextTick } from 'vue'
import TopBar from '@/components/layout/TopBar.vue'
import LeftToolbar from '@/components/layout/LeftToolbar.vue'
import BottomBar from '@/components/layout/BottomBar.vue'
import RightPanel from '@/components/layout/RightPanel.vue'
import WhiteboardCanvas from '@/components/whiteboard/WhiteboardCanvas.vue'
import CameraPreview from '@/components/camera/CameraPreview.vue'
import StreamSettings from '@/components/stream/StreamSettings.vue'
import WhiteboardTabs from '@/components/whiteboard/WhiteboardTabs.vue'
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
import { useAudioPipeline } from '@/composables/useAudioPipeline'
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

// ── Canvas aspect ratio from stream resolution ────────────────────────────────
// When the user picks a portrait resolution (e.g. 720x1280), constrain the
// canvas-wrap to that aspect ratio so the authoring view matches the output.
const canvasAspectRatio = computed(() => {
  const [w, h] = streamStore.config.resolution.split('x').map(Number)
  if (!w || !h) return null
  return `${w} / ${h}`
})
const isPortraitMode = computed(() => {
  const [w, h] = streamStore.config.resolution.split('x').map(Number)
  return !!w && !!h && h > w
})
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

const mixer         = useStreamMixer()
const webrtc        = useWebRTC()
const rtmp          = useRTMP()
const netMon        = useNetworkMonitor()
const toast         = useToast()
const audioPipeline = useAudioPipeline()

// Cloud drive panel visibility
const showCloudDrive = ref(false)

// Shared scroll position for document mode — DocViewer writes, WhiteboardCanvas reads
const docScrollTop = ref(0)
provide('docScrollTop', docScrollTop)

// Sync canvas content visibility with camera maximize/restore.
// immediate: isContentHidden defaults to true (camera-first entry scene), so
// the camera PiP must be maximized on startup, not only on later toggles.
watch(() => wbStore.isContentHidden, (hidden) => {
  if (hidden) mediaStore.maximizeCamera()
  else        mediaStore.restoreCamera()
}, { immediate: true })

// Doc drawer (document panel overlay)
const docDrawerOpen = ref(false)
provide('docDrawerOpen', docDrawerOpen)
provide('toggleDocDrawer', () => { docDrawerOpen.value = !docDrawerOpen.value })

// Entering document mode (e.g. clicking the 文档 button) opens the panel so
// the page list / upload entry is immediately visible; leaving closes it.
// (DocViewer still auto-collapses it once a document finishes rendering.)
watch(() => wbStore.activeMode, (mode) => {
  docDrawerOpen.value = mode === 'document'
})

onMounted(async () => {
  log('onMounted 开始 | 构建模式 =', import.meta.env.MODE, '| VERBOSE_LOG =', VERBOSE_LOG)

  // Exchange the one-time portal code for a session token (or reuse cookie /
  // dev env fallback). Block the UI until this resolves so an expired link
  // surfaces immediately instead of after device setup.
  try {
    log('开始鉴权 bootstrap()…')
    await roomStore.bootstrap()
    log('鉴权成功 | roomId =', roomStore.room.id || '(空)', '| token.length =', roomStore.token.length, '| userId =', roomStore.userId || '(空)')

    // Apply the server-issued WHIP push URL so the settings panel and WebRTC
    // path use the real address instead of the localhost dev fallback. Only
    // override when the server actually returned one.
    if (roomStore.pushStreamUrl) {
      streamStore.updateConfig({ whipUrl: roomStore.pushStreamUrl })
      log('已写入真实 WHIP 推流地址 → whipUrl =', roomStore.pushStreamUrl)
    } else {
      log('未获取到 pushStreamUrl，沿用默认 whipUrl =', streamStore.config.whipUrl)
    }

    // Await room detail before showing the UI so that portrait/landscape
    // resolution is applied on first render (no layout flicker).
    // loadRoomDetail never throws — it falls back to test data internally.
    await roomStore.loadRoomDetail()
    authState.value = 'ready'
    log('室详情加载完成 → authState=ready')
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

// ── Audio source wiring (persistent pipeline) ────────────────────────────────
// The output stream carries ONE fixed audio track (see useAudioPipeline):
// swapping MediaStream tracks does not reach an active RTCPeerConnection and
// breaks MediaRecorder, so mic / video-insert / screen-share audio connect and
// disconnect inside the Web Audio graph instead. The wiring is independent of
// live state — sources hooked up before "开始直播" are already in the mix.
watch(() => mediaStore.micStream, (s) => audioPipeline.setMic(s), { immediate: true })
watch(
  () => mediaStore.videoInsertEl,
  (el) => audioPipeline.setInsert(el as HTMLVideoElement | null),
  { immediate: true },
)
watch(() => mediaStore.screenStream, (s) => audioPipeline.setScreen(s), { immediate: true })

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
      <!-- Main column: (toolbar + canvas) row on top, BottomBar below.
           BottomBar spans the full column width so toggling the toolbar's
           visibility never shifts the control bar horizontally. -->
      <div class="app-layout__main">
        <div class="app-layout__work">
          <!-- Drawing toolbar — hidden when camera is maximized or during screen share -->
          <LeftToolbar v-show="!wbStore.isContentHidden && wbStore.activeMode !== 'screen'" />

          <div class="app-layout__canvas-area" :class="{ 'app-layout__canvas-area--portrait': isPortraitMode }">
            <!-- Document panel drawer — lives in canvas-area so it always opens
                 from the left edge (next to LeftToolbar) regardless of portrait/landscape mode -->
            <DocSidebar :open="docDrawerOpen && !wbStore.isContentHidden" @close="docDrawerOpen = false" />
            <WhiteboardTabs
              v-show="!wbStore.isContentHidden && wbStore.activeMode === 'whiteboard'"
            />
            <div
              class="app-layout__canvas-wrap"
              :class="{ 'app-layout__canvas-wrap--constrained': isPortraitMode }"
              :style="canvasAspectRatio ? { aspectRatio: canvasAspectRatio } : {}"
              @dragover="onCanvasDragOver"
              @drop="onCanvasDrop"
            >
              <WhiteboardCanvas v-show="!wbStore.isContentHidden && (wbStore.activeMode === 'whiteboard' || wbStore.activeMode === 'screen' || wbStore.activeMode === 'document')" />
              <ScreenSharePreview v-if="!wbStore.isContentHidden && wbStore.activeMode === 'screen' && mediaStore.isScreenSharing" />
              <DocViewer ref="docViewerRef" v-show="!wbStore.isContentHidden && wbStore.activeMode === 'document'" />
              <!-- Co-stream participant grid overlay (always visible when there are guests) -->
              <CoStreamGrid v-if="coStreamStore.participantCount > 0" />
              <!-- Video insert UI preview (PiP or fullscreen overlay in canvas area) -->
              <VideoInsertPreview />
              <CameraPreview />
            </div>
          </div>
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

  // Main column (everything left of RightPanel): work row + BottomBar.
  &__main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  // Work row: LeftToolbar + canvas area.
  &__work {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  &__canvas-area {
    position: relative; // DocSidebar uses position:absolute relative to this
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-width: 0;

    // Portrait mode: dark letterbox on the sides
    &--portrait {
      background: $color-bg-dark;
    }
  }

  &__canvas-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
    min-height: 0;
    width: 100%;
    // Recess the bright canvas into the dark workspace instead of butting
    // a white rectangle straight against the panels.
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
      0 0 32px rgba(0, 0, 0, 0.45);

    // Portrait mode: stay in flex flow (flex:1 gives correct height after
    // WhiteboardTabs + BottomBar are accounted for), then let aspect-ratio
    // derive width. align-self:center prevents the default stretch so the
    // narrow portrait box sits centered with dark bars on both sides.
    &--constrained {
      flex: 1;
      min-height: 0;
      width: auto;
      align-self: center;
    }
  }
}
</style>
