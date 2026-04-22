import { onMounted } from 'vue'
import { useMediaStore } from '@/stores/mediaStore'

/**
 * Loads available media devices and listens for device changes.
 */
export function useMediaDevices() {
  const mediaStore = useMediaStore()

  async function refresh() {
    await mediaStore.loadDevices()
  }

  onMounted(async () => {
    await refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
  })

  return { refresh }
}
