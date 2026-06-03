<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'

const mediaStore = useMediaStore()
const containerEl = ref<HTMLElement | null>(null)
const previewEl   = ref<HTMLVideoElement | null>(null)

// ── Video dimensions ─────────────────────────────────────────────────────────
const videoW = ref(0)
const videoH = ref(0)
const isPortrait  = computed(() => videoH.value > 0 && videoH.value > videoW.value)
const aspectRatio = computed(() =>
  videoW.value > 0 && videoH.value > 0 ? `${videoW.value} / ${videoH.value}` : '16 / 9',
)

// ── PiP position / size ──────────────────────────────────────────────────────
const userX = ref<number | null>(null)
const userY = ref<number | null>(null)
const userW = ref<number | null>(null)
const defaultW = computed(() => isPortrait.value ? 140 : 240)

const pipStyle = computed(() => {
  if (mediaStore.videoInsertMode !== 'pip') return {}
  const w = userW.value ?? defaultW.value
  if (userX.value !== null && userY.value !== null) {
    return { left: `${userX.value}px`, top: `${userY.value}px`, right: 'auto', bottom: 'auto', width: `${w}px` }
  }
  return { width: `${w}px` }
})

// ── Video binding ─────────────────────────────────────────────────────────────
/** src of the last successfully bound video — used to detect "new video" vs mode switch */
let lastBoundUrl = ''

function bindSource(sourceEl: HTMLVideoElement | null) {
  const preview = previewEl.value
  if (!preview || !sourceEl) return

  const url = sourceEl.src
  if (!url) return

  const isNewVideo = url !== lastBoundUrl
  lastBoundUrl = url

  // Reset position/size only for a new video, not on pip↔fullscreen toggle
  if (isNewVideo) {
    videoW.value = 0
    videoH.value = 0
    userX.value  = null
    userY.value  = null
    userW.value  = null
  }
  // Sync default position to store so Mixer uses the right coordinates from frame 1
  // (containerEl may not exist yet at this point if we just mounted; syncToStore()
  //  is also called on pointerUp, so the store stays in sync during interaction)
  // We schedule a microtask so containerEl is ready after Vue paints the element.
  Promise.resolve().then(() => syncToStore())

  preview.src = url

  const onMeta = () => {
    videoW.value = preview.videoWidth
    videoH.value = preview.videoHeight
    // Seek close to the source's position only for a new video
    if (isNewVideo && sourceEl.currentTime > 0.5) {
      try { preview.currentTime = sourceEl.currentTime } catch { /* seek may fail */ }
    }
    // play() is called after metadata — avoids AbortError from interrupted load
    preview.play().catch((err: Error) => {
      // Ignore AbortError from mode switches that re-bind before play resolves
      if (err.name !== 'AbortError') console.error('[VideoInsertPreview] play()', err)
    })
  }

  if (preview.readyState >= 1 /* HAVE_METADATA */) {
    onMeta()
  } else {
    preview.addEventListener('loadedmetadata', onMeta, { once: true })
  }
}

/**
 * flush:'post' — runs AFTER Vue has committed DOM updates.
 *   • previewEl ref is guaranteed populated (no nextTick hack needed)
 *   • No second call from a stale pre-flush watcher → no AbortError
 *
 * Watching videoInsertMode as well handles pip↔fullscreen switches:
 * Vue destroys the old <video> and mounts a new one; without this, the new
 * element would have no src and show a black screen.
 */
watch(
  [() => mediaStore.isVideoInserting, () => mediaStore.videoInsertMode],
  ([inserting]) => {
    if (!inserting) {
      // Reset state — v-if destroys the <video> elements automatically
      videoW.value  = 0
      videoH.value  = 0
      lastBoundUrl  = ''
      return
    }
    bindSource(mediaStore.videoInsertEl as HTMLVideoElement | null)
  },
  { flush: 'post' },
)

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup',   onPointerUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup',   onPointerUp)
})

// ── Drag to move ─────────────────────────────────────────────────────────────
let dragging = false
let dragOriginX = 0, dragOriginY = 0
let dragOriginPipX = 0, dragOriginPipY = 0

function onDragStart(e: PointerEvent) {
  if (mediaStore.videoInsertMode !== 'pip') return
  if ((e.target as HTMLElement).classList.contains('vip__resize')) return
  dragging = true
  dragOriginX = e.clientX
  dragOriginY = e.clientY
  const el = containerEl.value!
  const rect = el.getBoundingClientRect()
  const parentRect = el.parentElement!.getBoundingClientRect()
  dragOriginPipX = rect.left - parentRect.left
  dragOriginPipY = rect.top  - parentRect.top
  userX.value = dragOriginPipX
  userY.value = dragOriginPipY
  e.preventDefault()
}

