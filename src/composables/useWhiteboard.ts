import { shallowRef, watch, onUnmounted, type Ref } from 'vue'
import * as fabric from 'fabric'
import { useWhiteboardStore } from '@/stores/whiteboardStore'

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
  // toolOptions is replaced via spread — shallow watch is sufficient
  watch(() => wbStore.toolOptions, (opts) => { if (fc.value) applyToolOptions(fc.value, opts) })
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
    canvas.on('path:created', (e) => {
      if (wbStore.activeTool === 'laser') {
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
        return
      }

      if (wbStore.activeTool === 'eraser') {
        // Remove objects that intersect with the eraser stroke, then discard
        // the stroke itself so erased content is truly gone (not just covered).
        //
        // Two-pass approach:
        // 1. AABB check using getBoundingRect(true) — already includes strokeWidth/2
        //    so it covers the full visual area of the eraser brush without extra padding.
        // 2. Path-intersection fallback for cases AABB misses (contained objects, etc.)
        const eraserPath = e.path as fabric.Path
        const er = eraserPath.getBoundingRect(true)

        const toRemove = canvas.getObjects().filter(obj => {
          if (obj === eraserPath) return false
          const ob = obj.getBoundingRect(true)
          const aabbHit =
            er.left < ob.left + ob.width &&
            er.left + er.width > ob.left &&
            er.top < ob.top + ob.height &&
            er.top + er.height > ob.top
          return (
            aabbHit ||
            eraserPath.intersectsWithObject(obj) ||
            eraserPath.isContainedWithinObject(obj) ||
            obj.isContainedWithinObject(eraserPath)
          )
        })
        toRemove.forEach(obj => canvas.remove(obj))
        canvas.remove(eraserPath)
        canvas.renderAll()
        saveSnapshot()
        return
      }

      saveSnapshot()
    })

    canvas.on('mouse:down', (e) => {
      if (wbStore.activeTool === 'text') {
        if (e.target instanceof fabric.IText) {
          // Click on existing text — enter editing mode instead of creating new
          canvas.setActiveObject(e.target)
          e.target.enterEditing()
          return
        }
        if (e.target) return  // clicked non-text object — ignore

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

      // Rect tool: start drawing only on empty canvas area, not on existing objects
      if (wbStore.activeTool === 'rect' && !e.target) {
        const pointer = canvas.getScenePoint(e.e)
        rectOrigin = { x: pointer.x, y: pointer.y }
        activeRect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          originX: 'left',
          originY: 'top',
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
          left:   w >= 0 ? rectOrigin.x : pointer.x,
          top:    h >= 0 ? rectOrigin.y : pointer.y,
          width:  Math.abs(w),
          height: Math.abs(h),
        })
        activeRect.setCoords()
        canvas.renderAll()
      }
    })

    canvas.on('mouse:up', () => {
      if (wbStore.activeTool === 'rect' && activeRect) {
        // Discard zero-size rects (single click without drag)
        if ((activeRect.width ?? 0) < 2 || (activeRect.height ?? 0) < 2) {
          canvas.remove(activeRect)
          rectOrigin = null
          activeRect = null
          return
        }
        activeRect.set({ selectable: true, evented: true })
        canvas.setActiveObject(activeRect)
        rectOrigin = null
        activeRect = null
        saveSnapshot()
      }
    })

    // Save snapshot after move / resize / rotate so those actions are undoable
    canvas.on('object:modified', () => {
      saveSnapshot()
    })

    // Delete selected objects — check activeElement to avoid firing inside <input>/<textarea>
    keydownHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (isTextEditing(canvas)) return
      const objs = canvas.getActiveObjects()
      if (objs.length === 0) return
      objs.forEach(o => canvas.remove(o))
      canvas.discardActiveObject()
      canvas.renderAll()
      saveSnapshot()
    }
    document.addEventListener('keydown', keydownHandler)
  }

  function isTextEditing(canvas: fabric.Canvas): boolean {
    const obj = canvas.getActiveObject()
    return obj instanceof fabric.IText && obj.isEditing
  }

  // ─── Background helper ────────────────────────────────────────────────────
  function correctBg(): string {
    const isOverlay = wbStore.activeMode === 'screen' || wbStore.activeMode === 'document'
    return isOverlay ? '' : '#ffffff'
  }

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
    historyRedo.set(id, [])
    wbStore.canUndo = (historyUndo.get(id)?.length ?? 0) > 1
    wbStore.canRedo = false
    onCanvasChange?.(id, json)
  }

  function resetPageHistory(pageId?: string) {
    const id = pageId ?? wbStore.activePageId
    historyUndo.set(id, [])
    historyRedo.set(id, [])
    wbStore.canUndo = false
    wbStore.canRedo = false
    saveSnapshot()
  }

  function undo() {
    const canvas = fc.value
    if (!canvas) return
    const id = wbStore.activePageId
    const stack = historyUndo.get(id)
    if (!stack || stack.length <= 1) return

    const current = stack.pop()!
    if (!historyRedo.has(id)) historyRedo.set(id, [])
    historyRedo.get(id)!.push(current)

    const stateJson = stack[stack.length - 1]!
    canvas.loadFromJSON(stateJson).then(() => {
      if (!fc.value) return
      fixBackground(canvas)
      onCanvasChange?.(id, JSON.parse(stateJson))
      // Update flags only after load completes so they reflect actual canvas state
      wbStore.canUndo = stack.length > 1
      wbStore.canRedo = true
    })
  }

  function redo() {
    const canvas = fc.value
    if (!canvas) return
    const id = wbStore.activePageId
    const redoStack = historyRedo.get(id)
    if (!redoStack || redoStack.length === 0) return
    const undoStack = historyUndo.get(id)
    if (!undoStack) return

    const state = redoStack.pop()!
    undoStack.push(state)

    canvas.loadFromJSON(state).then(() => {
      if (!fc.value) return
      fixBackground(canvas)
      onCanvasChange?.(id, JSON.parse(state))
      wbStore.canUndo = true
      wbStore.canRedo = redoStack.length > 0
    })
  }

  function clearCanvas() {
    const canvas = fc.value
    if (!canvas) return
    canvas.clear()
    const isOverlay = wbStore.activeMode === 'screen' || wbStore.activeMode === 'document'
    canvas.backgroundColor = isOverlay ? '' : '#ffffff'
    canvas.renderAll()
    saveSnapshot()
  }

  // ─── Page switching ───────────────────────────────────────────────────────
  // Tracks which page is currently being loaded so we can discard stale
  // loadFromJSON callbacks if the user switches pages before it completes.
  let currentLoadingPageId: string | null = null

  function switchPage(canvas: fabric.Canvas, prevId: string, nextId: string) {
    const pages = wbStore.pages
    const prevPage = pages.find(p => p.id === prevId)
    // If we were mid-load when this switch fires, the canvas state is unreliable —
    // only save the prev page if we're not currently loading its content.
    if (prevPage && currentLoadingPageId !== prevId) {
      prevPage.fabricJson = canvas.toJSON()
    }

    applyTool(canvas, wbStore.activeTool)

    const nextPage = pages.find(p => p.id === nextId)
    currentLoadingPageId = nextId

    if (nextPage?.fabricJson) {
      canvas.loadFromJSON(nextPage.fabricJson).then(() => {
        // Discard if another switch fired before this load completed
        if (currentLoadingPageId !== nextId) return
        currentLoadingPageId = null
        fixBackground(canvas)
        const existingStack = historyUndo.get(nextId)
        if (!existingStack || existingStack.length === 0) {
          // First visit this session — initialise undo history
          saveSnapshot()
        } else {
          // Return visit: top of existing stack already matches fabricJson.
          // Pushing again would create a duplicate making the first undo a no-op.
          wbStore.canUndo = existingStack.length > 1
          wbStore.canRedo = (historyRedo.get(nextId)?.length ?? 0) > 0
        }
      })
    } else {
      currentLoadingPageId = null
      canvas.clear()
      canvas.backgroundColor = correctBg()
      canvas.renderAll()
      saveSnapshot()
    }
  }

  // ─── Remote sync apply ───────────────────────────────────────────────────
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
