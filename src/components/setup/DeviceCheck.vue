<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { filterRealDevices, pickDefaultDevice } from '@/utils/browser'

const emit = defineEmits<{
  done: [payload: {
    cameraStream: MediaStream | null
    micStream: MediaStream | null
    cameraDeviceId: string
    micDeviceId: string
  }]
}>()

// ─── Device lists ──────────────────────────────────────────────────────────
const cameras   = ref<MediaDeviceInfo[]>([])
const mics      = ref<MediaDeviceInfo[]>([])
const selCamera = ref('')
const selMic    = ref('')

// ─── Preview ───────────────────────────────────────────────────────────────
const videoEl       = ref<HTMLVideoElement | null>(null)
let   previewStream: MediaStream | null = null

// ─── Audio level ───────────────────────────────────────────────────────────
const audioLevel = ref(0)   // 0–100
let   audioCtx:   AudioContext | null = null
let   analyser:   AnalyserNode | null = null
let   micStream:  MediaStream | null = null
let   rafId       = 0

// ─── Check results ─────────────────────────────────────────────────────────
type CheckStatus = 'pending' | 'ok' | 'fail'
const checks = ref({
  network: 'pending' as CheckStatus,
  browser: 'pending' as CheckStatus,
  camera:  'pending' as CheckStatus,
  mic:     'pending' as CheckStatus,
})

// ─── Skip confirm dialog ───────────────────────────────────────────────────
const showSkipConfirm = ref(false)

// ─── Helpers ───────────────────────────────────────────────────────────────
async function enumerateDevices() {
  // Request permission first so labels are available
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    s.getTracks().forEach(t => t.stop())
  } catch { /* no devices or denied */ }

  const devices = await navigator.mediaDevices.enumerateDevices()

  cameras.value = filterRealDevices(devices.filter(d => d.kind === 'videoinput'))
  mics.value    = filterRealDevices(devices.filter(d => d.kind === 'audioinput'))

  if (cameras.value.length) selCamera.value = pickDefaultDevice(cameras.value)
  if (mics.value.length)    selMic.value    = pickDefaultDevice(mics.value)
}

async function startPreview(deviceId: string) {
  previewStream?.getTracks().forEach(t => t.stop())
  previewStream = null
  if (!deviceId) { checks.value.camera = 'fail'; return }
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    })
    if (videoEl.value) {
      videoEl.value.srcObject = previewStream
      videoEl.value.play().catch(() => {})
    }
    checks.value.camera = 'ok'
  } catch {
    checks.value.camera = 'fail'
  }
}

function stopAudioAnalysis() {
  cancelAnimationFrame(rafId)
  micStream?.getTracks().forEach(t => t.stop())
  micStream = null
  audioCtx?.close()
  audioCtx  = null
  analyser  = null
  audioLevel.value = 0
}

async function startAudioAnalysis(deviceId: string) {
  stopAudioAnalysis()
  if (!deviceId) { checks.value.mic = 'fail'; return }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    })
    audioCtx  = new AudioContext()
    analyser  = audioCtx.createAnalyser()
    analyser.fftSize = 256
    audioCtx.createMediaStreamSource(micStream).connect(analyser)

    const buf = new Uint8Array(analyser.frequencyBinCount)
    function tick() {
      if (!analyser) return   // guard: analyser cleared by stopAudioAnalysis
      analyser.getByteFrequencyData(buf)
      const avg = buf.reduce((s, v) => s + v, 0) / buf.length
      audioLevel.value = Math.min(100, Math.round(avg * 2.5))
      rafId = requestAnimationFrame(tick)
    }
    tick()
    checks.value.mic = 'ok'
  } catch {
    checks.value.mic = 'fail'
  }
}

async function checkNetwork() {
  checks.value.network = 'pending'
  try {
    const t0 = Date.now()
    await fetch('https://www.google.com/generate_204', { mode: 'no-cors', cache: 'no-store' })
    checks.value.network = (Date.now() - t0) < 3000 ? 'ok' : 'fail'
  } catch {
    // Fallback: just mark ok if fetch itself doesn't throw network error
    checks.value.network = navigator.onLine ? 'ok' : 'fail'
  }
}