// ── Resize from corner ───────────────────────────────────────────────────────
let resizing = false
let resizeOriginX = 0, resizeOriginW = 0

function onResizeStart(e: PointerEvent) {
  resizing = true
  resizeOriginX = e.clientX
  resizeOriginW = userW.value ?? containerEl.value?.offsetWidth ?? defaultW.value
  if (userX.value === null && containerEl.value) {
    const rect = containerEl.value.getBoundingClientRect()
    const parentRect = containerEl.value.parentElement!.getBoundingClientRect()
    userX.value = rect.left - parentRect.left
    userY.value = rect.top  - parentRect.top
  }
  e.preventDefault()
  e.stopPropagation()
}

/** Sync current pixel position/size → store as percentages of canvas area */
function syncToStore() {
  const el     = containerEl.value
  const parent = el?.parentElement
  if (!el || !parent) return
  const parentRect = parent.getBoundingClientRect()
  const x = userX.value ?? (el.getBoundingClientRect().left - parentRect.left)
  const y = userY.value ?? (el.getBoundingClientRect().top  - parentRect.top)
  const w = el.offsetWidth
  const h = el.offsetHeight
  mediaStore.updateVideoPip({
    xPct: x / parentRect.width,
    yPct: y / parentRect.height,
    wPct: w / parentRect.width,
    hPct: h / parentRect.height,
  })
}

function onPointerMove(e: PointerEvent) {
  const parent = containerEl.value?.parentElement
  if (!parent) return
  const parentRect = parent.getBoundingClientRect()

  if (dragging) {
    const el = containerEl.value!
    const dx = e.clientX - dragOriginX
    const dy = e.clientY - dragOriginY
    userX.value = Math.max(0, Math.min(parentRect.width  - el.offsetWidth,  dragOriginPipX + dx))
    userY.value = Math.max(0, Math.min(parentRect.height - el.offsetHeight, dragOriginPipY + dy))
  }

  if (resizing) {
    const dx = e.clientX - resizeOriginX
    userW.value = Math.max(120, Math.min(parentRect.width * 0.55, resizeOriginW + dx))
  }
}

function onPointerUp() {
  if (dragging || resizing) {
    // Flush final position/size to store on mouse-up so Mixer picks it up
    syncToStore()
  }
  dragging = false
  resizing = false
}
</script>

<template>
  <Transition name="vip-fade">
    <!-- PiP mode -->
    <div
      v-if="mediaStore.isVideoInserting && mediaStore.videoInsertMode === 'pip'"
      ref="containerEl"
      class="vip vip--pip"
      :style="pipStyle"
      @pointerdown="onDragStart"
    >
      <video
        ref="previewEl"
        class="vip__video"
        :style="{ aspectRatio }"
        autoplay
        muted
        playsinline
      />
      <span class="vip__badge">
        画中画<template v-if="videoW > 0"> · {{ videoW }}×{{ videoH }}</template>
      </span>
      <div class="vip__resize" @pointerdown="onResizeStart" />
    </div>

    <!-- Fullscreen mode -->
    <div
      v-else-if="mediaStore.isVideoInserting && mediaStore.videoInsertMode === 'fullscreen'"
      class="vip vip--fullscreen"
    >
      <video
        ref="previewEl"
        class="vip__video"
        autoplay
        muted
        playsinline
      />
      <span class="vip__badge">全屏</span>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.vip {
  position: absolute;
  overflow: hidden;
  border-radius: 10px;
  z-index: 110;

  &__video {
    display: block;
    width: 100%;
    height: auto;
    background: #000;
    object-fit: contain;
    pointer-events: none;
  }

  &__badge {
    position: absolute;
    top: 6px;
    left: 8px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: rgba(255, 255, 255, 0.85);
    font-size: 10px;
    font-weight: 500;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }

  &__resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 20px;
    height: 20px;
    cursor: se-resize;
    pointer-events: all;
    &::after {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 10px;
      height: 10px;
      border-right: 2px solid rgba(255, 255, 255, 0.5);
      border-bottom: 2px solid rgba(255, 255, 255, 0.5);
    }
  }
}

.vip--pip {
  right: 14px;
  bottom: 14px;
  width: 240px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  border: 2px solid rgba(255, 255, 255, 0.2);
  cursor: grab;
  &:active { cursor: grabbing; }
}

.vip--fullscreen {
  inset: 0;
  border-radius: 0;
  z-index: 108;
  background: #000;
  .vip__video { width: 100%; height: 100%; object-fit: contain; }
}

.vip-fade-enter-active,
.vip-fade-leave-active { transition: opacity 0.25s ease; }
.vip-fade-enter-from,
.vip-fade-leave-to     { opacity: 0; }
</style>
