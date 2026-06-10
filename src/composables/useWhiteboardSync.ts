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

  // Max serialized size accepted for a remote canvas JSON (defense against a
  // malicious/buggy peer DoS-ing the host with a giant payload).
  const MAX_REMOTE_JSON_BYTES = 2_000_000

  /** Basic sanity check on remote Fabric JSON before applying it. */
  function isSafeFabricJson(json: unknown): json is object {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return false
    try {
      if (JSON.stringify(json).length > MAX_REMOTE_JSON_BYTES) return false
    } catch {
      return false   // circular / non-serializable — reject
    }
    return true
  }

  // Handlers are kept by reference so stopListening() can unregister the exact
  // functions that were registered — off() with a different reference is a no-op.
  const handlers: Record<string, (...args: unknown[]) => void> = {
    // Viewer requests full state on join
    'wb:request-full-state': () => {
      emitFullState()
    },

    // Remote canvas patch (co-host or replay)
    'wb:patch': (data: unknown) => {
      const { pageId, json } = data as { pageId: string; json: object }
      if (typeof pageId !== 'string' || !isSafeFabricJson(json)) return
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
    },

    // Remote page switch
    'wb:page-switch': (data: unknown) => {
      const { pageId } = data as { pageId: string }
      applyingRemote = true
      wbStore.switchPage(pageId)
      setTimeout(() => { applyingRemote = false }, 50)
    },

    // Remote page add
    'wb:page-add': (data: unknown) => {
      const { pageId, name } = data as { pageId: string; name: string }
      applyingRemote = true
      wbStore.addPageWithId(pageId, name)
      setTimeout(() => { applyingRemote = false }, 50)
    },

    // Remote page remove
    'wb:page-remove': (data: unknown) => {
      const { pageId } = data as { pageId: string }
      applyingRemote = true
      wbStore.removePage(pageId)
      setTimeout(() => { applyingRemote = false }, 50)
    },

    // Full state from another host (reconnect scenario)
    'wb:full-state': (data: unknown) => {
      const { pages, activePageId } = data as {
        pages: Array<{ pageId: string; name: string; json: object }>
        activePageId: string
      }
      if (!Array.isArray(pages) || typeof activePageId !== 'string') return
      applyingRemote = true
      pages.forEach(({ pageId, name, json }) => {
        if (typeof pageId !== 'string' || typeof name !== 'string') return
        wbStore.addPageWithId(pageId, name, isSafeFabricJson(json) ? json : undefined)
      })
      wbStore.switchPage(activePageId)
      setTimeout(() => { applyingRemote = false }, 50)
    },
  }

  let listening = false

  function startListening() {
    if (listening) return   // guard against double registration
    listening = true
    Object.entries(handlers).forEach(([event, fn]) => signalService.on(event, fn))
  }

  function stopListening() {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (!listening) return
    listening = false
    Object.entries(handlers).forEach(([event, fn]) => signalService.off(event, fn))
  }

  return { onLocalChange, startListening, stopListening }
}
