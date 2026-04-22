import { ref } from 'vue'

export type ToastType = 'info' | 'success' | 'warn' | 'error'

export interface Toast {
  id: string
  type: ToastType
  message: string
}

const toasts = ref<Toast[]>([])

function show(type: ToastType, message: string, duration = 4000) {
  const id = `toast-${Date.now()}-${Math.random()}`
  toasts.value.push({ id, type, message })
  setTimeout(() => dismiss(id), duration)
}

function dismiss(id: string) {
  toasts.value = toasts.value.filter(t => t.id !== id)
}

/** Singleton composable — shares state across all callers */
export function useToast() {
  return {
    toasts,
    info:    (msg: string, ms?: number) => show('info',    msg, ms),
    success: (msg: string, ms?: number) => show('success', msg, ms),
    warn:    (msg: string, ms?: number) => show('warn',    msg, ms),
    error:   (msg: string, ms?: number) => show('error',   msg, ms),
    dismiss,
  }
}
