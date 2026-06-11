<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted, onMounted, watchEffect } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'

const mediaStore = useMediaStore()
const videoEl = ref<HTMLVideoElement | null>(null)

// ─── Canvas container (.app-layout__canvas-wrap) tracking ─────────────────
// The PiP lives inside this container; we need its live dimensions to
// translate the on-screen pos/size into percentages the mixer can mirror.
const containerW = ref(0)
const containerH = ref(0)
let resizeObserver: ResizeObserver | null = null

function attachContainerObserver() {
  const el = document.querySelector('.app-layout__canvas-wrap') as HTMLElement | null
  if (!el || resizeObserver) return
  const rect = el.getBoundingClientRect()
  containerW.value = rect.width
  containerH.value = rect.height
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      containerW.value = entry.contentRect.width
      containerH.value = entry.contentRect.height
    }
  })
  resizeObserver.observe(el)
}

onMounted(() => { attachContainerObserver() })
onUnmounted(() => { resizeObserver?.disconnect(); resizeObserver = null })

watch(
  () => mediaStore.cameraStream,
  async (stream) => {
    await nextTick()
    const el = videoEl.value
    if (!el) return
    if (el.srcObject === stream) return
    el.srcObject = stream ?? null
    if (stream) {
      try { await el.play() } catch { /* muted autoplay */ }
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (videoEl.value) videoEl.value.srcObject = null
})

// ─── Size (16:9, clamp 160–480px wide) ───────────────────────────────────────
const ASPECT = 16 / 9
const MIN_W  = 160
const MAX_W  = 480

const size = ref({ w: 224, h: 126 })

// ─── Drag (move) ─────────────────────────────────────────────────────────────
const pos = ref({ x: 0, y: 0 })
let dragStart = { x: 0, y: 0, px: 0, py: 0 }
let dragging = false

function onMouseDown(e: MouseEvent) {
  // Ignore resize handle clicks
  if ((e.target as HTMLElement).classList.contains('camera-pip__resize')) return
  dragging = true
  dragStart = { x: e.clientX, y: e.clientY, px: pos.value.x, py: pos.value.y }
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragUp)
}

function onDragMove(e: MouseEvent) {
  if (!dragging) return
  pos.value = {
    x: dragStart.px + (e.clientX - dragStart.x),
    y: dragStart.py + (e.clientY - dragStart.y),
  }
}

function onDragUp() {
  dragging = false
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragUp)
}

// ─── Resize (corner handle) ──────────────────────────────────────────────────
// right:10px 定位下，宽度增大时右边固定、左边向左扩。
// 为使左上角成为锚点，每次宽度增量 ΔW 都对应 pos.x += ΔW 来补偿。
let resizeStart = { x: 0, w: 224, px: 0 }
let resizing = false

function onResizeMouseDown(e: MouseEvent) {
  e.stopPropagation()
  resizing = true
  resizeStart = { x: e.clientX, w: size.value.w, px: pos.value.x }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeUp)
}

function onResizeMove(e: MouseEvent) {
  if (!resizing) return
  const newW = Math.min(MAX_W, Math.max(MIN_W, resizeStart.w + (e.clientX - resizeStart.x)))
  // pos.x 补偿：左边缘 = 右边缘 - width，右边缘固定，所以 pos.x 跟着宽度变化量移动
  pos.value = { x: resizeStart.px + (newW - resizeStart.w), y: pos.value.y }
  size.value = { w: Math.round(newW), h: Math.round(newW / ASPECT) }
}

function onResizeUp() {
  resizing = false
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
}

// ─── Scroll wheel to scale (以左上角为锚点) ──────────────────────────────────
// ─── Double-click fullscreen within canvas area ───────────────────────────────
const isFullscreen = ref(false)

function onDblClick() {
  isFullscreen.value = !isFullscreen.value
}

