import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = 'info') => {
    const id = `toast-${Date.now()}`
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
