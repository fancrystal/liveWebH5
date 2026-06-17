<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'

const mediaStore = useMediaStore()
const containerEl = ref<HTMLElement | null>(null)

// ── Play state overlay ───────────────────────────────────────────────────────
const isPaused = ref(true)

function onVideoPlay()  { isPaused.value = false }
function onVideoPause() { isPaused.value = true  }

function attachPauseListeners(el: HTMLVideoElement) {
  el.addEventListener('play',  onVideoPlay)
  el.addEventListener('pause', onVideoPause)
  isPaused.value = el.paused
}

function detachPauseListeners(el: HTMLVideoElement) {
  el.removeEventListener('play',  onVideoPlay)
  el.removeEventListener('pause', onVideoPause)
}

function clickPlay(e: MouseEvent) {
  e.stopPropagation()
  const el = mediaStore.videoInsertEl as HTMLVideoElement | null
  el?.play().catch(() => {})
}

// ── Video dimensions ─────────────────────────────────────────────────────────
const videoW = ref(0)
const videoH = ref(0)
const isPortrait = computed(() => videoH.value > 0 && videoH.value > videoW.value)

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

// ── Shared element attachment (Bug 2/4 fix) ──────────────────────────────────
// Instead of cloning the source into a second <video>, we render the SAME
// element the mixer draws and the control bar controls (mediaStore.videoInsertEl).
// One element → play / pause / seek state can never diverge between the browser
// preview and the push-stream.
/** src of the last attached element — detects "new video" vs a pip↔fullscreen toggle */
let lastElUrl = ''

function applyVideoStyle(el: HTMLVideoElement) {
  // The appended native node lives outside Vue's scoped CSS, so style it inline.
  el.style.display      = 'block'
  el.style.background    = '#000'
  el.style.pointerEvents = 'none'
  el.style.objectFit     = 'contain'
  el.style.borderRadius  = 'inherit'
  if (mediaStore.videoInsertMode === 'fullscreen') {
    el.style.width  = '100%'
    el.style.height = '100%'
  } else {
    // PiP: container width is driven by pipStyle; video keeps intrinsic ratio.
    el.style.width  = '100%'
    el.style.height = 'auto'
  }
}

function readDimensions(el: HTMLVideoElement) {
  const set = () => { videoW.value = el.videoWidth; videoH.value = el.videoHeight }
  if (el.videoWidth > 0) set()
  else el.addEventListener('loadedmetadata', set, { once: true })
}

function attach() {
  const el = mediaStore.videoInsertEl as HTMLVideoElement | null
  const container = containerEl.value
  if (!mediaStore.isVideoInserting || !el || !container) return

  const url = el.src
  const isNew = url !== lastElUrl
  lastElUrl = url

  // Reset pip position/size only for a genuinely new video, not on a mode toggle.
  if (isNew) {
    videoW.value = 0
    videoH.value = 0
    userX.value  = null
    userY.value  = null
    userW.value  = null
  }

  // Move the shared element into the preview container (it starts hidden on body).
  if (el.parentElement !== container) {
    // Detach old listeners from previous element before moving
    detachPauseListeners(el)
    container.appendChild(el)
  }
  applyVideoStyle(el)
  readDimensions(el)
  attachPauseListeners(el)

  // Push default pip coords to the store so the mixer matches from frame 1.
  Promise.resolve().then(() => syncToStore())
}

watch(
  [
    () => mediaStore.isVideoInserting,
    () => mediaStore.videoInsertMode,
    () => mediaStore.videoInsertEl,
  ],
  ([inserting]) => {
    if (!inserting) {
      const el = mediaStore.videoInsertEl as HTMLVideoElement | null
      if (el) detachPauseListeners(el)
      videoW.value  = 0
      videoH.value  = 0
      isPaused.value = true
      lastElUrl     = ''
      return
    }
    attach()
  },
  { flush: 'post' },
)

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup',   onPointerUp)
  // Handle the case where an insert is already active when this mounts.
  if (mediaStore.isVideoInserting) attach()
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
    <!-- Container stays mounted for the whole insert; pip/fullscreen via class.
         The shared <video> (mediaStore.videoInsertEl) is appended here in attach(). -->
    <div
      v-if="mediaStore.isVideoInserting"
      ref="containerEl"
      class="vip"
      :class="mediaStore.videoInsertMode === 'pip' ? 'vip--pip' : 'vip--fullscreen'"
      :style="mediaStore.videoInsertMode === 'pip' ? pipStyle : undefined"
      @pointerdown="onDragStart"
    >
      <span class="vip__badge">
        <template v-if="mediaStore.videoInsertMode === 'pip'">
          画中画<template v-if="videoW > 0"> · {{ videoW }}×{{ videoH }}</template>
        </template>
        <template v-else>全屏</template>
      </span>
      <!-- Play button overlay — shown when video hasn't started yet -->
      <button v-if="isPaused" class="vip__play-btn" @click="clickPlay">
        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </button>
      <div
        v-if="mediaStore.videoInsertMode === 'pip'"
        class="vip__resize"
        @pointerdown="onResizeStart"
      />
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.vip {
  position: absolute;
  overflow: hidden;
  border-radius: 10px;
  z-index: 110;

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
    z-index: 2;
  }

  &__play-btn {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    cursor: pointer;
    z-index: 3;
    color: #fff;
    border-radius: inherit;
    pointer-events: all;
    transition: background 0.15s;
    &:hover { background: rgba(0, 0, 0, 0.6); }
  }

  &__resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 20px;
    height: 20px;
    cursor: se-resize;
    pointer-events: all;
    z-index: 2;
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
}

.vip-fade-enter-active,
.vip-fade-leave-active { transition: opacity 0.25s ease; }
.vip-fade-enter-from,
.vip-fade-leave-to     { opacity: 0; }
</style>
