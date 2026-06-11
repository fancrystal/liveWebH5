<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useRoomStore } from '@/stores/roomStore'
import { useI18n } from '@/i18n'
import { useToast } from '@/composables/useToast'

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

// Title-bar status: while THIS page is pushing, local state wins (the host is
// the stream source); otherwise show the server-issued roomState from the
// detail API (1=预告 2=直播中 3=已结束).
const roomStatus = computed<'upcoming' | 'live' | 'ended'>(() => {
  if (streamStore.status === 'live') return 'live'
  const s = roomStore.room.roomState
  return s === 2 ? 'live' : s === 3 ? 'ended' : 'upcoming'
})

const statusClass = computed(() => `topbar__status--${roomStatus.value}`)

const statusLabel = computed(() => {
  if (roomStatus.value === 'live') return t('live')
  if (roomStatus.value === 'ended') return t('ended')
  return t('upcoming')
})

const networkBars = computed(() => streamStore.networkQuality)

// ── Watch URL dialog ──────────────────────────────────────────────────────────
const toast = useToast()
const showWatchUrl = ref(false)

function onWatchUrlClick() {
  if (!roomStore.room.watchUrl) {
    toast.info(t('noWatchUrl'))
    return
  }
  showWatchUrl.value = true
}

async function copyWatchUrl() {
  try {
    await navigator.clipboard.writeText(roomStore.room.watchUrl)
    toast.success(t('watchUrlCopied'))
  } catch {
    toast.error(t('copyFailed'))
  }
}
</script>

<template>
  <header class="topbar no-select">
    <!-- Left: room name + status + room number + host -->
    <div class="topbar__left">
      <span class="topbar__room-name">{{ roomStore.room.name }}</span>
      <span class="topbar__status" :class="statusClass">{{ statusLabel }}</span>
      <span v-if="roomStore.room.roomNumber" class="topbar__meta">
        <span class="topbar__meta-dot" />
        {{ t('roomNumberLabel') }}：{{ roomStore.room.roomNumber }}
      </span>
      <span v-if="roomStore.room.hostName" class="topbar__meta">
        {{ t('hostLabel') }}：{{ roomStore.room.hostName }}
      </span>

      <!-- 观看人数：接口暂不支持，先隐藏，恢复时取消注释即可
      <span class="topbar__viewers">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        {{ streamStore.viewerCount }} {{ t('viewers') }}
      </span>
      -->

      <span class="topbar__network">
        <span
          v-for="i in 4"
          :key="i"
          class="topbar__network-bar"
          :class="{ active: i <= networkBars }"
        />
      </span>

      <span class="topbar__meta">{{ t('duration') }} {{ streamStore.formattedDuration }}</span>
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

      <button class="topbar__btn" @click="onWatchUrlClick">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        {{ t('watchUrl') }}
      </button>

      <!-- Watch URL dialog -->
      <Teleport to="body">
        <div v-if="showWatchUrl" class="watch-url-mask" @click.self="showWatchUrl = false">
          <div class="watch-url" role="dialog" aria-labelledby="watch-url-title">
            <div class="watch-url__header">
              <span id="watch-url-title" class="watch-url__title">{{ t('watchUrl') }}</span>
              <button class="watch-url__close" @click="showWatchUrl = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div class="watch-url__body">
              <input class="watch-url__input" :value="roomStore.room.watchUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
              <button class="watch-url__copy" @click="copyWatchUrl">{{ t('copyLink') }}</button>
            </div>
          </div>
        </div>
      </Teleport>
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
    gap: 18px;   // roomy spacing between name / status / room-id / host / duration
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

    // 状态配色与管理后台一致：预告橙 / 直播中蓝 / 已结束灰
    &--upcoming { background: $color-warning; }
    &--ended    { background: $color-status-ended; }

    // Live: soft expanding pulse ring so the on-air state is unmissable
    &--live {
      background: $color-accent;
      animation: live-pulse 2s ease-in-out infinite;
    }
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: $color-text-secondary;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  &__meta-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: $color-accent;
    flex-shrink: 0;
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
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
}

// ─── Watch URL dialog ────────────────────────────────────────────────────────
.watch-url-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.watch-url {
  width: 440px;
  max-width: calc(100vw - 32px);
  background: $glass-bg;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid $glass-border;
  border-radius: 12px;
  box-shadow: $shadow-lg;
  overflow: hidden;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 10px;
    border-bottom: 1px solid $color-border;
  }

  &__title {
    font-size: 14px;
    font-weight: 600;
    color: $color-text-primary;
  }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    transition: all 0.15s;

    &:hover { background: $color-bg-hover; color: $color-text-primary; }
  }

  &__body {
    display: flex;
    gap: 10px;
    padding: 16px 18px 18px;
  }

  &__input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    background: $color-bg-dark;
    border: 1px solid $color-border;
    border-radius: 7px;
    color: $color-text-primary;
    font-size: 13px;
    outline: none;

    &:focus { border-color: $color-accent; }
  }

  &__copy {
    flex-shrink: 0;
    padding: 0 16px;
    background: $color-accent;
    border: none;
    border-radius: 7px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;

    &:hover { background: $color-accent-hover; }
  }
}
</style>
