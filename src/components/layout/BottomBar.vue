<script setup lang="ts">
import { ref, computed, inject, watch, onUnmounted } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useMediaStore } from '@/stores/mediaStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useI18n } from '@/i18n'

const streamStore = useStreamStore()
const mediaStore  = useMediaStore()
const wbStore     = useWhiteboardStore()
const { t }       = useI18n()

const onMainAction   = inject<() => void>('onMainAction', () => {})
const onOpenSettings = inject<() => void>('onOpenSettings', () => {})

watch(() => mediaStore.isScreenSharing, (sharing) => {
  if (!sharing && wbStore.activeMode === 'screen') wbStore.setActiveMode('whiteboard')
})

type DropdownTarget = 'camera' | 'mic' | null
const openDropdown = ref<DropdownTarget>(null)

async function toggleDropdown(target: DropdownTarget) {
  if (openDropdown.value === target) { openDropdown.value = null; return }
  await mediaStore.loadDevices()
  openDropdown.value = target
}

function closeDropdown() { openDropdown.value = null }

async function selectCamera(deviceId: string) {
  closeDropdown()
  await mediaStore.switchCamera(deviceId)
}

async function selectMic(deviceId: string) {
  closeDropdown()
  await mediaStore.switchMic(deviceId)
}

function onDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.device-group')) closeDropdown()
}
document.addEventListener('click', onDocClick, true)
onUnmounted(() => document.removeEventListener('click', onDocClick, true))

async function handleCameraToggle() {
  if (mediaStore.isCameraOn && !mediaStore.isCameraVisible) {
    mediaStore.toggleCameraVisibility(); return
  }
  try { await mediaStore.toggleCamera() } catch { /* denied */ }
}

async function handleMicToggle() {
  try { await mediaStore.toggleMic() } catch { /* denied */ }
}

async function handleScreenShare() {
  try {
    if (mediaStore.isScreenSharing) {
      mediaStore.stopScreenShare()
      wbStore.setActiveMode('whiteboard')
    } else {
      await mediaStore.startScreenShare()
      wbStore.setActiveMode('screen')
    }
  } catch { /* cancelled */ }
}

const mainBtnLabel = computed(() => {
  if (streamStore.status === 'live')  return t('endLive')
  if (streamStore.status === 'ended') return t('restorePreview')
  return t('startLive')
})

const isLive = computed(() => streamStore.status === 'live')
</script>

