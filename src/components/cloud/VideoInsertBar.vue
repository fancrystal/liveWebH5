<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'

const mediaStore = useMediaStore()

const currentTime = ref(0)
const duration    = ref(0)
const isPaused    = ref(false)
const isLooping   = ref(false)

let rafId: number | null = null

function syncProgress() {
  if (!mediaStore.isVideoInserting) { rafId = null; return }
  const v = mediaStore.videoInsertEl
  if (v instanceof HTMLVideoElement) {
    currentTime.value = v.currentTime
    duration.value    = isFinite(v.duration) ? v.duration : 0
    isPaused.value    = v.paused
    isLooping.value   = v.loop
  }
  rafId = requestAnimationFrame(syncProgress)
}

onMounted(() => {
  if (mediaStore.isVideoInserting) rafId = requestAnimationFrame(syncProgress)
})
watch(() => mediaStore.isVideoInserting, (val) => {
  if (val && rafId === null) rafId = requestAnimationFrame(syncProgress)
})
onUnmounted(() => { if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null } })

function formatTime(secs: number): string {
  const s = Math.floor(secs)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

const progressPct = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
)

// Button shows the TARGET mode (what you'll switch TO), not the current mode
const modeLabelMap = { fullscreen: '画中画', pip: '全屏' } as const

/** Toggle pause / resume on both the hidden source element and the preview */
function togglePause() {
  const v = mediaStore.videoInsertEl
  if (!(v instanceof HTMLVideoElement)) return
  if (v.paused) {
    v.play().catch(() => {})
  } else {
    v.pause()
  }
}

/** Seek source to beginning and resume playback */
function restart() {
  const v = mediaStore.videoInsertEl
  if (!(v instanceof HTMLVideoElement)) return
  v.currentTime = 0
  v.play().catch(() => {})
}

/** Toggle loop on the source video element */
function toggleLoop() {
  const v = mediaStore.videoInsertEl
  if (!(v instanceof HTMLVideoElement)) return
  v.loop = !v.loop
  isLooping.value = v.loop
}

/** Click on the progress bar to seek */
function onProgressClick(e: MouseEvent) {
  const v = mediaStore.videoInsertEl
  if (!(v instanceof HTMLVideoElement) || !duration.value) return
  const bar = e.currentTarget as HTMLElement
  const ratio = e.offsetX / bar.offsetWidth
  v.currentTime = ratio * duration.value
}
</script>

<template>
  <div v-if="mediaStore.isVideoInserting" class="vib">
    <!-- Left: file icon + name -->
    <div class="vib__left">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="vib__icon">
        <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>
      <span class="vib__name">{{ mediaStore.videoInsertFile?.name ?? '插播视频' }}</span>
    </div>

    <!-- Center: progress bar + time -->
    <div class="vib__progress-wrap">
      <div class="vib__progress" @click="onProgressClick">
        <div class="vib__progress-fill" :style="{ width: progressPct + '%' }" />
      </div>
      <span class="vib__time">
        {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
      </span>
    </div>

    <!-- Right: pause · restart · mode toggle · stop -->
    <div class="vib__right">

      <!-- Pause / Resume -->
      <button
        class="vib__btn vib__btn--ctrl"
        :title="isPaused ? '继续播放' : '暂停'"
        @click="togglePause"
      >
        <template v-if="isPaused">
          <!-- Play icon -->
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          继续
        </template>
        <template v-else>
          <!-- Pause icon -->
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="6" y1="4" x2="6" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/>
          </svg>
          暂停
        </template>
      </button>

      <!-- Restart -->
      <button
        class="vib__btn vib__btn--ctrl"
        title="从头播放"
        @click="restart"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
        </svg>
        重置
      </button>

      <!-- Loop toggle -->
      <button
        class="vib__btn vib__btn--ctrl"
        :class="{ 'vib__btn--active': isLooping }"
        :title="isLooping ? '取消循环' : '循环播放'"
        @click="toggleLoop"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
        循环
      </button>

      <!-- Mode toggle -->
      <button
        class="vib__btn vib__btn--mode"
        :title="'切换到' + (mediaStore.videoInsertMode === 'pip' ? '全屏' : '画中画')"
        @click="mediaStore.switchVideoInsertMode()"
      >
        <template v-if="mediaStore.videoInsertMode === 'pip'">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
            <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
          </svg>
        </template>
        <template v-else>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <rect x="14" y="10" width="7" height="5" rx="1"/>
          </svg>
        </template>
        {{ modeLabelMap[mediaStore.videoInsertMode] }}
      </button>

      <!-- Stop -->
      <button
        class="vib__btn vib__btn--stop"
        title="停止插播"
        @click="mediaStore.stopVideoInsert()"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
        停止插播
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.vib {
  position: fixed;
  bottom: calc(#{$bottombar-height} + 10px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 500;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: $glass-bg;
  border: 1px solid $glass-border;
  border-radius: 10px;
  box-shadow: $shadow-md;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  max-width: 640px;
  min-width: 440px;

  &__left {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    max-width: 130px;
    color: $color-accent;
  }

  &__icon { flex-shrink: 0; }

  &__name {
    font-size: 12px;
    font-weight: 500;
    color: $color-text-primary;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__progress-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  &__progress {
    height: 4px;
    background: $color-border;
    border-radius: 2px;
    overflow: hidden;
    cursor: pointer;
    &:hover { height: 6px; margin: -1px 0; }
    transition: height 0.1s, margin 0.1s;
  }

  &__progress-fill {
    height: 100%;
    background: $color-accent;
    border-radius: 2px;
    transition: width 0.5s linear;
  }

  &__time {
    font-size: 10px;
    color: $color-text-muted;
    text-align: right;
  }

  &__right {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  &__btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 9px;
    border-radius: 6px;
    border: 1px solid $color-border;
    background: transparent;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    color: $color-text-secondary;

    &:hover { background: $color-bg-hover; color: $color-text-primary; }

    &--ctrl  { &:hover { border-color: $color-accent; color: $color-accent; } }
    &--mode  { &:hover { border-color: $color-accent; color: $color-accent; } }
    &--stop  { &:hover { border-color: $color-danger; color: $color-danger; } }
    &--active {
      border-color: $color-accent;
      color: $color-accent;
      background: rgba($color-accent, 0.12);
    }
  }
}
</style>
