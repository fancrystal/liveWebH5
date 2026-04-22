<script setup lang="ts">
import { ref, shallowRef } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

const fileInput  = ref<HTMLInputElement | null>(null)
const scrollWrap = ref<HTMLDivElement | null>(null)

const pdfDoc    = shallowRef<pdfjsLib.PDFDocumentProxy | null>(null)
const totalPages = ref(0)
const isLoading  = ref(false)
const fileName   = ref('')

/** Render one page into a newly-created canvas and append to container */
async function renderOnePage(pageNum: number, container: HTMLDivElement, width: number) {
  const page     = await pdfDoc.value!.getPage(pageNum)
  const vp0      = page.getViewport({ scale: 1 })
  const scale    = (width - 32) / vp0.width   // 16px padding each side
  const viewport = page.getViewport({ scale })

  const canvas        = document.createElement('canvas')
  canvas.width        = viewport.width
  canvas.height       = viewport.height
  canvas.className    = 'doc-viewer__canvas'
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
}

async function renderAllPages() {
  const wrap = scrollWrap.value
  if (!wrap || !pdfDoc.value) return

  // Clear previous pages
  wrap.innerHTML = ''
  const containerW = wrap.clientWidth || 800

  for (let i = 1; i <= totalPages.value; i++) {
    await renderOnePage(i, wrap, containerW)
  }
}

async function loadFile(file: File) {
  isLoading.value = true
  fileName.value  = file.name
  try {
    const buffer = await file.arrayBuffer()
    pdfDoc.value  = await pdfjsLib.getDocument({ data: buffer }).promise
    totalPages.value = pdfDoc.value.numPages
    await renderAllPages()
  } finally {
    isLoading.value = false
  }
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file?.type === 'application/pdf') loadFile(file)
}

function triggerUpload() { fileInput.value?.click() }

function onDragOver(e: DragEvent) { e.preventDefault() }
function onDrop(e: DragEvent) {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file?.type === 'application/pdf') loadFile(file)
}

defineExpose({ loadFile })
</script>

<template>
  <div class="doc-viewer" @dragover="onDragOver" @drop="onDrop">
    <!-- Toolbar -->
    <div class="doc-viewer__toolbar">
      <button class="doc-viewer__upload-btn" @click="triggerUpload">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        上传 PDF
      </button>
      <input ref="fileInput" type="file" accept=".pdf" class="doc-viewer__file-input" @change="onFileChange" />
      <span v-if="fileName" class="doc-viewer__filename">{{ fileName }}</span>
      <span v-if="totalPages" class="doc-viewer__page-count">共 {{ totalPages }} 页</span>
    </div>

    <!-- Scrollable pages -->
    <div class="doc-viewer__scroll">
      <div v-if="!pdfDoc && !isLoading" class="doc-viewer__empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>将 PDF 拖拽到此处，或点击「上传 PDF」</p>
      </div>
      <div v-if="isLoading" class="doc-viewer__loading">
        <span>加载中...</span>
      </div>
      <!-- All page canvases are appended here by renderAllPages() -->
      <div ref="scrollWrap" class="doc-viewer__pages" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.doc-viewer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #2a2a2a;
  overflow: hidden;

  &__toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: $color-bg-panel;
    border-bottom: 1px solid $color-border;
    flex-shrink: 0;
  }

  &__upload-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: $color-accent;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
    &:hover { background: $color-accent-hover; }
  }

  &__file-input { display: none; }

  &__filename {
    font-size: 13px;
    color: $color-text-secondary;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__page-count {
    font-size: 12px;
    color: $color-text-muted;
    white-space: nowrap;
  }

  &__scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
  }

  &__empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: $color-text-muted;
    font-size: 14px;
    text-align: center;
    padding: 24px;
    p { margin: 0; }
  }

  &__loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: $color-text-secondary;
    font-size: 14px;
  }

  &__pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 16px;
  }

  // Canvases injected by JS
  :deep(.doc-viewer__canvas) {
    max-width: 100%;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    border-radius: 2px;
    display: block;
  }
}
</style>
