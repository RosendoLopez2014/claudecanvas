import { useEffect, useCallback } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTabsStore } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { destroyTerminal } from '@/services/terminalPool'

interface ShortcutHandlers {
  onQuickActions: () => void
  onShortcutSheet?: () => void
  onSettings?: () => void
  onSearch?: () => void
}

export function useKeyboardShortcuts({ onQuickActions, onShortcutSheet, onSettings, onSearch }: ShortcutHandlers) {
  const { inspectorActive, setInspectorActive, setActiveTab } = useCanvasStore()
  const { mode, openCanvas, closeCanvas } = useWorkspaceStore()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+1-9 — Switch to tab by index
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const tabs = useTabsStore.getState().tabs
        const idx = parseInt(e.key) - 1
        if (idx < tabs.length) {
          useTabsStore.getState().setActiveTab(tabs[idx].id)
        }
        return
      }

      // Cmd+W — Close active tab (with full resource cleanup)
      if (meta && e.key === 'w') {
        e.preventDefault()
        const { activeTabId } = useTabsStore.getState()
        if (!activeTabId) return
        destroyTerminal(activeTabId)
        useTabsStore.getState().closeTabAsync(activeTabId)
        return
      }

      // Cmd+T — New tab (go to project picker)
      if (meta && e.key === 't') {
        e.preventDefault()
        useProjectStore.getState().setScreen('project-picker')
        return
      }

      // Cmd+Shift+] — Next tab
      if (meta && e.shiftKey && e.key === ']') {
        e.preventDefault()
        const { tabs, activeTabId, setActiveTab: switchTab } = useTabsStore.getState()
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        if (idx < tabs.length - 1) switchTab(tabs[idx + 1].id)
        return
      }

      // Cmd+Shift+[ — Previous tab
      if (meta && e.shiftKey && e.key === '[') {
        e.preventDefault()
        const { tabs, activeTabId, setActiveTab: switchTab } = useTabsStore.getState()
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        if (idx > 0) switchTab(tabs[idx - 1].id)
        return
      }

      // Cmd+K — Quick actions
      if (meta && e.key === 'k') {
        e.preventDefault()
        onQuickActions()
        return
      }

      // Cmd+I — Toggle inspector
      if (meta && e.key === 'i' && !e.shiftKey) {
        e.preventDefault()
        setInspectorActive(!inspectorActive)
        return
      }

      // Cmd+G — Gallery tab
      if (meta && e.key === 'g') {
        e.preventDefault()
        if (mode !== 'terminal-canvas') openCanvas()
        setActiveTab('gallery')
        return
      }

      // Cmd+Shift+F — Project search
      if (meta && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        onSearch?.()
        return
      }

      // Cmd+? (Cmd+Shift+/) — Shortcut cheat sheet
      if (meta && e.shiftKey && e.key === '/') {
        e.preventDefault()
        onShortcutSheet?.()
        return
      }

      // Cmd+B — Toggle file explorer
      if (meta && e.key === 'b') {
        e.preventDefault()
        useWorkspaceStore.getState().toggleFileExplorer()
        return
      }

      // Cmd+, — Settings
      if (meta && e.key === ',') {
        e.preventDefault()
        onSettings?.()
        return
      }

      // Cmd+\ — Toggle canvas
      if (meta && e.key === '\\') {
        e.preventDefault()
        mode === 'terminal-canvas' ? closeCanvas() : openCanvas()
        return
      }

      // Escape — Close overlays / deactivate inspector
      if (e.key === 'Escape') {
        if (inspectorActive) {
          setInspectorActive(false)
        }
        return
      }
    },
    [
      inspectorActive,
      setInspectorActive,
      mode,
      openCanvas,
      closeCanvas,
      setActiveTab,
      onQuickActions,
      onShortcutSheet,
      onSettings,
      onSearch
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
