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

// When entering document mode: save whiteboard content, clear the canvas so
// whiteboard strokes don't bleed into document annotations, then reset history.
// When leaving document mode: clear annotations and restore the whiteboard page.
watch(() => wbStore.activeMode, (mode, prevMode) => {
  if (!fc.value) return
  if (mode === 'document') {
    // Snapshot whiteboard content BEFORE clearing the canvas.
    // resetPageHistory() internally calls saveSnapshot() → onLocalChange() which
    // overwrites page.fabricJson with the now-empty canvas, so we must re-apply
    // the snapshot after resetPageHistory() finishes.
    const whiteboardSnapshot = fc.value.toJSON()
    fc.value.clear()
    fc.value.backgroundColor = ''
    fc.value.renderAll()
    applyDocScroll(docScrollTop.value)
    resetPageHistory()
    // Re-apply: ensure fabricJson holds whiteboard content, not the empty canvas
    // that saveSnapshot() just wrote.
    const page = wbStore.pages.find(p => p.id === wbStore.activePageId)
    if (page) page.fabricJson = whiteboardSnapshot
  } else if (prevMode === 'document') {
    // Restore the whiteboard page that was active before document mode.
    // Clear first so document annotations don't briefly flash on a white background
    // while loadFromJSON is pending.
    fc.value.setViewportTransform([1, 0, 0, 1, 0, 0])
    fc.value.clear()
    fc.value.backgroundColor = '#ffffff'
    fc.value.renderAll()
    const page = wbStore.pages.find(p => p.id === wbStore.activePageId)
    if (page?.fabricJson) {
      fc.value.loadFromJSON(page.fabricJson).then(() => {
        if (!fc.value) return  // guard: component may have unmounted during async load
        fc.value.backgroundColor = '#ffffff'
        fc.value.renderAll()
      })
    }
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
      // In screen-share or document+select mode, pass through all pointer events
      // so the user can interact with the content below (screen preview / PDF page).
      // Without this, the transparent Fabric canvas captures clicks and drawing
      // tools can bleed onto the overlay — despite enterScreenMode() forcing select.
      'wb-container--passthrough': wbStore.activeMode === 'screen'
        || (wbStore.activeMode === 'document' && wbStore.activeTool === 'select'),
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