function checkBrowser() {
  const ok = !!(window.RTCPeerConnection && window.MediaRecorder && navigator.mediaDevices)
  checks.value.browser = ok ? 'ok' : 'fail'
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────
onMounted(async () => {
  checkBrowser()
  checkNetwork()
  await enumerateDevices()
  await Promise.all([
    startPreview(selCamera.value),
    startAudioAnalysis(selMic.value),
  ])
})

onUnmounted(() => {
  // previewStream / micStream are null if emitDone() already transferred them
  previewStream?.getTracks().forEach(t => t.stop())
  stopAudioAnalysis()
})

watch(selCamera, (id) => startPreview(id))
watch(selMic,    (id) => startAudioAnalysis(id))

// ─── Actions ───────────────────────────────────────────────────────────────
function emitDone() {
  // Stop audio analysis context (mic rAF loop) but keep the mic track alive
  cancelAnimationFrame(rafId)
  audioCtx?.close()
  audioCtx = null
  analyser = null
  audioLevel.value = 0
  // Transfer both streams directly to parent — do NOT stop them
  const cam = previewStream
  const mic = micStream
  previewStream = null
  micStream     = null
  emit('done', {
    cameraStream:   cam,
    micStream:      mic,
    cameraDeviceId: selCamera.value,
    micDeviceId:    selMic.value,
  })
}

function goLive() {
  emitDone()
}

function confirmSkip() {
  showSkipConfirm.value = false
  emitDone()
}

const BARS = 14
</script>

<template>
  <div class="dc-mask">
    <div class="dc-card">
      <!-- Header -->
      <div class="dc-card__header">
        <span class="dc-card__title">直播设备检测</span>
        <button class="dc-card__skip" @click="showSkipConfirm = true">跳过检测</button>
      </div>

      <!-- Camera -->
      <div class="dc-section">
        <div class="dc-label">选择摄像头</div>
        <select v-model="selCamera" class="dc-select">
          <option v-if="!cameras.length" value="">无可用摄像头</option>
          <option v-for="c in cameras" :key="c.deviceId" :value="c.deviceId">
            {{ c.label || `摄像头 ${c.deviceId.slice(0, 6)}` }}
          </option>
        </select>
        <div class="dc-preview">
          <video ref="videoEl" class="dc-preview__video" autoplay muted playsinline />
          <div v-if="!selCamera" class="dc-preview__empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14"/>
              <rect x="2" y="6" width="13" height="12" rx="2"/>
            </svg>
            <span>无摄像头信号</span>
          </div>
        </div>
      </div>

      <!-- Mic -->
      <div class="dc-section">
        <div class="dc-label">选择麦克风</div>
        <select v-model="selMic" class="dc-select">
          <option v-if="!mics.length" value="">无可用麦克风</option>
          <option v-for="m in mics" :key="m.deviceId" :value="m.deviceId">
            {{ m.label || `麦克风 ${m.deviceId.slice(0, 6)}` }}
          </option>
        </select>
        <div class="dc-level">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               :class="checks.mic === 'fail' ? 'dc-level__icon--muted' : 'dc-level__icon'">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
          </svg>
          <div class="dc-level__bars">
            <div
              v-for="i in BARS"
              :key="i"
              class="dc-level__bar"
              :class="{ 'dc-level__bar--active': audioLevel >= (i / BARS) * 100 }"
            />
          </div>
        </div>
      </div>

      <!-- Check results -->
      <div class="dc-checks">
        <div class="dc-checks__row" v-for="(status, key) in checks" :key="key">
          <span class="dc-checks__label">{{ { network: '网速', browser: '浏览器', camera: '摄像头', mic: '麦克风' }[key] }}</span>
          <span class="dc-checks__status" :class="`dc-checks__status--${status}`">
            <template v-if="status === 'pending'">检测中…</template>
            <template v-else-if="status === 'ok'">正常</template>
            <template v-else>异常</template>
          </span>
        </div>
      </div>

      <!-- Hint -->
      <p v-if="Object.values(checks).some(s => s === 'fail')" class="dc-hint dc-hint--warn">
        提示：设备异常仍可进行直播。请允许浏览器使用摄像头、麦克风权限，确认摄像头、麦克风未被占用。
      </p>

      <!-- CTA -->
      <button class="dc-btn-go" @click="goLive">去直播</button>
    </div>

    <!-- Skip confirm dialog -->
    <Teleport to="body">
      <div v-if="showSkipConfirm" class="dc-dialog-mask" @click.self="showSkipConfirm = false">
        <div class="dc-dialog">
          <div class="dc-dialog__icon">⚠</div>
          <div class="dc-dialog__title">确认跳过设备检测</div>
          <p class="dc-dialog__body">
            提示：设备异常仍可进行直播。请允许浏览器使用摄像头、麦克风权限，确认摄像头、麦克风未被占用。
          </p>
          <div class="dc-dialog__actions">
            <button class="dc-dialog__cancel" @click="showSkipConfirm = false">取消</button>
            <button class="dc-dialog__confirm" @click="confirmSkip">确定</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.dc-mask {
  position: fixed;
  inset: 0;
  background: $color-bg-dark;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dc-card {
  width: 480px;
  background: $color-bg-panel;
  border: 1px solid $color-border;
  border-radius: 14px;
  padding: 28px 32px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: 90vh;
  overflow-y: auto;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: $color-text-primary;
  }

  &__skip {
    font-size: 13px;
    color: $color-accent;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    &:hover { text-decoration: underline; }
  }
}

.dc-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dc-label {
  font-size: 13px;
  color: $color-text-secondary;
}

.dc-select {
  background: $color-bg-dark;
  border: 1px solid $color-border;
  border-radius: 7px;
  padding: 8px 12px;
  color: $color-text-primary;
  font-size: 13px;
  outline: none;
  width: 100%;
  &:focus { border-color: $color-accent; }
}

.dc-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #111;
  border-radius: 8px;
  overflow: hidden;

  &__video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transform: scaleX(-1); // mirror
  }

  &__empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: $color-text-muted;
    font-size: 13px;
  }
}

