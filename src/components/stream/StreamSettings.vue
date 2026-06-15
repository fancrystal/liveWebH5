<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useMediaStore } from '@/stores/mediaStore'
import type { StreamConfig } from '@/types/stream'

// This release ships WHIP-only (no RTMP), so there is no mode selector.
// The push URL is server-issued. Editing it is a test-environment debugging
// affordance — production shows the field read-only (greyed out):
// set VITE_PUSH_URL_EDITABLE=false for real production.
const pushUrlEditable = import.meta.env.VITE_PUSH_URL_EDITABLE === 'true'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [v: boolean]; apply: [cfg: StreamConfig] }>()

const mediaStore = useMediaStore()
const streamStore = useStreamStore()

// Local copy — only committed on "Apply"
const local = reactive<StreamConfig>({ ...streamStore.config })

// On every open: refresh devices and re-sync the local copy with the store
// (config may have changed since setup, e.g. server-issued whipUrl).
watch(() => props.visible, (v) => {
  if (!v) return
  mediaStore.loadDevices()
  Object.assign(local, streamStore.config)
}, { immediate: true })

// Streaming params are locked while live: the mixer's output canvas size,
// encoder bitrate and the push connection are all fixed at start — changing
// them mid-stream would desync the host UI from what viewers actually see.
const isLive = computed(() => streamStore.isStreaming)

function handleApply() {
  if (isLive.value) {
    // Only device switching (handled live via its own @change) is allowed;
    // discard any locked-field edits to keep config == actual stream state.
    emit('update:visible', false)
    return
  }
  streamStore.updateConfig({ ...local })
  emit('apply', { ...local })
  emit('update:visible', false)
}

const resolutions = {
  landscape: [
    { value: '854x480',   label: '480P  854 × 480' },
    { value: '1280x720',  label: '720P  1280 × 720' },
    { value: '1920x1080', label: '1080P  1920 × 1080' },
  ],
  portrait: [
    { value: '480x854',   label: '480P  480 × 854' },
    { value: '720x1280',  label: '720P  720 × 1280' },
    { value: '1080x1920', label: '1080P  1080 × 1920' },
  ],
} as const
const frameRates  = [15, 24, 30] as const
const audioBitrates = [64, 128, 192] as const

