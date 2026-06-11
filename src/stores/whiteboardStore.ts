import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WhiteboardPage, WhiteboardTool, ToolOptions } from '@/types/whiteboard'

let pageCounter = 1

function createPage(): WhiteboardPage {
  return { id: `page-${Date.now()}`, name: `白板 ${pageCounter++}` }
}

export const useWhiteboardStore = defineStore('whiteboard', () => {
  const pages = ref<WhiteboardPage[]>([createPage()])
  const activePageId = ref(pages.value[0]!.id)
  const activeTool = ref<WhiteboardTool>('pen')
  const toolOptions = ref<ToolOptions>({
    color: '#000000',
    strokeWidth: 3,
    fontSize: 18,
    fontFamily: 'sans-serif',
    eraserSize: 30,
  })
  const canUndo = ref(false)
  const canRedo = ref(false)
  // Action triggers — WhiteboardCanvas watches these
  const triggerUndo = ref(0)
  const triggerRedo = ref(0)
  const triggerClear = ref(0)

  function addPage() {
    const page = createPage()
    pages.value.push(page)
    activePageId.value = page.id
  }

  /** Used when receiving a remote wb:page-add so ID stays in sync */
  function addPageWithId(id: string, name: string, json?: object) {
    if (pages.value.find(p => p.id === id)) return
    pages.value.push({ id, name, fabricJson: json })
  }

  function removePage(id: string) {
    if (pages.value.length === 1) return
    const idx = pages.value.findIndex(p => p.id === id)
    pages.value.splice(idx, 1)
    if (activePageId.value === id) {
      activePageId.value = pages.value[Math.max(0, idx - 1)]!.id
    }
  }

  function switchPage(id: string) {
    activePageId.value = id
  }

  function setTool(tool: WhiteboardTool) {
    activeTool.value = tool
  }

  function updateToolOptions(opts: Partial<ToolOptions>) {
    toolOptions.value = { ...toolOptions.value, ...opts }
  }

  // ── Active mode ────────────────────────────────────────────────────────────
  const activeMode = ref<'whiteboard' | 'screen' | 'document'>('whiteboard')

  // ── Content visibility (camera-maximize / whiteboard-hide) ─────────────────
  /** Whether the main canvas content (whiteboard/document) is visually hidden
   *  so the camera can fill the full canvas area.
   *  Defaults to true: entering the room starts with the camera maximized;
   *  the host opens the whiteboard explicitly via the bottom-bar button. */
  const isContentHidden = ref(true)

  function toggleContentHidden() {
    isContentHidden.value = !isContentHidden.value
  }

  // ── Screen-share mode enter/exit ───────────────────────────────────────────
  // Dedicated helpers that atomically save/restore both activeMode and
  // isContentHidden so screen-share never corrupts the pre-share UI state.
  let _preScrContentHidden = false
  let _preScrMode: 'whiteboard' | 'document' = 'whiteboard'

  function enterScreenMode() {
    if (activeMode.value === 'screen') return
    _preScrContentHidden = isContentHidden.value
    _preScrMode = activeMode.value === 'document' ? 'document' : 'whiteboard'
    activeMode.value = 'screen'
    isContentHidden.value = false          // reveal whiteboard overlay during share
  }

  function exitScreenMode() {
    if (activeMode.value !== 'screen') return
    const wasHidden = _preScrContentHidden
    const prevMode  = _preScrMode
    _preScrContentHidden = false
    _preScrMode = 'whiteboard'
    activeMode.value = prevMode            // restore whiteboard OR document
    isContentHidden.value = wasHidden      // restore camera-maximized state atomically
  }

  function setActiveMode(mode: 'whiteboard' | 'screen' | 'document') {
    // Screen mode must go through enterScreenMode() so _preScrMode /
    // _preScrContentHidden are saved correctly. Guard prevents accidental bypass.
    if (mode === 'screen') { enterScreenMode(); return }
    // Switching to a new mode always reveals the canvas content
    if (activeMode.value !== mode) isContentHidden.value = false
    activeMode.value = mode
    // Auto-switch to select so document can be scrolled immediately
    if (mode === 'document') activeTool.value = 'select'
  }

  function fireUndo() { if (canUndo.value) triggerUndo.value++ }
  function fireRedo() { if (canRedo.value) triggerRedo.value++ }
  function fireClear() { triggerClear.value++ }

  return {
    pages, activePageId, activeTool, toolOptions, canUndo, canRedo,
    triggerUndo, triggerRedo, triggerClear, activeMode, isContentHidden,
    addPage, addPageWithId, removePage, switchPage, setTool, updateToolOptions,
    fireUndo, fireRedo, fireClear, setActiveMode, toggleContentHidden,
    enterScreenMode, exitScreenMode,
  }
})
