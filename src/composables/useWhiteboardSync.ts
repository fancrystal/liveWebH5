import { watch, type Ref } from 'vue'
import { useWhiteboardStore } from '@/stores/whiteboardStore'
import { signalService } from '@/services/SignalService'

/**
 * Whiteboard synchronization via Socket.io signaling.
 *
 * Host side emits:
 *   wb:patch        { pageId, json }       — canvas changed (debounced 300ms)
 *   wb:page-switch  { pageId }             — active page changed
 *   wb:page-add     { pageId, name }       — new page added
 *   wb:page-remove  { pageId }             — page removed
 *   wb:full-state   { pages, activePageId }— response to wb:request-full-state
 *
 * Host side listens:
 *   wb:request-full-state                  — viewer joined, send full state
 *   wb:patch        { pageId, json }       — (co-host) remote canvas change
 *   wb:page-switch  { pageId }             — (co-host) remote page switch
 *   wb:page-add     { pageId, name }       — (co-host) remote page add
 *   wb:page-remove  { pageId }             — (co-host) remote page remove
 */
export function useWhiteboardSync(
  /** Called when a remote wb:patch arrives for the currently active page */
  applyRemoteJsonRef: Ref<((json: object) => void) | null>,
) {
  const wbStore = useWhiteboardStore()

  // Guard: ignore emits that are triggered by applying remote data
  let applyingRemote = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // ─── Emit helpers ─────────────────────────────────────────────────────────

  function emitPatch(pageId: string, json: object) {
    if (applyingRemote) return
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      signalService.emit('wb:patch', { pageId, json })
    }, 300)
  }

  function emitFullState() {
    const pages = wbStore.pages.map(p => ({
      pageId: p.id,
      name: p.name,
      json: p.fabricJson ?? {},
    }))
    signalService.emit('wb:full-state', {
      pages,
      activePageId: wbStore.activePageId,
    })
  }

  // ─── Called by useWhiteboard after each local canvas change ──────────────

  function onLocalChange(pageId: string, json: object) {
    // Also persist json to store so full-state requests have fresh data
    const page = wbStore.pages.find(p => p.id === pageId)
    if (page) page.fabricJson = json
    emitPatch(pageId, json)
  }

  // ─── Watch page-level store changes ──────────────────────────────────────

  // Active page switch
  watch(() => wbStore.activePageId, (pageId) => {
    if (applyingRemote) return
    signalService.emit('wb:page-switch', { pageId })
  })

  // Page list changes — detect add/remove by comparing prev and next
  let prevPageIds: string[] = wbStore.pages.map(p => p.id)
  watch(
    () => wbStore.pages.map(p => p.id),
    (next) => {
      if (applyingRemote) { prevPageIds = [...next]; return }
      const added = next.filter(id => !prevPageIds.includes(id))
      const removed = prevPageIds.filter(id => !next.includes(id))
      added.forEach(id => {
        const page = wbStore.pages.find(p => p.id === id)
        if (page) signalService.emit('wb:page-add', { pageId: id, name: page.name })
      })
      removed.forEach(id => {
        signalService.emit('wb:page-remove', { pageId: id })
      })
      prevPageIds = [...next]
    },
    { deep: false },
  )

  // ─── Listen for incoming socket events ───────────────────────────────────

  function startListening() {
    // Viewer requests full state on join
    signalService.on('wb:request-full-state', () => {
      emitFullState()
    })

    // Remote canvas patch (co-host or replay)
    signalService.on('wb:patch', (data: unknown) => {
      const { pageId, json } = data as { pageId: string; json: object }
      applyingRemote = true
      try {
        if (pageId === wbStore.activePageId) {
          applyRemoteJsonRef.value?.(json)
        }
        // Always update store so full-state is accurate
        const page = wbStore.pages.find(p => p.id === pageId)
        if (page) page.fabricJson = json
      } finally {
        // Reset flag after a tick so local watches don't echo back
        setTimeout(() => { applyingRemote = false }, 50)
      }
    })

    // Remote page switch
    signalService.on('wb:page-switch', (data: unknown) => {
      const { pageId } = data as { pageId: string }
      applyingRemote = true
      wbStore.switchPage(pageId)
      setTimeout(() => { applyingRemote = false }, 50)
    })

    // Remote page add
    signalService.on('wb:page-add', (data: unknown) => {
      const { pageId, name } = data as { pageId: string; name: string }
      applyingRemote = true
      wbStore.addPageWithId(pageId, name)
      setTimeout(() => { applyingRemote = false }, 50)
    })

    // Remote page remove
    signalService.on('wb:page-remove', (data: unknown) => {
      const { pageId } = data as { pageId: string }
      applyingRemote = true
      wbStore.removePage(pageId)
      setTimeout(() => { applyingRemote = false }, 50)
    })

    // Full state from another host (reconnect scenario)
    signalService.on('wb:full-state', (data: unknown) => {
      const { pages, activePageId } = data as {
        pages: Array<{ pageId: string; name: string; json: object }>
        activePageId: string
      }
      applyingRemote = true
      pages.forEach(({ pageId, name, json }) => {
        wbStore.addPageWithId(pageId, name, json)
      })
      wbStore.switchPage(activePageId)
      setTimeout(() => { applyingRemote = false }, 50)
    })
  }

  function stopListening() {
    if (debounceTimer) clearTimeout(debounceTimer)
    signalService.off('wb:request-full-state', emitFullState)
  }

  return { onLocalChange, startListening, stopListening }
}