// WHIP URL format validation: must have ?app=xxx&stream=xxx
const whipUrlHint = computed(() => {
  const url = local.whipUrl.trim()
  if (!url) return null
  if (!url.includes('?app=') || !url.includes('stream=')) {
    return { type: 'warn', text: '⚠ SRS 要求 URL 含有 ?app=xxx&stream=xxx 参数，例如：http://ip:1985/rtc/v1/whip/?app=live&stream=mystream' }
  }
  return { type: 'ok', text: '✓ URL 格式正确' }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-mask" @click.self="emit('update:visible', false)">
      <div class="settings-modal">
        <div class="settings-modal__header">
          <span class="settings-modal__title">推流设置</span>
          <button class="settings-modal__close" @click="emit('update:visible', false)">×</button>
        </div>

        <div class="settings-modal__body">
          <!-- Live lock notice -->
          <div v-if="isLive" class="live-lock-banner">
            直播进行中，推流参数已锁定（仅可切换摄像头/麦克风）。如需修改请先结束直播。
          </div>

          <!-- Push URL — editable only in test env (VITE_PUSH_URL_EDITABLE);
               production shows the server-issued address read-only -->
          <div class="form-section">
            <div class="form-label">WHIP 推流地址</div>
            <input
              v-model="local.whipUrl"
              class="form-input"
              :class="{ 'form-input--warn': pushUrlEditable && whipUrlHint?.type === 'warn' }"
              :disabled="isLive || !pushUrlEditable"
              :title="pushUrlEditable ? '' : '推流地址由服务端下发，不可修改'"
              placeholder="http://your-srs:1985/rtc/v1/whip/?app=live&stream=key"
            />
            <div v-if="pushUrlEditable && whipUrlHint" class="form-hint" :class="`form-hint--${whipUrlHint.type}`">
              {{ whipUrlHint.text }}
            </div>
          </div>

          <!-- Video -->
          <div class="form-section">
            <div class="form-label">
              视频设置
              <span class="form-label__hint" title="实际清晰度按摄像头设备的支持程度为准">?</span>
            </div>
            <div class="form-row">
              <div class="form-field">
                <label>分辨率</label>
                <select v-model="local.resolution" class="form-select" :disabled="isLive">
                  <optgroup label="横屏（适合 PC / 大屏观看）">
                    <option v-for="r in resolutions.landscape" :key="r.value" :value="r.value">{{ r.label }}</option>
                  </optgroup>
                  <optgroup label="竖屏（适合手机端观看）">
                    <option v-for="r in resolutions.portrait" :key="r.value" :value="r.value">{{ r.label }}</option>
                  </optgroup>
                </select>
              </div>
              <div class="form-field">
                <label>帧率</label>
                <select v-model.number="local.frameRate" class="form-select" :disabled="isLive">
                  <option v-for="f in frameRates" :key="f" :value="f">{{ f }} fps</option>
                </select>
              </div>
            </div>
            <div class="form-field">
              <label>视频码率: {{ local.videoBitrate }} kbps</label>
              <input
                v-model.number="local.videoBitrate"
                type="range" min="500" max="8000" step="100"
                class="form-range"
                :disabled="isLive"
              />
              <div class="range-labels"><span>500</span><span>8000</span></div>
            </div>
          </div>

          <!-- Audio -->
          <div class="form-section">
            <div class="form-label">音频设置</div>
            <div class="form-row">
              <div class="form-field">
                <label>采样率</label>
                <select v-model.number="local.sampleRate" class="form-select" :disabled="isLive">
                  <option :value="44100">44100 Hz</option>
                  <option :value="48000">48000 Hz</option>
                </select>
              </div>
              <div class="form-field">
                <label>音频码率</label>
                <select v-model.number="local.audioBitrate" class="form-select" :disabled="isLive">
                  <option v-for="b in audioBitrates" :key="b" :value="b">{{ b }} kbps</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Device selection -->
          <div class="form-section">
            <div class="form-label">设备切换</div>
            <div class="form-field">
              <label>摄像头</label>
              <select
                class="form-select"
                :value="mediaStore.activeVideoDeviceId"
                @change="mediaStore.switchCamera(($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!mediaStore.videoDevices.length" value="">无可用摄像头</option>
                <option
                  v-for="d in mediaStore.videoDevices"
                  :key="d.deviceId"
                  :value="d.deviceId"
                >{{ d.label || `摄像头 ${d.deviceId.slice(0,6)}` }}</option>
              </select>
            </div>
            <div class="form-field">
              <label>麦克风</label>
              <select
                class="form-select"
                :value="mediaStore.activeAudioDeviceId"
                @change="mediaStore.switchMic(($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!mediaStore.audioDevices.length" value="">无可用麦克风</option>
                <option
                  v-for="d in mediaStore.audioDevices"
                  :key="d.deviceId"
                  :value="d.deviceId"
                >{{ d.label || `麦克风 ${d.deviceId.slice(0,6)}` }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="settings-modal__footer">
          <button class="btn-cancel" @click="emit('update:visible', false)">取消</button>
          <button class="btn-apply" @click="handleApply">保存并应用</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style lang="scss" scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  width: 480px;
  background: rgba(28, 28, 28, 0.97);   // near-opaque so canvas doesn't bleed through
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid $glass-border;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: $shadow-lg;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid $color-border;
  }

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: $color-text-primary;
  }

  &__close {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: $color-text-secondary;
    font-size: 18px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    &:hover { background: $color-bg-hover; color: $color-text-primary; }
  }

  &__body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 60vh;
    overflow-y: auto;
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    border-top: 1px solid $color-border;
  }
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: $color-text-muted;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  &__hint {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid $color-text-muted;
    font-size: 10px;
    font-weight: 600;
    color: $color-text-muted;
    cursor: help;
    flex-shrink: 0;
    text-transform: none;
    letter-spacing: 0;
    line-height: 1;

    &:hover { border-color: $color-text-secondary; color: $color-text-secondary; }
  }
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;

  label {
    font-size: 12px;
    color: $color-text-secondary;
  }
}

.form-hint {
  font-size: 11px;
  margin-top: 4px;
  line-height: 1.4;

  &--warn { color: #f59e0b; }
  &--ok   { color: #22c55e; }
}

.form-input,
.form-select {
  background: $color-bg-dark;
  border: 1px solid $color-border;
  border-radius: 6px;
  padding: 7px 10px;
  color: $color-text-primary;
  font-size: 13px;
  outline: none;
  width: 100%;

  &:focus { border-color: $color-accent; }

  &--warn { border-color: #f59e0b !important; }
}

.form-range {
  width: 100%;
  accent-color: $color-accent;
}

.form-input:disabled,
.form-select:disabled,
.form-range:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.live-lock-banner {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  line-height: 1.5;
  color: #fbbf24;
}

.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: $color-text-muted;
}

.btn-cancel {
  padding: 7px 18px;
  background: transparent;
  border: 1px solid $color-border;
  border-radius: 6px;
  color: $color-text-secondary;
  font-size: 13px;
  cursor: pointer;
  &:hover { background: $color-bg-hover; color: $color-text-primary; }
}

.btn-apply {
  padding: 7px 18px;
  background: $color-accent;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  &:hover { background: $color-accent-hover; }
}
</style>
