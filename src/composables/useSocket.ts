import { ref, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'
import { useChatStore } from '@/stores/chatStore'
import { useStreamStore } from '@/stores/streamStore'

/**
 * Manages the socket.io connection to the signaling server.
 * Handles: chat messages, room events, WebRTC signaling for co-streaming.
 */
export function useSocket() {
  const socket = ref<Socket | null>(null)
  const isConnected = ref(false)
  const chatStore = useChatStore()
  const streamStore = useStreamStore()

  const SERVER_URL = import.meta.env.VITE_SIGNAL_URL ?? 'http://localhost:3000'

  function connect(roomId: string, userId: string) {
    if (socket.value?.connected) return

    const s = io(SERVER_URL, {
      query: { roomId, userId, role: 'host' },
      transports: ['websocket'],
    })
    socket.value = s

    s.on('connect', () => { isConnected.value = true })
    s.on('disconnect', () => { isConnected.value = false })

    // Room events
    s.on('room-info', ({ viewerCount }: { viewerCount: number }) => {
      streamStore.setViewerCount(viewerCount)
    })

    // Chat events
    s.on('chat-message', (msg) => {
      chatStore.addMessage(msg)
    })
  }

  function disconnect() {
    socket.value?.disconnect()
    socket.value = null
    isConnected.value = false
  }

  function emit(event: string, data?: unknown) {
    socket.value?.emit(event, data)
  }

  function on(event: string, handler: (...args: unknown[]) => void) {
    socket.value?.on(event, handler)
  }

  onUnmounted(disconnect)

  return { socket, isConnected, connect, disconnect, emit, on }
}
