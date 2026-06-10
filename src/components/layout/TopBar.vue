<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useRoomStore } from '@/stores/roomStore'
import { useI18n } from '@/i18n'

const streamStore = useStreamStore()
const roomStore = useRoomStore()
const { t } = useI18n()

// ── Language dropdown ─────────────────────────────────────────────────────────
type Lang = 'zh-CN' | 'en-US'
const LANGS: Array<{ value: Lang; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]
const langOpen = ref(false)
const currentLangLabel = computed(
  () => LANGS.find(l => l.value === roomStore.room.language)?.label ?? '简体中文',
)

function selectLang(value: Lang) {
  roomStore.updateRoom({ language: value })
  langOpen.value = false
}

function onDocClick(e: MouseEvent) {
  if (!(e.target as HTMLElement).closest('.lang-select')) langOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick, true))
onUnmounted(() => document.removeEventListener('click', onDocClick, true))

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
      <div class="lang-select">
        <button
          class="topbar__btn"
          :class="{ 'topbar__btn--open': langOpen }"
          aria-haspopup="listbox"
          :aria-expanded="langOpen"
          @click.stop="langOpen = !langOpen"
        >
          <!-- Globe icon -->
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          {{ currentLangLabel }}
          <svg class="lang-select__caret" :class="{ 'lang-select__caret--open': langOpen }"
               width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div v-if="langOpen" class="lang-select__menu" role="listbox">
          <button
            v-for="l in LANGS"
            :key="l.value"
            class="lang-select__item"
            :class="{ active: roomStore.room.language === l.value }"
            role="option"
            :aria-selected="roomStore.room.language === l.value"
            @click="selectLang(l.value)"
          >
            <svg v-if="roomStore.room.language === l.value" class="lang-select__check"
                 width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            {{ l.label }}
          </button>
        </div>
      </div>

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

    // Live: soft expanding pulse ring so the on-air state is unmissable
    &.bg-red-500 {
      animation: live-pulse 2s ease-in-out infinite;
    }
  }

  &__center {
    display: flex;
    align-items: center;
    gap: 16px;
    color: $color-text-secondary;
    font-size: 13px;
    // Counters tick every second — tabular digits stop the layout jitter
    font-variant-numeric: tabular-nums;
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

    &--open {
      background: $color-bg-active;
      color: $color-text-primary;
    }
  }
}

// ─── Language dropdown ────────────────────────────────────────────────────────
.lang-select {
  position: relative;

  &__caret {
    transition: transform 0.2s;
    &--open { transform: rotate(180deg); }
  }

  &__menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 140px;
    padding: 4px;
    background: $glass-bg;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid $glass-border;
    border-radius: 10px;
    box-shadow: $shadow-md;
    z-index: 500;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px 8px 30px;
    position: relative;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: $color-text-secondary;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    text-align: left;

    &:hover {
      background: $color-bg-hover;
      color: $color-text-primary;
    }

    &.active { color: $color-accent; }
  }

  &__check {
    position: absolute;
    left: 10px;
    flex-shrink: 0;
  }
}

@keyframes live-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
  50%      { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}
</style>
