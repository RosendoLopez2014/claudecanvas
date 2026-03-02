import { create } from 'zustand'

export interface TerminalSplit {
  id: string
  ptyId?: string
}

export interface TerminalInstance {
  id: string
  label: string
}

interface TerminalStore {
  focusFn: (() => void) | null
  /** Per-tab split tracking: tabId → list of split terminal IDs */
  splits: Record<string, TerminalSplit[]>
  /** Per-tab terminal instances: tabId → list of terminal instances */
  instances: Record<string, TerminalInstance[]>
  /** Per-tab active terminal instance: tabId → active instance ID */
  activeInstance: Record<string, string>
  setFocusFn: (fn: (() => void) | null) => void
  focus: () => void
  addSplit: (tabId: string) => void
  removeSplit: (tabId: string, splitId: string) => void
  getSplits: (tabId: string) => TerminalSplit[]
  addInstance: (tabId: string) => string
  removeInstance: (tabId: string, instanceId: string) => void
  setActiveInstance: (tabId: string, instanceId: string) => void
  getInstances: (tabId: string) => TerminalInstance[]
  getActiveInstance: (tabId: string) => string
  ensureDefaultInstance: (tabId: string) => string
}

let splitCounter = 0
let instanceCounter = 0

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  focusFn: null,
  splits: {},
  instances: {},
  activeInstance: {},
  setFocusFn: (focusFn) => set({ focusFn }),
  focus: () => { get().focusFn?.() },
  addSplit: (tabId) => set((s) => {
    const existing = s.splits[tabId] || []
    const id = `split-${++splitCounter}`
    return { splits: { ...s.splits, [tabId]: [...existing, { id }] } }
  }),
  removeSplit: (tabId, splitId) => set((s) => {
    const existing = s.splits[tabId] || []
    return { splits: { ...s.splits, [tabId]: existing.filter((sp) => sp.id !== splitId) } }
  }),
  getSplits: (tabId) => get().splits[tabId] || [],

  ensureDefaultInstance: (tabId) => {
    const existing = get().instances[tabId]
    if (existing && existing.length > 0) {
      return get().activeInstance[tabId] || existing[0].id
    }
    const id = `term-${++instanceCounter}`
    set((s) => ({
      instances: { ...s.instances, [tabId]: [{ id, label: 'Terminal 1' }] },
      activeInstance: { ...s.activeInstance, [tabId]: id }
    }))
    return id
  },

  addInstance: (tabId) => {
    const existing = get().instances[tabId] || []
    const num = existing.length + 1
    const id = `term-${++instanceCounter}`
    set((s) => ({
      instances: { ...s.instances, [tabId]: [...existing, { id, label: `Terminal ${num}` }] },
      activeInstance: { ...s.activeInstance, [tabId]: id }
    }))
    return id
  },

  removeInstance: (tabId, instanceId) => set((s) => {
    const existing = s.instances[tabId] || []
    if (existing.length <= 1) return s // Keep at least one
    const filtered = existing.filter((inst) => inst.id !== instanceId)
    const active = s.activeInstance[tabId] === instanceId ? filtered[0]?.id || '' : s.activeInstance[tabId]
    return {
      instances: { ...s.instances, [tabId]: filtered },
      activeInstance: { ...s.activeInstance, [tabId]: active }
    }
  }),

  setActiveInstance: (tabId, instanceId) => set((s) => ({
    activeInstance: { ...s.activeInstance, [tabId]: instanceId }
  })),

  getInstances: (tabId) => get().instances[tabId] || [],
  getActiveInstance: (tabId) => get().activeInstance[tabId] || '',
}))