// Keep local isFullscreen in sync with the store's isCameraMaximized
// (triggered externally when whiteboard/document content is hidden).
// immediate: the store may already be maximized BEFORE this component mounts
// (camera-first default scene) — without it the PiP would render windowed and
// overwrite the store's fullscreen percentages via the watchEffect below.
watch(() => mediaStore.isCameraMaximized, (maximized) => {
  isFullscreen.value = maximized
}, { immediate: true })

// ─── Sync pos+size to store as percentages of container ─────────────────────
// Mixer uses these percentages × output canvas dimensions, so the PiP keeps
// its visual proportions regardless of how big/small the UI canvas is.
watchEffect(() => {
  const cw = containerW.value
  const ch = containerH.value
  if (cw === 0 || ch === 0) return
  if (isFullscreen.value) {
    mediaStore.updateCameraPip({ xPct: 0, yPct: 0, wPct: 1, hPct: 1 })
    return
  }
  // CameraPreview default position is `top:10px right:10px`, then
  // `transform: translate(pos.x, pos.y)`. Convert to left/top px first.
  const leftPx = cw - 10 - size.value.w + pos.value.x
  const topPx  = 10 + pos.value.y
  mediaStore.updateCameraPip({
    xPct: leftPx        / cw,
    yPct: topPx         / ch,
    wPct: size.value.w  / cw,
    hPct: size.value.h  / ch,
  })
})

function onWheel(e: WheelEvent) {
  const delta = -e.deltaY * 0.3
  const newW = Math.min(MAX_W, Math.max(MIN_W, size.value.w + delta))
  const deltaW = newW - size.value.w
  pos.value = { x: pos.value.x + deltaW, y: pos.value.y }
  size.value = { w: Math.round(newW), h: Math.round(newW / ASPECT) }
}
</script>

<template>
  <div
    v-if="mediaStore.isCameraOn && mediaStore.isCameraVisible && mediaStore.cameraStream"
    class="camera-pip no-select"
    :class="{ 'camera-pip--fullscreen': isFullscreen }"
    :style="isFullscreen ? {} : { transform: `translate(${pos.x}px, ${pos.y}px)`, width: `${size.w}px`, height: `${size.h}px` }"
    @mousedown="onMouseDown"
    @dblclick.stop="onDblClick"
    @wheel.prevent="onWheel"
  >
    <video
      ref="videoEl"
      autoplay
      muted
      playsinline
      class="camera-pip__video"
    />
    <!-- Resize handle — bottom-right corner -->
    <div
      class="camera-pip__resize"
      title="拖拽缩放"
      @mousedown.stop="onResizeMouseDown"
    />
  </div>
</template>

<style lang="scss" scoped>
.camera-pip {
  position: absolute;
  top: 10px;
  right: 10px;
  border-radius: 8px;
  overflow: hidden;
  background: #111;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  cursor: move;
  z-index: 20;
  border: 2px solid rgba(255, 255, 255, 0.12);
  user-select: none;

  &__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transform: scaleX(-1);
  }

  // Resize handle — bottom-right corner triangle
  &__resize {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 18px;
    height: 18px;
    cursor: se-resize;
    z-index: 3;
    opacity: 0;
    transition: opacity 0.2s;

    // Draw diagonal stripes as visual cue
    background: linear-gradient(
      135deg,
      transparent 40%,
      rgba(255,255,255,0.55) 40%,
      rgba(255,255,255,0.55) 50%,
      transparent 50%,
      transparent 65%,
      rgba(255,255,255,0.55) 65%,
      rgba(255,255,255,0.55) 75%,
      transparent 75%
    );
  }

  &:hover &__resize { opacity: 1; }

  // Fullscreen within canvas container
  &--fullscreen {
    top: 0 !important;
    right: 0 !important;
    left: 0 !important;
    bottom: 0 !important;
    width: 100% !important;
    height: 100% !important;
    transform: none !important;
    border-radius: 0;
    z-index: 30;
    cursor: default;
  }
}
</style>
