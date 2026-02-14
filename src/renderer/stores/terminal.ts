import { create } from 'zustand'

interface TerminalStore {
  /** @deprecated Use `useTabsStore.getActiveTab().ptyId` for per-tab state */
  ptyId: string | null
  isRunning: boolean
  focusFn: (() => void) | null
  /** @deprecated Use `useTabsStore.updateTab(id, { ptyId })` */
  setPtyId: (id: string | null) => void
  setIsRunning: (running: boolean) => void
  setFocusFn: (fn: (() => void) | null) => void
  focus: () => void
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  ptyId: null,
  isRunning: false,
  focusFn: null,
  setPtyId: (ptyId) => set({ ptyId }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setFocusFn: (focusFn) => set({ focusFn }),
  focus: () => { get().focusFn?.() }
}))
