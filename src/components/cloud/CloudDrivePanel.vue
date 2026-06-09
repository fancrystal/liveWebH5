<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useCloudDrive } from '@/composables/useCloudDrive'
import { useMediaStore } from '@/stores/mediaStore'
import { useDocManager } from '@/composables/useDocManager'
import { useRoomStore } from '@/stores/roomStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useToast } from '@/composables/useToast'
import type { CloudFile, VideoInsertMode } from '@/types/cloudDrive'

const emit = defineEmits<{
  close: []
}>()

const mediaStore  = useMediaStore()
const roomStore   = useRoomStore()
const wbStore     = useWhiteboardStore()
const cloudDrive  = useCloudDrive()
const docManager  = useDocManager()
const toast       = useToast()

const searchInput = ref('')
const searchTimer = ref<ReturnType<typeof setTimeout> | null>(null)


// ── Config state ──────────────────────────────────────────────────────────
/** True when the required server config is present to actually call the API */
const isConfigured = computed(() => !!(roomStore.sassUrl && roomStore.token))
/** Show dev-mode hints in the unconfigured state */
const isDev = import.meta.env.DEV

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(() => {
  if (isConfigured.value) cloudDrive.fetchFiles()
})

onUnmounted(() => {
  if (searchTimer.value) clearTimeout(searchTimer.value)
})

// Debounced search
watch(searchInput, (val) => {
  if (searchTimer.value) clearTimeout(searchTimer.value)
  searchTimer.value = setTimeout(() => cloudDrive.fetchFiles(val.trim()), 400)
})

// ── Computed ───────────────────────────────────────────────────────────────
const videoFiles    = computed(() => cloudDrive.files.value.filter(f => f.type === 'video'))
const documentFiles = computed(() => cloudDrive.files.value.filter(f => f.type === 'document' || f.type === 'image'))

type Tab = 'video' | 'document'
const activeTab = ref<Tab>('video')

// ── Actions ────────────────────────────────────────────────────────────────
function insertVideo(file: CloudFile, mode: VideoInsertMode) {
  if (!file.downloadUrl) {
    toast.error('视频地址无效，无法插播')
    return
  }
  mediaStore.startVideoInsert(file, mode)
  emit('close')
}

async function shareDocument(file: CloudFile) {
  // Download the file as a Blob, then hand it to the existing docManager.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(file.downloadUrl, {
      headers: roomStore.token ? { Authorization: `Bearer ${roomStore.token}` } : {},
      signal:  controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const f    = new File([blob], file.name, { type: blob.type })
    const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      toast.error('暂仅支持 PDF 文档共享到白板')
      return
    }
    await docManager.loadFile(f)
    // Switch the canvas to document mode so DocViewer (v-show) becomes visible.
    wbStore.setActiveMode('document')
    emit('close')
  } catch (e: unknown) {
    clearTimeout(timer)
    const msg = e instanceof Error
      ? (e.name === 'AbortError' ? '请求超时，请重试' : e.message)
      : '文档加载失败'
    toast.error(msg)
  }
}

// ── Local file insert ───────────────────────────────────────────────────────
const localFileInput = ref<HTMLInputElement | null>(null)

function pickLocalFile() {
  localFileInput.value?.click()
}

function onLocalFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file  = input.files?.[0]
  if (!file) return
  if (!file.type.startsWith('video/')) {
    toast.error('请选择视频文件（mp4、webm 等）')
    return
  }
  mediaStore.startLocalFileInsert(file, 'pip')
  emit('close')
  // Reset so the same file can be selected again next time
  input.value = ''
}

function formatDuration(d: string): string {
  if (!d) return ''
  // "00:30:45" → strip leading zeros for h/m
  const parts = d.split(':')
  if (parts.length === 3) {
    const [h, m, s] = parts
    if (h !== '00') return `${parseInt(h)}h ${parseInt(m)}m`
    if (m !== '00') return `${parseInt(m)}m ${parseInt(s)}s`
    return `${parseInt(s)}s`
  }
  return d
}
</script>

