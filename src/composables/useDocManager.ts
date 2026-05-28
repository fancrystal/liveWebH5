import { ref, computed, markRaw } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).href

export interface DocEntry {
  id: string
  name: string
  pdfDoc: pdfjsLib.PDFDocumentProxy
  totalPages: number
  /** JPEG data-URL thumbnails, one per page */
  thumbnails: string[]
  currentPage: number
}

// Module-level singleton — one doc manager for the whole app
const openDocs = ref<DocEntry[]>([])
const activeDocId = ref<string | null>(null)
const isLoading = ref(false)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const activeDoc = computed<DocEntry | null>(() => (openDocs.value.find(d => d.id === activeDocId.value) ?? null) as any)

async function loadFile(file: File): Promise<void> {
  if (file.type !== 'application/pdf') return
  isLoading.value = true
  try {
    const buffer = await file.arrayBuffer()
    const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise
    const totalPages = pdfDoc.numPages
    const thumbnails: string[] = []

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDoc.getPage(i)
      const vp0 = page.getViewport({ scale: 1 })
      const scale = 120 / vp0.width // thumbnail ~120 px wide
      const vp = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = vp.width
      canvas.height = vp.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
      thumbnails.push(canvas.toDataURL('image/jpeg', 0.65))
    }

    const entry: DocEntry = {
      id: `doc-${Date.now()}`,
      name: file.name,
      pdfDoc: markRaw(pdfDoc),
      totalPages,
      thumbnails,
      currentPage: 1,
    }
    openDocs.value.push(entry)
    activeDocId.value = entry.id
  } finally {
    isLoading.value = false
  }
}

function closeDoc(id: string): void {
  const idx = openDocs.value.findIndex(d => d.id === id)
  if (idx < 0) return
  openDocs.value[idx]!.pdfDoc.destroy()
  openDocs.value.splice(idx, 1)
  if (activeDocId.value === id) {
    activeDocId.value = openDocs.value[Math.max(0, idx - 1)]?.id ?? null
  }
}

function setActiveDoc(id: string): void {
  if (openDocs.value.find(d => d.id === id)) activeDocId.value = id
}

function setCurrentPage(page: number): void {
  const doc = activeDoc.value
  if (doc && page >= 1 && page <= doc.totalPages) doc.currentPage = page
}

export function useDocManager() {
  return { openDocs, activeDocId, activeDoc, isLoading, loadFile, closeDoc, setActiveDoc, setCurrentPage }
}
