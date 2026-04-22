<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'
import { useWhiteboardStore } from '@/stores/whiteboardStore'

const mediaStore = useMediaStore()
const wbStore = useWhiteboardStore()
const videoEl = ref<HTMLVideoElement | null>(null)

function attachStream() {
  if (videoEl.value && mediaStore.screenStream) {
    videoEl.value.srcObject = mediaStore.screenStream
  }
}

watch(() => mediaStore.screenStream, attachStream)
onMounted(attachStream)

function stopShare() {
  mediaStore.stopScreenShare()
  wbStore.setActiveMode('whiteboard')
}
</script>

<template>
  <div class="screen-preview">
    <video
      ref="videoEl"
      class="screen-preview__video"
      autoplay
      muted
      playsinline
    />
    <div class="screen-preview__badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
        <path d="M12 12v9m-4-4 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2"/>
      </svg>
      共享屏幕中
      <button class="screen-preview__stop" @click="stopShare">停止共享</button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.screen-preview {
  position: absolute;
  inset: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;

  &__video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  &__badge {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid $color-border;
    border-radius: 20px;
    color: $color-text-primary;
    font-size: 13px;
    backdrop-filter: blur(4px);
  }

  &__stop {
    margin-left: 6px;
    padding: 2px 8px;
    background: $color-danger;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    &:hover { opacity: 0.85; }
  }
}
</style>