<template>
  <footer class="bottom-bar no-select">

    <!-- ── Left spacer (balances the right controls) ── -->
    <div class="bottom-bar__side" />

    <!-- ── Center tools ── -->
    <div class="bottom-bar__center">

      <!-- Mic -->
      <div class="device-group">
        <button
          class="tool-btn"
          :class="{ 'tool-btn--active': mediaStore.isMicOn, 'tool-btn--off': !mediaStore.isMicOn }"
          :title="t('mic')"
          @click="handleMicToggle"
        >
          <span class="tool-btn__icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="mediaStore.isMicOn">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8"  y1="23" x2="16" y2="23"/>
              </template>
              <template v-else>
                <line x1="1"  y1="1"  x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
                <path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8"  y1="23" x2="16" y2="23"/>
              </template>
            </svg>
          </span>
          <span class="tool-btn__label">{{ t('mic') }}</span>
        </button>
        <button
          class="device-arrow"
          :class="{ 'device-arrow--open': openDropdown === 'mic' }"
          :title="t('selectMic')"
          @click.stop="toggleDropdown('mic')"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div v-if="openDropdown === 'mic'" class="device-dropdown">
          <div class="device-dropdown__title">{{ t('selectMic') }}</div>
          <button
            v-for="d in mediaStore.audioDevices"
            :key="d.deviceId"
            class="device-dropdown__item"
            :class="{ active: d.deviceId === mediaStore.activeAudioDeviceId }"
            @click="selectMic(d.deviceId)"
          >
            <svg v-if="d.deviceId === mediaStore.activeAudioDeviceId" width="12" height="12" viewBox="0 0 24 24" class="device-dropdown__check">
              <polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2.5"/>
            </svg>
            {{ d.label || `${t('mic')} ${d.deviceId.slice(0, 8)}` }}
          </button>
          <div v-if="!mediaStore.audioDevices.length" class="device-dropdown__empty">{{ t('noMic') }}</div>
        </div>
      </div>

      <!-- Camera -->
      <div class="device-group">
        <button
          class="tool-btn"
          :class="{
            'tool-btn--active':  mediaStore.isCameraOn && mediaStore.isCameraVisible,
            'tool-btn--warn':    mediaStore.isCameraOn && !mediaStore.isCameraVisible,
            'tool-btn--off':     !mediaStore.isCameraOn,
          }"
          :title="t('camera')"
          @click="handleCameraToggle"
        >
          <span class="tool-btn__icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="mediaStore.isCameraOn">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </template>
              <template v-else>
                <line x1="1"  y1="1"  x2="23" y2="23"/>
                <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>
                <path d="M11 5h4a2 2 0 0 1 2 2v3l4-4v10"/>
              </template>
            </svg>
          </span>
          <span class="tool-btn__label">{{ t('camera') }}</span>
        </button>
        <button
          class="device-arrow"
          :class="{ 'device-arrow--open': openDropdown === 'camera' }"
          :title="t('selectCamera')"
          @click.stop="toggleDropdown('camera')"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div v-if="openDropdown === 'camera'" class="device-dropdown">
          <div class="device-dropdown__title">{{ t('selectCamera') }}</div>
          <button
            v-for="d in mediaStore.videoDevices"
            :key="d.deviceId"
            class="device-dropdown__item"
            :class="{ active: d.deviceId === mediaStore.activeVideoDeviceId }"
            @click="selectCamera(d.deviceId)"
          >
            <svg v-if="d.deviceId === mediaStore.activeVideoDeviceId" width="12" height="12" viewBox="0 0 24 24" class="device-dropdown__check">
              <polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2.5"/>
            </svg>
            {{ d.label || `${t('camera')} ${d.deviceId.slice(0, 8)}` }}
          </button>
          <div v-if="!mediaStore.videoDevices.length" class="device-dropdown__empty">{{ t('noCamera') }}</div>
        </div>
      </div>

      <!-- Screen share -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn--active': mediaStore.isScreenSharing }"
        :title="t('share')"
        @click="handleScreenShare"
      >
        <span class="tool-btn__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
            <path d="M12 12v9"/><path d="m8 17 4-4 4 4"/>
          </svg>
        </span>
        <span class="tool-btn__label">{{ t('share') }}</span>
      </button>

      <!-- Divider -->
      <div class="bottom-bar__divider" />

      <!-- Whiteboard mode: switch to whiteboard; if already active, add a new page -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn--mode': wbStore.activeMode === 'whiteboard' }"
        :title="wbStore.activeMode === 'whiteboard' ? t('addWhiteboard') : t('whiteboard')"
        @click="wbStore.activeMode === 'whiteboard' ? wbStore.addPage() : wbStore.setActiveMode('whiteboard')"
      >
        <span class="tool-btn__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8"  y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </span>
        <span class="tool-btn__label">{{ t('whiteboard') }}</span>
      </button>

      <!-- Document mode -->
      <button
        class="tool-btn"
        :class="{ 'tool-btn--mode': wbStore.activeMode === 'document' }"
        :title="t('document')"
        @click="wbStore.setActiveMode('document')"
      >
        <span class="tool-btn__icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </span>
        <span class="tool-btn__label">{{ t('document') }}</span>
      </button>
    </div>

    <!-- ── Right: settings + go-live ── -->
    <div class="bottom-bar__side bottom-bar__side--right">
      <button class="settings-btn" title="设置" @click="onOpenSettings()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      <button class="go-live-btn" :class="{ 'go-live-btn--end': isLive }" @click="onMainAction()">
        <span v-if="!isLive" class="go-live-btn__dot" />
        {{ mainBtnLabel }}
      </button>
    </div>

  </footer>
</template>

