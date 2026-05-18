<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import { useStreamStore } from '@/stores/streamStore'
import { useMediaStore } from '@/stores/mediaStore'
import type { StreamConfig } from '@/types/stream'
import { supportsRTMP } from '@/utils/browser'

const rtmpSupported = supportsRTMP()

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [v: boolean]; apply: [cfg: StreamConfig] }>()

const mediaStore = useMediaStore()

// Refresh device list each time the panel opens
watch(() => props.visible, (v) => { if (v) mediaStore.loadDevices() }, { immediate: true })

const streamStore = useStreamStore()

// Local copy — only committed on "Apply"
const local = reactive<StreamConfig>({ ...streamStore.config })

function handleApply() {
  streamStore.updateConfig({ ...local })
  emit('apply', { ...local })
  emit('update:visible', false)
}

const resolutions = ['854x480', '1280x720', '1920x1080'] as const
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
          <!-- Push mode -->
          <div class="form-section">
            <div class="form-label">推流方式</div>
            <div class="radio-group">
              <label class="radio-item">
                <input v-model="local.mode" type="radio" value="webrtc" />
                <span>WebRTC (WHIP) — 超低延迟</span>
              </label>
              <label class="radio-item" :class="{ disabled: !rtmpSupported }">
                <input v-model="local.mode" type="radio" value="rtmp" :disabled="!rtmpSupported" />
                <span>RTMP — 广泛兼容{{ !rtmpSupported ? '（当前浏览器不支持）' : '' }}</span>
              </label>
            </div>
          </div>

          <!-- Push URL -->
          <div class="form-section">
            <div class="form-label">{{ local.mode === 'webrtc' ? 'WHIP 推流地址' : 'RTMP 推流地址' }}</div>
            <template v-if="local.mode === 'webrtc'">
              <input
                v-model="local.whipUrl"
                class="form-input"
                :class="{ 'form-input--warn': whipUrlHint?.type === 'warn' }"
                placeholder="http://your-srs:1985/rtc/v1/whip/?app=live&stream=key"
              />
              <div v-if="whipUrlHint" class="form-hint" :class="`form-hint--${whipUrlHint.type}`">
                {{ whipUrlHint.text }}
              </div>
            </template>
            <input
              v-else
              v-model="local.rtmpUrl"
              class="form-input"
              placeholder="rtmp://live.example.com/live/streamkey"
            />
          </div>

          <!-- Video -->
          <div class="form-section">
            <div class="form-label">视频设置</div>
            <div class="form-row">
              <div class="form-field">
                <label>分辨率</label>
                <select v-model="local.resolution" class="form-select">
                  <option v-for="r in resolutions" :key="r" :value="r">{{ r }}</option>
                </select>
              </div>
              <div class="form-field">
                <label>帧率</label>
                <select v-model.number="local.frameRate" class="form-select">
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
                <select v-model.number="local.sampleRate" class="form-select">
                  <option :value="44100">44100 Hz</option>
                  <option :value="48000">48000 Hz</option>
                </select>
              </div>
              <div class="form-field">
                <label>音频码率</label>
                <select v-model.number="local.audioBitrate" class="form-select">
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
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-modal {
  width: 480px;
  background: $color-bg-panel;
  border: 1px solid $color-border;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);

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
  font-size: 12px;
  font-weight: 600;
  color: $color-text-muted;
  text-transform: uppercase;
  letter-spacing: 0.5px;
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

.range-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: $color-text-muted;
}

.radio-group {
  display: flex;
  gap: 16px;
}

.radio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: $color-text-primary;
  cursor: pointer;

  input { accent-color: $color-accent; cursor: pointer; }

  &.disabled {
    opacity: 0.45;
    cursor: not-allowed;
    input { cursor: not-allowed; }
  }
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