<template>
  <div class="cdp-backdrop" @click.self="emit('close')">
    <div class="cdp">
      <!-- Header -->
      <div class="cdp__header">
        <span class="cdp__title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
            <polygon points="10 9 10 15 16 12 10 9" fill="currentColor" stroke="none"/>
          </svg>
          视频文件
        </span>
        <button class="cdp__close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- Search -->
      <div class="cdp__search">
        <svg class="cdp__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          v-model="searchInput"
          class="cdp__search-input"
          placeholder="搜索文件名..."
          type="text"
        />
      </div>

      <!-- Tabs -->
      <div class="cdp__tabs">
        <button
          class="cdp__tab"
          :class="{ 'cdp__tab--active': activeTab === 'video' }"
          @click="activeTab = 'video'"
        >
          视频 ({{ videoFiles.length }})
        </button>
        <button
          class="cdp__tab"
          :class="{ 'cdp__tab--active': activeTab === 'document' }"
          @click="activeTab = 'document'"
        >
          文档 ({{ documentFiles.length }})
        </button>
      </div>

      <!-- File list -->
      <div class="cdp__list">

        <!-- Not configured: guide the user to enter from management portal -->
        <div v-if="!isConfigured" class="cdp__state cdp__state--guide">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
            <polygon points="10 9 10 15 16 12 10 9" fill="currentColor" stroke="none"/>
          </svg>
          <p class="cdp__guide-title">视频库暂未连接</p>
          <p class="cdp__guide-desc">
            请从管理后台的「进入直播」入口打开本页，<br />
            系统会自动带入认证信息。
          </p>
          <div v-if="isDev" class="cdp__guide-dev">
            <p>开发模式：在 <code>.env.development</code> 中填写：</p>
            <pre>VITE_DEV_SASS_URL=https://your-api.com
VITE_DEV_TOKEN=your-token
VITE_DEV_ROOM_ID=your-room-id</pre>
          </div>
        </div>

        <!-- Loading -->
        <div v-else-if="cloudDrive.isLoading.value && cloudDrive.files.value.length === 0" class="cdp__state">
          <div class="cdp__spinner" />
          <span>加载中...</span>
        </div>

        <!-- Error -->
        <div v-else-if="cloudDrive.error.value" class="cdp__state cdp__state--error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{{ cloudDrive.error.value }}</span>
          <button class="cdp__retry" @click="cloudDrive.fetchFiles(searchInput)">重试</button>
        </div>

        <!-- Video tab -->
        <template v-else-if="activeTab === 'video'">
          <div v-if="videoFiles.length === 0" class="cdp__state">
            <span>暂无视频文件</span>
          </div>
          <div
            v-for="file in videoFiles"
            :key="file.id"
            class="cdp__item"
          >
            <!-- Thumbnail -->
            <div class="cdp__thumb">
              <img v-if="file.coverUrl" :src="file.coverUrl" :alt="file.name" class="cdp__thumb-img" />
              <svg v-else width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              <span v-if="file.duration" class="cdp__duration">{{ formatDuration(file.duration) }}</span>
            </div>

            <!-- Info -->
            <div class="cdp__info">
              <div class="cdp__name" :title="file.name">{{ file.name }}</div>
              <div class="cdp__meta">{{ file.size }}</div>
            </div>

            <!-- Actions -->
            <div class="cdp__actions">
              <button
                class="cdp__action-btn cdp__action-btn--pip"
                title="画中画插播"
                @click="insertVideo(file, 'pip')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <rect x="14" y="10" width="7" height="5" rx="1"/>
                </svg>
                画中画
              </button>
              <button
                class="cdp__action-btn cdp__action-btn--fs"
                title="全屏插播"
                @click="insertVideo(file, 'fullscreen')"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
                  <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                </svg>
                全屏
              </button>
            </div>
          </div>
        </template>

        <!-- Document tab -->
        <template v-else>
          <div v-if="documentFiles.length === 0" class="cdp__state">
            <span>暂无文档文件</span>
          </div>
          <div
            v-for="file in documentFiles"
            :key="file.id"
            class="cdp__item"
          >
            <!-- Icon -->
            <div class="cdp__thumb cdp__thumb--doc">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>

            <!-- Info -->
            <div class="cdp__info">
              <div class="cdp__name" :title="file.name">{{ file.name }}</div>
              <div class="cdp__meta">{{ file.size }}</div>
            </div>

            <!-- Actions -->
            <div class="cdp__actions">
              <button
                class="cdp__action-btn cdp__action-btn--share"
                title="共享到白板"
                @click="shareDocument(file)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
                共享到白板
              </button>
            </div>
          </div>
        </template>

        <!-- Load more -->
        <button
          v-if="cloudDrive.hasMore.value && !cloudDrive.isLoading.value"
          class="cdp__load-more"
          @click="cloudDrive.fetchMore()"
        >
          加载更多
        </button>
        <div v-if="cloudDrive.isLoading.value && cloudDrive.files.value.length > 0" class="cdp__loading-more">
          <div class="cdp__spinner cdp__spinner--sm" /> 加载中...
        </div>
      </div>

      <!-- Local file fallback -->
      <div class="cdp__local">
        <input
          ref="localFileInput"
          type="file"
          accept="video/*"
          style="display:none"
          @change="onLocalFileChange"
        />
        <button class="cdp__local-btn" @click="pickLocalFile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          上传本地视频插播
        </button>
        <span class="cdp__local-hint">不依赖视频库，直接从本机选取 mp4 插播</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.cdp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 600;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}

