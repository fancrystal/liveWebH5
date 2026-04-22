import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChatMessage, ChatFilter } from '@/types/chat'

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const pinnedMessage = ref<ChatMessage | null>(null)
  const filter = ref<ChatFilter>('all')
  const unreadCount = ref(0)

  const filteredMessages = computed(() => {
    if (filter.value === 'private') return messages.value.filter(m => m.isPrivate)
    return messages.value
  })

  function addMessage(msg: ChatMessage) {
    messages.value.push(msg)
    unreadCount.value++
  }

  function pinMessage(id: string) {
    const msg = messages.value.find(m => m.id === id)
    if (msg) pinnedMessage.value = { ...msg, isPinned: true }
  }

  function unpinMessage() {
    pinnedMessage.value = null
  }

  function deleteMessage(id: string) {
    messages.value = messages.value.filter(m => m.id !== id)
  }

  function setFilter(f: ChatFilter) {
    filter.value = f
  }

  function clearUnread() {
    unreadCount.value = 0
  }

  return {
    messages, pinnedMessage, filter, unreadCount, filteredMessages,
    addMessage, pinMessage, unpinMessage, deleteMessage, setFilter, clearUnread,
  }
})