.dc-level {
  display: flex;
  align-items: center;
  gap: 10px;

  &__icon {
    color: $color-text-secondary;
    flex-shrink: 0;

    &--muted { color: $color-danger; }
  }

  &__bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 22px;
  }

  &__bar {
    width: 8px;
    height: 14px;
    border-radius: 2px;
    background: $color-bg-active;
    transition: background 80ms;

    &--active { background: $color-accent; }
  }
}

.dc-checks {
  border: 1px solid $color-border;
  border-radius: 8px;
  overflow: hidden;

  &__row {
    display: flex;
    justify-content: space-between;
    padding: 10px 14px;
    font-size: 13px;
    &:not(:last-child) { border-bottom: 1px solid $color-border; }
  }

  &__label { color: $color-text-secondary; }

  &__status {
    font-weight: 500;
    &--pending { color: $color-text-muted; }
    &--ok      { color: $color-success; }
    &--fail    { color: $color-danger; }
  }
}

.dc-hint {
  font-size: 12px;
  line-height: 1.6;
  color: $color-text-muted;
  &--warn { color: $color-warning; }
}

.dc-btn-go {
  width: 100%;
  padding: 12px 0;
  background: $color-accent;
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms;
  &:hover { background: $color-accent-hover; }
}

// ─── Skip confirm dialog ───────────────────────────────────────────────────
.dc-dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.dc-dialog {
  width: 360px;
  background: $color-bg-panel;
  border: 1px solid $color-border;
  border-radius: 12px;
  padding: 28px 28px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &__icon {
    font-size: 22px;
    color: $color-warning;
  }

  &__title {
    font-size: 15px;
    font-weight: 600;
    color: $color-text-primary;
  }

  &__body {
    font-size: 13px;
    line-height: 1.6;
    color: $color-text-secondary;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 4px;
  }

  &__cancel {
    padding: 7px 20px;
    background: transparent;
    border: 1px solid $color-border;
    border-radius: 6px;
    color: $color-text-secondary;
    font-size: 13px;
    cursor: pointer;
    &:hover { background: $color-bg-hover; }
  }

  &__confirm {
    padding: 7px 20px;
    background: $color-accent;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    &:hover { background: $color-accent-hover; }
  }
}
</style>
