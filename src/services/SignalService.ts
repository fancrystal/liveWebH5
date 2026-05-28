import { io, type Socket } from 'socket.io-client'

export type SignalHandler = (...args: unknown[]) => void

/**
 * Singleton-style wrapper around socket.io for signaling.
 * Used by App.vue (connect) and useCoStream (WebRTC signal relay).
 */
export class SignalService {
  private socket: Socket | null = null
  private handlers: Map<string, SignalHandler[]> = new Map()

  connect(serverUrl: string, query: Record<string, string>) {
    if (this.socket?.connected) return

    this.socket = io(serverUrl, {
      query,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    })

    // Re-bind any handlers registered before connection
    this.handlers.forEach((fns, event) => {
      fns.forEach(fn => this.socket!.on(event, fn as never))
    })
  }

  on(event: string, handler: SignalHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
    this.socket?.on(event, handler as never)
  }

  off(event: string, handler: SignalHandler) {
    const fns = this.handlers.get(event)
    if (fns) this.handlers.set(event, fns.filter(f => f !== handler))
    this.socket?.off(event, handler as never)
  }

  emit(event: string, data?: unknown) {
    this.socket?.emit(event, data)
  }

  disconnect() {
    this.socket?.disconnect()
    this.socket = null
    this.handlers.clear()
  }

  get isConnected() {
    return this.socket?.connected ?? false
  }
}

export const signalService = new SignalService()
