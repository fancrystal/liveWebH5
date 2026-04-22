<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useWhiteboard } from '@/composables/useWhiteboard'
import { useWhiteboardSync } from '@/composables/useWhiteboardSync'

const wbStore = useWhiteboardStore()
const containerEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

// applyRemoteJsonRef is a ref so useWhiteboardSync can call it
// after useWhiteboard has initialised
const applyRemoteJsonRef = ref<((json: object) => void) | null>(null)

const { init, undo, redo, clearCanvas, resize, getElement, applyRemoteJson } =
  useWhiteboard(canvasEl, (pageId, json) => wbSync.onLocalChange(pageId, json))

// Wire up the ref after composable is created
applyRemoteJsonRef.value = applyRemoteJson

const wbSync = useWhiteboardSync(applyRemoteJsonRef)

// Expose lower-canvas to parent (App.vue) for stream mixing
const exposeCanvas = inject<(el: HTMLCanvasElement) => void>('exposeWhiteboardCanvas', () => {})

watch(() => wbStore.triggerUndo, () => undo())
watch(() => wbStore.triggerRedo, () => redo())
watch(() => wbStore.triggerClear, () => clearCanvas())

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  init()

  // Set correct initial size after Fabric initialises
  if (containerEl.value) {
    const { width, height } = containerEl.value.getBoundingClientRect()
    if (width > 0 && height > 0) resize(Math.floor(width), Math.floor(height))
  }

  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    const { width, height } = entry.contentRect
    if (width > 0 && height > 0) resize(Math.floor(width), Math.floor(height))
  })

  if (containerEl.value) resizeObserver.observe(containerEl.value)

  // Expose the Fabric lower-canvas element to App.vue for stream mixing
  const lowerCanvas = getElement()
  if (lowerCanvas) exposeCanvas(lowerCanvas)

  // Start listening for remote whiteboard events
  wbSync.startListening()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  wbSync.stopListening()
})
</script>

<template>
  <div
    ref="containerEl"
    class="wb-container"
    :class="{
      'wb-container--overlay': wbStore.activeMode === 'screen' || wbStore.activeMode === 'document',
      'wb-container--passthrough': wbStore.activeMode === 'document' && wbStore.activeTool === 'select',
    }"
  >
    <canvas ref="canvasEl" />
  </div>
</template>

<style lang="scss" scoped>
.wb-container {
  position: absolute;
  inset: 0;
  background: #f0f0f0;
  overflow: hidden;

  :deep(.canvas-container) {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
  }

  // Screen-share / document annotation overlay — transparent, on top
  &--overlay {
    background: transparent !important;
    z-index: 5;

    :deep(.canvas-container),
    :deep(canvas) {
      background: transparent !important;
    }
  }

  // Select tool in overlay mode: let scroll / click pass through to content below
  &--passthrough {
    pointer-events: none;

    :deep(.canvas-container),
    :deep(canvas) {
      pointer-events: none;
    }
  }
}
</style>
