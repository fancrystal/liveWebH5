<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { useWhiteboard } from '@/composables/useWhiteboard'
import { useWhiteboardSync } from '@/composables/useWhiteboardSync'
import { useDocManager } from '@/composables/useDocManager'
import type { Ref } from 'vue'

const wbStore = useWhiteboardStore()
const { activeDocId } = useDocManager()

// Injected from App.vue — tracks DocViewer's scrollTop so we can keep annotations
// aligned with the PDF content regardless of scroll position.
const docScrollTop = inject<Ref<number>>('docScrollTop', ref(0))
const containerEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

// applyRemoteJsonRef is a ref so useWhiteboardSync can call it
// after useWhiteboard has initialised
const applyRemoteJsonRef = ref<((json: object) => void) | null>(null)

const { fc, init, undo, redo, clearCanvas, resetPageHistory, resize, getElement, applyRemoteJson } =
  useWhiteboard(canvasEl, (pageId, json) => wbSync.onLocalChange(pageId, json))

// Wire up the ref after composable is created
applyRemoteJsonRef.value = applyRemoteJson

const wbSync = useWhiteboardSync(applyRemoteJsonRef)

// Expose lower-canvas to parent (App.vue) for stream mixing
const exposeCanvas = inject<(el: HTMLCanvasElement) => void>('exposeWhiteboardCanvas', () => {})

watch(() => wbStore.triggerUndo, () => undo())
watch(() => wbStore.triggerRedo, () => redo())
watch(() => wbStore.triggerClear, () => clearCanvas())

// Sync Fabric viewport with DocViewer scroll so annotations stay aligned with PDF content.
// viewportTransform = [scaleX, 0, 0, scaleY, panX, panY]
// Setting panY = -scrollTop shifts all objects upward by scrollTop pixels, matching the PDF scroll.
function applyDocScroll(scrollTop: number) {
  if (!fc.value || wbStore.activeMode !== 'document') return
  const vt = fc.value.viewportTransform
  fc.value.setViewportTransform([vt[0], vt[1], vt[2], vt[3], vt[4], -scrollTop])
  fc.value.renderAll()
}

watch(docScrollTop, (top) => applyDocScroll(top))

// Clear annotations when switching between documents so marks from one PDF
// do not bleed into another. Only fires in document mode.
watch(activeDocId, () => {
  if (!fc.value || wbStore.activeMode !== 'document') return
  clearCanvas()
})

// When entering document mode: apply current scroll and reset annotation history
// so that undo only covers strokes drawn on the document, not prior whiteboard ops.
// When leaving document mode: reset viewport transform so whiteboard mode is unaffected.
watch(() => wbStore.activeMode, (mode) => {
  if (!fc.value) return
  if (mode === 'document') {
    applyDocScroll(docScrollTop.value)
    resetPageHistory()
  } else {
    fc.value.setViewportTransform([1, 0, 0, 1, 0, 0])
    fc.value.renderAll()
  }
})

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