<style lang="scss" scoped>
// ─── Bottom bar shell ────────────────────────────────────────────────────────
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: $bottombar-height;
  padding: 0 16px;
  background: $color-bg-panel;
  border-top: 1px solid $color-border;
  flex-shrink: 0;
  position: relative;

  &__center {
    display: flex;
    align-items: center;
    gap: 4px;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  &__side {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 160px; // mirrors right side to keep center truly centered

    &--right {
      justify-content: flex-end;
    }
  }

  &__divider {
    width: 1px;
    height: 24px;
    background: $color-border;
    margin: 0 4px;
    flex-shrink: 0;
  }
}

// ─── Tool button ─────────────────────────────────────────────────────────────
.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 52px;
  height: 52px;
  padding: 0 8px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: $color-text-secondary;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  // Inside device-group: flatten right side
  .device-group & {
    border-radius: 10px 0 0 10px;
    padding-right: 4px;
  }

  &:hover {
    background: $color-bg-hover;
    color: $color-text-primary;
  }

  // Mic/Camera ON (active)
  &--active {
    color: $color-accent;
    background: rgba($color-accent, 0.1);

    &:hover {
      background: rgba($color-accent, 0.18);
      color: $color-accent;
    }
  }

  // Mic/Camera OFF (muted — red tint)
  &--off {
    color: $color-danger;
    background: rgba($color-danger, 0.08);

    &:hover {
      background: rgba($color-danger, 0.15);
      color: $color-danger;
    }
  }

  // Camera hidden (visible but not streaming)
  &--warn {
    color: $color-warning;
    background: rgba($color-warning, 0.08);

    &:hover {
      background: rgba($color-warning, 0.15);
      color: $color-warning;
    }
  }

  // Mode selector (whiteboard / document)
  &--mode {
    color: $color-text-primary;
    background: $color-bg-active;

    &:hover {
      background: $color-bg-hover;
    }
  }

  &__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__label {
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
    line-height: 1;
  }
}

// ─── Device group (button + caret) ───────────────────────────────────────────
.device-group {
  position: relative;
  display: flex;
  align-items: center;
}

.device-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 52px;
  border-radius: 0 10px 10px 0;
  border: none;
  border-left: 1px solid $color-border;
  background: transparent;
  color: $color-text-muted;
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;
  flex-shrink: 0;

  &:hover {
    background: $color-bg-hover;
    color: $color-text-primary;
  }

  &--open {
    background: $color-bg-active;
    color: $color-accent;

    svg { transform: rotate(180deg); }
  }

  svg { transition: transform 0.2s; }
}

// ─── Device dropdown ─────────────────────────────────────────────────────────
.device-dropdown {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  min-width: 230px;
  background: $color-bg-panel;
  border: 1px solid $color-border;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  z-index: 500;

  &__title {
    padding: 11px 14px 6px;
    font-size: 11px;
    font-weight: 600;
    color: $color-text-muted;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 14px;
    background: none;
    border: none;
    color: $color-text-primary;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;

    &:hover  { background: $color-bg-hover; }
    &.active { color: $color-accent; }
    &:last-child { margin-bottom: 6px; }
  }

  &__check { color: $color-accent; flex-shrink: 0; }

  &__empty {
    padding: 10px 14px 14px;
    font-size: 13px;
    color: $color-text-muted;
  }
}

// ─── Settings button ─────────────────────────────────────────────────────────
.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid $color-border;
  background: transparent;
  color: $color-text-secondary;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;

  &:hover {
    background: $color-bg-hover;
    color: $color-text-primary;
    border-color: rgba(255,255,255,0.15);
  }
}

// ─── Go Live button ───────────────────────────────────────────────────────────
.go-live-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 22px;
  height: 40px;
  border-radius: 10px;
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  background: $color-accent;
  color: #fff;
  letter-spacing: 0.2px;

  &:hover {
    background: $color-accent-hover;
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba($color-accent, 0.4);
  }

  &:active { transform: translateY(0); }

  &--end {
    background: $color-danger;

    &:hover {
      background: #dc2626;
      box-shadow: 0 4px 16px rgba($color-danger, 0.4);
    }
  }

  &__dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.8);
    animation: pulse-dot 2s ease-in-out infinite;
    flex-shrink: 0;
  }
}

@keyframes pulse-dot {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50%       { opacity: 1;   transform: scale(1.25); }
}
</style>
