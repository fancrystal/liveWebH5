import { io, type Socket } from 'socket.io-client'

export type SignalHandler = (...args: unknown[]) => void

import { VERBOSE_LOG } from '@/config/env'
/** Prefixed console logger; only emits when VERBOSE_LOG is on. */
function log(...args: unknown[]): void {
  if (VERBOSE_LOG) console.log('[SignalService]', ...args)
}

/**
 * Singleton-style wrapper around socket.io for signaling.
 * Used by App.vue (connect) and useCoStream (WebRTC signal relay).
 */
export class SignalService {
  private socket: Socket | null = null
  private handlers: Map<string, SignalHandler[]> = new Map()

  connect(serverUrl: string, query: Record<string, string>) {
    // Signaling disabled: no backend configured. Bail out so we never open a
    // doomed wss connection (which would otherwise spam the console).
    if (!serverUrl?.trim()) {
      log('connect 跳过：未配置信令地址')
      return
    }
    if (this.socket?.connected) {
      log('connect 跳过：已连接')
      return
    }

    log('发起连接 →', serverUrl, '| query =', JSON.stringify(query))
    this.socket = io(serverUrl, {
      query,
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    })

    // Lifecycle diagnostics — invaluable when debugging signaling in the test env.
    this.socket.on('connect', () => log('✅ 已连接 | socket.id =', this.socket?.id))
    this.socket.on('connect_error', (err) => log('❌ 连接失败 |', err?.message ?? err))
    this.socket.on('disconnect', (reason) => log('⚠️ 已断开 | reason =', reason))
    this.socket.io.on('reconnect_attempt', (n) => log('🔄 重连尝试 #', n))

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