.cdp {
  width: 480px;
  max-height: 70vh;
  background: $color-bg-panel;
  border: 1px solid $color-border;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.6);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px;
    border-bottom: 1px solid $color-border;
    flex-shrink: 0;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: $color-text-primary;
  }

  &__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: $color-text-muted;
    cursor: pointer;
    transition: all 0.15s;

    &:hover { background: $color-bg-hover; color: $color-text-primary; }
  }

  &__search {
    position: relative;
    padding: 10px 16px;
    flex-shrink: 0;
  }

  &__search-icon {
    position: absolute;
    left: 28px;
    top: 50%;
    transform: translateY(-50%);
    color: $color-text-muted;
    pointer-events: none;
  }

  &__search-input {
    width: 100%;
    padding: 8px 12px 8px 32px;
    background: $color-bg-dark;
    border: 1px solid $color-border;
    border-radius: 8px;
    color: $color-text-primary;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;

    &:focus { border-color: $color-accent; }
    &::placeholder { color: $color-text-muted; }
  }

  &__tabs {
    display: flex;
    padding: 0 16px;
    gap: 4px;
    flex-shrink: 0;
  }

  &__tab {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: $color-text-muted;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;

    &:hover { color: $color-text-primary; background: $color-bg-hover; }

    &--active {
      color: $color-accent;
      background: rgba($color-accent, 0.1);
    }
  }

  &__list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0 16px;

    &::-webkit-scrollbar { width: 4px; }
    &::-webkit-scrollbar-track { background: transparent; }
    &::-webkit-scrollbar-thumb { background: $color-border; border-radius: 2px; }
  }

  &__state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 40px 16px;
    color: $color-text-muted;
    font-size: 13px;

    &--error { color: $color-danger; }

    &--guide {
      gap: 12px;
      padding: 32px 24px;
      color: $color-text-secondary;

      svg { color: $color-text-muted; opacity: 0.6; }
    }
  }

  &__guide-title {
    font-size: 14px;
    font-weight: 600;
    color: $color-text-primary;
    margin: 0;
  }

  &__guide-desc {
    font-size: 12px;
    color: $color-text-muted;
    text-align: center;
    line-height: 1.7;
    margin: 0;
  }

  &__guide-dev {
    margin-top: 8px;
    padding: 12px 14px;
    background: $color-bg-dark;
    border: 1px solid $color-border;
    border-radius: 8px;
    width: 100%;
    box-sizing: border-box;

    p {
      font-size: 11px;
      color: $color-text-muted;
      margin: 0 0 8px;
    }

    pre {
      margin: 0;
      font-size: 11px;
      color: $color-accent;
      font-family: 'Menlo', 'Consolas', monospace;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-all;
    }

    code {
      color: $color-warning;
      font-family: inherit;
    }
  }

  &__retry {
    padding: 6px 16px;
    border: 1px solid $color-danger;
    border-radius: 6px;
    background: transparent;
    color: $color-danger;
    font-size: 12px;
    cursor: pointer;

    &:hover { background: rgba($color-danger, 0.1); }
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    transition: background 0.1s;

    &:hover { background: $color-bg-hover; }
  }

  &__thumb {
    width: 72px;
    height: 46px;
    border-radius: 6px;
    background: $color-bg-dark;
    border: 1px solid $color-border;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    color: $color-text-muted;

    &--doc { width: 46px; background: rgba($color-accent, 0.08); border-color: rgba($color-accent, 0.2); color: $color-accent; }
  }

  &__thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  &__duration {
    position: absolute;
    bottom: 3px;
    right: 4px;
    background: rgba(0,0,0,0.7);
    color: #fff;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1.4;
  }

  &__info {
    flex: 1;
    min-width: 0;
  }

  &__name {
    font-size: 13px;
    color: $color-text-primary;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 3px;
  }

  &__meta {
    font-size: 11px;
    color: $color-text-muted;
  }

  &__actions {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex-shrink: 0;
  }

  &__action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid $color-border;
    background: transparent;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    color: $color-text-secondary;

    &:hover { background: $color-bg-active; color: $color-text-primary; }

    &--pip  { &:hover { border-color: $color-accent;   color: $color-accent; } }
    &--fs   { &:hover { border-color: $color-warning;  color: $color-warning; } }
    &--share { &:hover { border-color: $color-success; color: $color-success; } }
  }

  &__load-more {
    display: block;
    width: calc(100% - 32px);
    margin: 8px 16px 0;
    padding: 8px;
    border: 1px dashed $color-border;
    border-radius: 8px;
    background: transparent;
    color: $color-text-muted;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;

    &:hover { border-color: $color-accent; color: $color-accent; }
  }

  &__loading-more {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px;
    font-size: 12px;
    color: $color-text-muted;
  }
}

// ── Local file upload ─────────────────────────────────────────────────────────
.cdp__local {
  flex-shrink: 0;
  padding: 10px 16px 16px;
  border-top: 1px solid $color-border;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.cdp__local-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 9px 14px;
  border: 1px dashed $color-border;
  border-radius: 8px;
  background: transparent;
  color: $color-text-secondary;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  justify-content: center;
  transition: all 0.15s;

  &:hover {
    border-color: $color-accent;
    color: $color-accent;
    background: rgba($color-accent, 0.05);
  }
}

.cdp__local-hint {
  font-size: 11px;
  color: $color-text-muted;
}

// ── Spinner ──────────────────────────────────────────────────────────────────
.cdp__spinner {
  width: 28px;
  height: 28px;
  border: 3px solid $color-border;
  border-top-color: $color-accent;
  border-radius: 50%;
  animation: cdp-spin 0.7s linear infinite;

  &--sm { width: 14px; height: 14px; border-width: 2px; }
  &--xs { width: 10px; height: 10px; border-width: 2px; }
}

@keyframes cdp-spin {
  to { transform: rotate(360deg); }
}
</style>
