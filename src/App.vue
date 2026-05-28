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
import { isSafari, supportsRTMP } from '@/utils/browser'
import { signalService } from '@/services/SignalService'
import { useRoomStore } from '@/stores/roomStore'

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

const mixer   = useStreamMixer()
const webrtc  = useWebRTC()
const rtmp    = useRTMP()
const netMon  = useNetworkMonitor()
const toast   = useToast()

// Warn on Safari about RTMP unavailability
onMounted(() => {
  if (isSafari() || !supportsRTMP()) {
    toast.warn('当前浏览器不支持 RTMP 推流，推荐使用 WebRTC (WHIP) 模式')
  }

  // Connect to signaling server for whiteboard sync, chat, and co-streaming
  const signalUrl = import.meta.env.VITE_SIGNAL_URL ?? 'http://localhost:3000'
  const roomId = roomStore.room.id ?? 'default'
  const userId = 'host-' + Date.now()

  signalService.connect(signalUrl, { roomId, userId, role: 'host' })
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
  const stream = mixer.start(canvas, resW ?? 1280, resH ?? 720, () => docViewerRef.value?.getVisibleCanvas() ?? null)
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
          <CameraPreview />
        </div>
        <BottomBar />
      </div>

      <RightPanel />
    </div>

    <StreamSettings
      v-model:visible="showSettings"
      @apply="() => {}"
    />

    <ToastNotification />
  </div>
</template>

<style lang="scss" scoped>
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
