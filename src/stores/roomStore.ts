import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RoomInfo } from '@/types/room'

export const useRoomStore = defineStore('room', () => {
  const room = ref<RoomInfo>({
    id: '',
    name: '开发测试',
    hostId: '',
    viewerCount: 0,
    watchUrl: '',
    language: 'zh-CN',
    isPreviewLocked: false,
  })

  /** Cloud API base URL, e.g. https://xxx.xxx/api */
  const sassUrl = ref('')
  /** Bearer token obtained from the management portal (passed via URL param) */
  const token = ref('')
  /** Current user ID */
  const userId = ref('')

  /**
   * Read bootstrap params from the URL query string.
   * The H5 app is launched from the management portal which appends:
   *   ?sassUrl=...&token=...&userId=...&roomId=...&roomName=...
   *
   * In development mode, falls back to VITE_DEV_* env variables when URL
   * params are absent, so you don't have to manually append query strings
   * every time you reload the dev server.
   *
   * After reading, sensitive params (token) are removed from the URL to prevent
   * them from appearing in browser history or being leaked via the Referer header.
   */
  function initFromUrl() {
    const params = new URLSearchParams(window.location.search)
    const isDev  = import.meta.env.DEV

    // URL params take precedence; env vars are the dev fallback
    sassUrl.value = params.get('sassUrl') || (isDev ? (import.meta.env.VITE_DEV_SASS_URL ?? '') : '')
    token.value   = params.get('token')   || (isDev ? (import.meta.env.VITE_DEV_TOKEN   ?? '') : '')
    userId.value  = params.get('userId')  || (isDev ? (import.meta.env.VITE_DEV_USER_ID ?? '') : '')

    // Merge roomId and roomName in a single reactive update to avoid double rendering
    const roomPatch: Partial<RoomInfo> = {}
    const roomId   = params.get('roomId')   || (isDev ? (import.meta.env.VITE_DEV_ROOM_ID ?? '') : '')
    const roomName = params.get('roomName') || ''
    if (roomId)   roomPatch.id   = roomId
    if (roomName) roomPatch.name = roomName
    if (Object.keys(roomPatch).length) room.value = { ...room.value, ...roomPatch }

    // Remove sensitive params from the URL bar (no page reload)
    const clean = new URL(window.location.href)
    clean.searchParams.delete('token')
    history.replaceState(null, '', clean.toString())
  }

  function updateRoom(partial: Partial<RoomInfo>) {
    room.value = { ...room.value, ...partial }
  }

  function togglePreviewLock() {
    room.value.isPreviewLocked = !room.value.isPreviewLocked
  }

  return { room, sassUrl, token, userId, updateRoom, togglePreviewLock, initFromUrl }
})
