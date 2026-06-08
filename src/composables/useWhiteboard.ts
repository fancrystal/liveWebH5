import { shallowRef, watch, onUnmounted, type Ref } from 'vue'
import * as fabric from 'fabric'
import { useWhiteboardStore } from '@/stores/whiteboardStore'

/**
 * Manages Fabric.js canvas lifecycle and tool bindings.
 * Each WhiteboardPage gets its own serialized JSON state saved to the store.
 */
type CanvasChangeCallback = (pageId: string, json: object) => void

export function useWhiteboard(
  canvasEl: Ref<HTMLCanvasElement | null>,
  onCanvasChange?: CanvasChangeCallback,
) {
  const wbStore = useWhiteboardStore()
  const fc = shallowRef<fabric.Canvas | null>(null)

  // History stacks per page
  const historyUndo: Map<string, string[]> = new Map()
  const historyRedo: Map<string, string[]> = new Map()

  // ─── Init ────────────────────────────────────────────────────────────────
  function init() {
    if (!canvasEl.value) return

    const canvas = new fabric.Canvas(canvasEl.value, {
      backgroundColor: '#ffffff',
      isDrawingMode: false,
      selection: true,
      preserveObjectStacking: true,
    })

    fc.value = canvas
    bindEvents(canvas)
    applyTool(canvas, wbStore.activeTool)
    saveSnapshot()
  }

  // Top-level watches — auto-cleaned when component unmounts
  watch(() => wbStore.activeTool, (tool) => { if (fc.value) applyTool(fc.value, tool) })
  watch(() => wbStore.toolOptions, (opts) => { if (fc.value) applyToolOptions(fc.value, opts) }, { deep: true })
  watch(() => wbStore.activePageId, (id, prevId) => { if (fc.value) switchPage(fc.value, prevId, id) })

  // Transparent background in screen-share / document annotation mode
  watch(() => wbStore.activeMode, (mode) => {
    if (!fc.value) return
    fc.value.backgroundColor = (mode === 'screen' || mode === 'document') ? '' : '#ffffff'
    fc.value.renderAll()
  })

  // ─── Tool application ────────────────────────────────────────────────────
  function applyTool(canvas: fabric.Canvas, tool: string) {
    canvas.isDrawingMode = false
    canvas.selection = true
    canvas.defaultCursor = 'default'
    canvas.hoverCursor = 'move'

    switch (tool) {
      case 'pen':
        canvas.isDrawingMode = true
        applyBrush(canvas)
        break
      case 'eraser':
        canvas.isDrawingMode = true
        applyEraserBrush(canvas)
        break
      case 'laser':
        canvas.isDrawingMode = true
        applyLaserBrush(canvas)
        break
      case 'text':
        canvas.isDrawingMode = false
        canvas.defaultCursor = 'text'
        canvas.hoverCursor = 'text'
        // Text is created on mousedown (see bindEvents)
        break
      case 'rect':
        canvas.isDrawingMode = false
        canvas.selection = false
        canvas.defaultCursor = 'crosshair'
        break
      case 'select':
        canvas.isDrawingMode = false
        break
    }
  }

  function applyBrush(canvas: fabric.Canvas) {
    const opts = wbStore.toolOptions
    const brush = new fabric.PencilBrush(canvas)
    brush.color = opts.color
    brush.width = opts.strokeWidth
    canvas.freeDrawingBrush = brush
  }

  function applyEraserBrush(canvas: fabric.Canvas) {
    // Use white PencilBrush as an eraser approximation
    const brush = new fabric.PencilBrush(canvas)
    brush.color = '#ffffff'
    brush.width = wbStore.toolOptions.eraserSize
    canvas.freeDrawingBrush = brush
  }

  function applyLaserBrush(canvas: fabric.Canvas) {
    const brush = new fabric.PencilBrush(canvas)
    brush.color = '#ef4444'
    brush.width = 4
    canvas.freeDrawingBrush = brush
  }

  function applyToolOptions(canvas: fabric.Canvas, opts: typeof wbStore.toolOptions) {
    if (canvas.isDrawingMode && canvas.freeDrawingBrush) {
      if (wbStore.activeTool === 'pen') {
        canvas.freeDrawingBrush.color = opts.color
        canvas.freeDrawingBrush.width = opts.strokeWidth
      } else if (wbStore.activeTool === 'eraser') {
        canvas.freeDrawingBrush.width = opts.eraserSize
      }
    }
  }

  // ─── Rect draw logic ─────────────────────────────────────────────────────
  let rectOrigin: { x: number; y: number } | null = null
  let activeRect: fabric.Rect | null = null

  // ─── Laser fade logic ────────────────────────────────────────────────────
  const laserPaths: Array<{ path: fabric.Path; timer: ReturnType<typeof setTimeout> }> = []

  // Stored so we can remove it in onUnmounted
  let keydownHandler: ((e: KeyboardEvent) => void) | null = null

  // ─── Events ─────────────────────────────────────────────────────────────
  function bindEvents(canvas: fabric.Canvas) {
    // Save undo snapshot after any path added
    canvas.on('path:created', (e) => {
      if (wbStore.activeTool === 'laser') {
        // Fade out laser path after 1.5s
        const path = e.path as fabric.Path
        path.selectable = false
        path.evented = false
        const timer = setTimeout(() => {
          canvas.remove(path)
          canvas.renderAll()
          const idx = laserPaths.findIndex(lp => lp.path === path)
          if (idx !== -1) laserPaths.splice(idx, 1)
        }, 1500)
        laserPaths.push({ path, timer })
        // Don't save laser to history
        return
      }
      saveSnapshot()
    })

    // Text tool: click to add IText
    canvas.on('mouse:down', (e) => {
      if (wbStore.activeTool === 'text') {
        const pointer = canvas.getScenePoint(e.e)
        const text = new fabric.IText('', {
          left: pointer.x,
          top: pointer.y,
          fontSize: wbStore.toolOptions.fontSize,
          fontFamily: wbStore.toolOptions.fontFamily,
          fill: wbStore.toolOptions.color,
          selectable: true,
          editable: true,
        })
        canvas.add(text)
        canvas.setActiveObject(text)
        text.enterEditing()
        saveSnapshot()
        return
      }

      // Rect tool: start drawing
      if (wbStore.activeTool === 'rect') {
        const pointer = canvas.getScenePoint(e.e)
        rectOrigin = { x: pointer.x, y: pointer.y }
        activeRect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          stroke: wbStore.toolOptions.color,
          strokeWidth: wbStore.toolOptions.strokeWidth,
          fill: 'transparent',
          selectable: false,
          evented: false,
        })
        canvas.add(activeRect)
      }
    })

    canvas.on('mouse:move', (e) => {
      if (wbStore.activeTool === 'rect' && rectOrigin && activeRect) {
        const pointer = canvas.getScenePoint(e.e)
        const w = pointer.x - rectOrigin.x
        const h = pointer.y - rectOrigin.y
        activeRect.set({
          left: w >= 0 ? rectOrigin.x : pointer.x,
          top: h >= 0 ? rectOrigin.y : pointer.y,
          width: Math.abs(w),
          height: Math.abs(h),
        })
        canvas.renderAll()
      }
    })

    canvas.on('mouse:up', () => {
      if (wbStore.activeTool === 'rect' && activeRect) {
        activeRect.set({ selectable: true, evented: true })
        canvas.setActiveObject(activeRect)
        rectOrigin = null
        activeRect = null
        saveSnapshot()
      }
    })

    // Delete selected objects — handler stored for later removal
    keydownHandler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextEditing(canvas)) {
        const objs = canvas.getActiveObjects()
        objs.forEach(o => canvas.remove(o))
        canvas.discardActiveObject()
        canvas.renderAll()
        saveSnapshot()
      }
    }
    document.addEventListener('keydown', keydownHandler)
  }

  function isTextEditing(canvas: fabric.Canvas): boolean {
    const obj = canvas.getActiveObject()
    return obj instanceof fabric.IText && obj.isEditing
  }

  // ─── Background helper ────────────────────────────────────────────────────
  /** Return the correct backgroundColor for the current mode. */
  function correctBg(): string {
    const isOverlay = wbStore.activeMode === 'screen' || wbStore.activeMode === 'document'
    return isOverlay ? '' : '#ffffff'
  }

  /** Apply the correct background after any loadFromJSON call. */
  function fixBackground(canvas: fabric.Canvas) {
    canvas.backgroundColor = correctBg()
    canvas.renderAll()
  }

  // ─── Undo / Redo ─────────────────────────────────────────────────────────
  function saveSnapshot() {
    const canvas = fc.value
    if (!canvas) return
    const id = wbStore.activePageId
    if (!historyUndo.has(id)) historyUndo.set(id, [])
    const json = canvas.toJSON()
    historyUndo.get(id)!.push(JSON.stringify(json))
    historyRedo.set(id, [])  // clear redo
    wbStore.canUndo = (historyUndo.get(id)?.length ?? 0) > 1
    wbStore.canRedo = false
    onCanvasChange?.(id, json)
  }

  /**
   * Reset undo/redo history for the given page (defaults to activePageId).
   * Called when switching into document mode so that undo only covers
   * annotations drawn on the document, not prior whiteboard strokes.
   */
  function resetPageHistory(pageId?: string) {
    const id = pageId ?? wbStore.activePageId
    historyUndo.set(id, [])
    historyRedo.set(id, [])
    wbStore.canUndo = false
    wbStore.canRedo = false
    // Re-save the current canvas state as the new baseline snapshot
    saveSnapshot()
  }

  function undo() {
    const canvas = fc.value
    if (!canvas) return
    const id = wbStore.activePageId
    const stack = historyUndo.get(id) ?? []
    if (stack.length <= 1) return
    const current = stack.pop()!
    if (!historyRedo.has(id)) historyRedo.set(id, [])
    historyRedo.get(id)!.push(current)
    const stateJson = stack[stack.length - 1] ?? '{}'
    canvas.loadFromJSON(stateJson).then(() => {
      fixBackground(canvas)
      onCanvasChange?.(id, JSON.parse(stateJson))
    })
    wbStore.canUndo = stack.length > 1
    wbStore.canRedo = true
  }

  function redo() {
    const canvas = fc.value
    if (!canvas) return
    const id = wbStore.activePageId
    const stack = historyRedo.get(id) ?? []
    if (stack.length === 0) return
    const state = stack.pop()!
    historyUndo.get(id)!.push(state)
    canvas.loadFromJSON(state).then(() => {
      fixBackground(canvas)
      onCanvasChange?.(id, JSON.parse(state))
    })
    wbStore.canUndo = true
    wbStore.canRedo = stack.length > 0
  }

  function clearCanvas() {
    const canvas = fc.value
    if (!canvas) return
    canvas.clear()
    // Preserve transparent background in overlay modes (document / screen annotation).
    // canvas.clear() wipes backgroundColor, so we must re-apply the correct value.
    const isOverlay = wbStore.activeMode === 'screen' || wbStore.activeMode === 'document'
    canvas.backgroundColor = isOverlay ? '' : '#ffffff'
    canvas.renderAll()
    saveSnapshot()  // saveSnapshot already calls onCanvasChange
  }

  // ─── Page switching ───────────────────────────────────────────────────────
  function switchPage(canvas: fabric.Canvas, prevId: string, nextId: string) {
    // Save current page JSON to store
    const pages = wbStore.pages
    const prevPage = pages.find(p => p.id === prevId)
    if (prevPage) prevPage.fabricJson = canvas.toJSON()

    // Load next page
    const nextPage = pages.find(p => p.id === nextId)
    if (nextPage?.fabricJson) {
      canvas.loadFromJSON(nextPage.fabricJson).then(() => fixBackground(canvas))
    } else {
      canvas.clear()
      canvas.backgroundColor = correctBg()
      canvas.renderAll()
    }
    applyTool(canvas, wbStore.activeTool)
    saveSnapshot()
  }

  // ─── Remote sync apply ───────────────────────────────────────────────────
  /**
   * Apply a remote canvas JSON to the active page without triggering sync back.
   * Called when we receive wb:patch from the signaling server.
   */
  function applyRemoteJson(json: object) {
    const canvas = fc.value
    if (!canvas) return
    canvas.loadFromJSON(json).then(() => canvas.renderAll())
  }

  // ─── Export ──────────────────────────────────────────────────────────────
  function getElement(): HTMLCanvasElement | null {
    return fc.value?.getElement() ?? null
  }

  function resize(width: number, height: number) {
    const canvas = fc.value
    if (!canvas) return
    canvas.setDimensions({ width, height })
    canvas.renderAll()
  }

  onUnmounted(() => {
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler)
      keydownHandler = null
    }
    laserPaths.forEach(({ timer }) => clearTimeout(timer))
    laserPaths.length = 0
    fc.value?.dispose()
    fc.value = null
  })

  return { fc, init, undo, redo, clearCanvas, resetPageHistory, getElement, resize, applyRemoteJson }
}
