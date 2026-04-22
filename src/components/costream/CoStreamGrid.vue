<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useCoStreamStore } from '@/stores/coStreamStore'
import { computeCoStreamLayout } from '@/utils/coStreamLayout'

const coStreamStore = useCoStreamStore()

/** Container dimensions for layout calculation */
const containerEl = ref<HTMLDivElement | null>(null)
const containerW = ref(1280)
const containerH = ref(720)

let ro: ResizeObserver | null = null

onMounted(() => {
  if (!containerEl.value) return
  ro = new ResizeObserver(([entry]) => {
    containerW.value = entry!.contentRect.width
    containerH.value = entry!.contentRect.height
  })
  ro.observe(containerEl.value)
})

onUnmounted(() => {
  ro?.disconnect()
  ro = null
})

/** Single computed combining guest data + layout cells */
const guestCells = computed(() => {
  const guests = coStreamStore.participantList
  if (guests.length === 0) return []
  const rects = computeCoStreamLayout(guests.length, containerW.value, containerH.value)
  return guests.map((guest, i) => ({
    guest,
    leftPct:   (rects[i]!.x / containerW.value) * 100,
    topPct:    (rects[i]!.y / containerH.value) * 100,
    widthPct:  (rects[i]!.w / containerW.value) * 100,
    heightPct: (rects[i]!.h / containerH.value) * 100,
  }))
})

/** Attach stream to a <video> element */
function setupVideo(el: Element | null, stream: MediaStream | undefined) {
  const video = el as HTMLVideoElement | null
  if (!video || !stream) return
  if (video.srcObject !== stream) {
    video.srcObject = stream
    video.play().catch(() => {})
  }
}
</script>

<template>
  <div ref="containerEl" class="cs-grid">
    <div
      v-for="item in guestCells"
      :key="item.guest.id"
      class="cs-grid__cell"
      :style="{
        left:   item.leftPct   + '%',
        top:    item.topPct    + '%',
        width:  item.widthPct  + '%',
        height: item.heightPct + '%',
      }"
    >
      <!-- Video when stream is available -->
      <video
        v-if="item.guest.stream"
        class="cs-grid__video"
        autoplay
        muted
        playsinline
        :ref="(el) => setupVideo(el as Element, item.guest.stream)"
      />
      <!-- Placeholder avatar -->
      <div v-else class="cs-grid__placeholder">
        <span class="cs-grid__avatar-char">{{ item.guest.nickname[0] }}</span>
      </div>

      <!-- Name bar -->
      <div class="cs-grid__name-bar">
        <svg
          v-if="!item.guest.audioEnabled"
          class="cs-grid__mute-icon"
          width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
        >
          <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2"/>
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"
                fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <span>{{ item.guest.nickname }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.cs-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;

  &__cell {
    position: absolute;
    border: 2px solid rgba(255, 255, 255, 0.35);
    background: #1a1a1a;
    overflow: hidden;
    pointer-events: auto;
  }

  &__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  &__placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #252525;
  }

  &__avatar-char {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: $color-accent;
    color: #fff;
    font-size: 20px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__name-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 22px;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 6px;
    color: #fff;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__mute-icon {
    color: $color-danger;
    flex-shrink: 0;
  }
}
</style>
