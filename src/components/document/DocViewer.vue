<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useDocManager } from '@/composables/useDocManager'

const { activeDoc, activeDocId, loadFile } = useDocManager()

const scrollWrap = ref<HTMLDivElement | null>(null)
const isRendering = ref(false)

// Re-render all pages whenever the active document changes
watch(activeDocId, async () => {
  await nextTick()
  if (activeDoc.value) {
    await renderAllPages()
  } else {
    if (scrollWrap.value) scrollWrap.value.innerHTML = ''
  }
})

// Scroll to page when currentPage changes (thumbnail click)
watch(
  () => activeDoc.value?.currentPage,
  async (page) => {
    if (!page) return
    await nextTick()
    const wrap = scrollWrap.value
    if (!wrap) return
    const canvases = wrap.querySelectorAll<HTMLCanvasElement>('.doc-page')
    const target = canvases[page - 1]
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
)

async function renderAllPages() {
  const doc = activeDoc.value
  const wrap = scrollWrap.value
  if (!doc || !wrap) return

  isRendering.value = true
  wrap.innerHTML = ''

  const containerW = wrap.clientWidth || 800

  for (let i = 1; i <= doc.totalPages; i++) {
    const page = await doc.pdfDoc.getPage(i)
    const vp0 = page.getViewport({ scale: 1 })
    const scale = (containerW - 32) / vp0.width
    const vp = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.className = 'doc-page'
    canvas.width = vp.width
    canvas.height = vp.height
    canvas.dataset.page = String(i)
    wrap.appendChild(canvas)

    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
  }

  isRendering.value = false
}

/** Returns the first visible page canvas — used by StreamMixer for encoding */
function getVisibleCanvas(): HTMLCanvasElement | null {
  const wrap = scrollWrap.value
  if (!wrap) return null
  // Return the first canvas that is within the visible scroll region
  const children = wrap.querySelectorAll<HTMLCanvasElement>('.doc-page')
  for (const c of children) {
    const rect = c.getBoundingClientRect()
    const wrapRect = wrap.getBoundingClientRect()
    if (rect.bottom >= wrapRect.top && rect.top <= wrapRect.bottom) return c
  }
  return children[0] ?? null
}

// Drag-and-drop directly onto the viewer
function onDragOver(e: DragEvent) { e.preventDefault() }
function onDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file?.type === 'application/pdf') loadFile(file)
}

defineExpose({ loadFile, getVisibleCanvas })
</script>

<template>
  <div class="doc-viewer" @dragover="onDragOver" @drop="onDrop">
    <!-- Empty state: no document open -->
    <div v-if="!activeDoc && !isRendering" class="doc-viewer__empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <p>将 PDF 拖拽到此处<br>或点击左侧「打开新文档」</p>
    </div>

    <!-- Rendering indicator -->
    <div v-if="isRendering" class="doc-viewer__loading">
      <span>渲染中…</span>
    </div>

    <!-- Page canvases — injected by renderAllPages() -->
    <div ref="scrollWrap" class="doc-viewer__pages" />
  </div>
</template>

<style lang="scss" scoped>
.doc-viewer {
  position: absolute;
  inset: 0;
  background: #2a2a2a;
  overflow: hidden;
  display: flex;
  flex-direction: column;

  &__empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    color: $color-text-muted;
    font-size: 13px;
    text-align: center;
    padding: 24px;
    pointer-events: none;

    p { margin: 0; line-height: 1.6; }
  }

  &__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: $color-text-secondary;
    font-size: 13px;
    flex-shrink: 0;
  }

  &__pages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 16px;

    &::-webkit-scrollbar { width: 6px; }
    &::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

    // Canvases injected by JS
    :deep(.doc-page) {
      max-width: 100%;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
      border-radius: 2px;
      display: block;
      flex-shrink: 0;
    }
  }
}
</style>
