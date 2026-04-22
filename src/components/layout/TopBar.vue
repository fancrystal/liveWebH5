<script setup lang="ts">
import { computed } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useRoomStore } from '@/stores/roomStore'
import { useI18n } from '@/i18n'

const streamStore = useStreamStore()
const roomStore = useRoomStore()
const { t } = useI18n()

const statusClass = computed(() => ({
  'bg-amber-500': streamStore.status === 'preview',
  'bg-red-500': streamStore.status === 'live',
  'bg-gray-500': streamStore.status === 'ended',
}))

const statusLabel = computed(() => {
  if (streamStore.status === 'live') return t('live')
  if (streamStore.status === 'ended') return t('ended')
  return t('upcoming')
})

const networkBars = computed(() => streamStore.networkQuality)

function copyWatchUrl() {
  if (roomStore.room.watchUrl) {
    navigator.clipboard.writeText(roomStore.room.watchUrl)
  }
}
</script>

<template>
  <header class="topbar no-select">
    <!-- Left: room name + status -->
    <div class="topbar__left">
      <span class="topbar__room-name">{{ roomStore.room.name }}</span>
      <span class="topbar__status" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <!-- Center: viewer count + network + duration -->
    <div class="topbar__center">
      <span class="topbar__viewers">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        {{ streamStore.viewerCount }} {{ t('viewers') }}
      </span>

      <span class="topbar__network">
        <span
          v-for="i in 4"
          :key="i"
          class="topbar__network-bar"
          :class="{ active: i <= networkBars }"
        />
      </span>

      <span class="topbar__duration">{{ t('duration') }} {{ streamStore.formattedDuration }}</span>
    </div>

    <!-- Right: controls -->
    <div class="topbar__right">
      <select
        class="topbar__btn"
        :value="roomStore.room.language"
        @change="roomStore.updateRoom({ language: ($event.target as HTMLSelectElement).value as 'zh-CN' | 'en-US' })"
      >
        <option value="zh-CN">简体中文</option>
        <option value="en-US">English</option>
      </select>

      <button class="topbar__btn" @click="roomStore.togglePreviewLock">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        {{ roomStore.room.isPreviewLocked ? t('unlockPreview') : t('lockPreview') }}
      </button>

      <button class="topbar__btn" @click="copyWatchUrl">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        {{ t('watchUrl') }}
      </button>
    </div>
  </header>
</template>

<style lang="scss" scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: $topbar-height;
  padding: 0 16px;
  background: $color-bg-panel;
  border-bottom: 1px solid $color-border;
  flex-shrink: 0;

  &__left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  &__room-name {
    font-size: 15px;
    font-weight: 600;
    color: $color-text-primary;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }

  &__status {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
  }

  &__center {
    display: flex;
    align-items: center;
    gap: 16px;
    color: $color-text-secondary;
    font-size: 13px;
  }

  &__viewers {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__network {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 16px;
  }

  &__network-bar {
    width: 4px;
    background: $color-text-muted;
    border-radius: 1px;
    transition: background 0.3s;

    &:nth-child(1) { height: 4px; }
    &:nth-child(2) { height: 7px; }
    &:nth-child(3) { height: 10px; }
    &:nth-child(4) { height: 14px; }

    &.active { background: $color-success; }
  }

  &__duration {
    white-space: nowrap;
  }

  &__right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: transparent;
    border: 1px solid $color-border;
    border-radius: 6px;
    color: $color-text-secondary;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;

    &:hover {
      background: $color-bg-hover;
      color: $color-text-primary;
    }
  }
}
</style>
