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

  function updateRoom(partial: Partial<RoomInfo>) {
    room.value = { ...room.value, ...partial }
  }

  function togglePreviewLock() {
    room.value.isPreviewLocked = !room.value.isPreviewLocked
  }

  return { room, updateRoom, togglePreviewLock }
})
