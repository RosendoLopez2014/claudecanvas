import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (
    message: string,
    type?: 'info' | 'success' | 'error',
    opts?: { action?: { label: string; onClick: () => void }; duration?: number }
  ) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = 'info', opts) => {
    const id = `toast-${Date.now()}`
    const duration = opts?.duration ?? 4000
    set((s) => ({ toasts: [...s.toasts, { id, message, type, action: opts?.action, duration }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
