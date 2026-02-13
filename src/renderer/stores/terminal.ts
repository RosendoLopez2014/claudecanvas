import { create } from 'zustand'

interface TerminalStore {
  ptyId: string | null
  isRunning: boolean
  setPtyId: (id: string | null) => void
  setIsRunning: (running: boolean) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  ptyId: null,
  isRunning: false,
  setPtyId: (ptyId) => set({ ptyId }),
  setIsRunning: (isRunning) => set({ isRunning })
}))
