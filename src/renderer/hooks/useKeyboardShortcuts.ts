import { useEffect, useCallback } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTabsStore } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { useGalleryStore } from '@/stores/gallery'
import { destroyTerminalsForTab } from '@/services/terminalPool'

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
        destroyTerminalsForTab(activeTabId)
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

      // Cmd+Shift+S — Toggle split view (active project's branches)
      if (meta && e.shiftKey && e.key === 's') {
        e.preventDefault()
        const ws = useWorkspaceStore.getState()
        if (ws.splitViewActive) {
          ws.exitSplitView()
        } else {
          const { tabs, activeTabId: aid } = useTabsStore.getState()
          const activeTab = tabs.find((t) => t.id === aid)
          if (activeTab) {
            const projectBranches = tabs.filter((t) => t.project.name === activeTab.project.name)
            if (projectBranches.length >= 2) {
              ws.enterSplitView('project')
            }
          }
        }
        return
      }

      // Cmd+D — Split terminal horizontally
      if (meta && e.key === 'd' && !e.shiftKey) {
        e.preventDefault()
        const { activeTabId } = useTabsStore.getState()
        if (activeTabId) {
          useTabsStore.getState().addSplit(activeTabId)
        }
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

      // ── Gallery keyboard shortcuts (only when gallery tab is active) ──
      const canvasActiveTab = useCanvasStore.getState().activeTab
      const galleryActive = mode === 'terminal-canvas' && canvasActiveTab === 'gallery'

      if (galleryActive && !meta && !e.shiftKey) {
        const gallery = useGalleryStore.getState()
        const displayVariants = gallery.activeSessionId
          ? gallery.variants.filter((v) => v.sessionId === gallery.activeSessionId)
          : gallery.variants
        const currentIdx = displayVariants.findIndex((v) => v.id === gallery.selectedId)

        // ArrowLeft / ArrowRight — Navigate between variants
        if (e.key === 'ArrowLeft' && displayVariants.length > 0) {
          e.preventDefault()
          const nextIdx = currentIdx > 0 ? currentIdx - 1 : displayVariants.length - 1
          gallery.setSelectedId(displayVariants[nextIdx].id)
          return
        }
        if (e.key === 'ArrowRight' && displayVariants.length > 0) {
          e.preventDefault()
          const nextIdx = currentIdx < displayVariants.length - 1 ? currentIdx + 1 : 0
          gallery.setSelectedId(displayVariants[nextIdx].id)
          return
        }

        // Enter — Select the focused variant (in session mode)
        if (e.key === 'Enter' && gallery.selectedId && gallery.viewMode === 'session') {
          e.preventDefault()
          gallery.selectVariant(gallery.selectedId)
          return
        }

        // C — Toggle compare mode with focused + selected
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault()
          if (gallery.viewMode === 'compare') {
            gallery.setViewMode('grid')
            gallery.setCompareIds(null)
          } else if (gallery.selectedId && displayVariants.length >= 2) {
            const other = displayVariants.find((v) => v.id !== gallery.selectedId)
            if (other) {
              gallery.setCompareIds([gallery.selectedId, other.id])
              gallery.setViewMode('compare')
            }
          }
          return
        }

        // 1-3 — Quick-select variant by position
        if (e.key >= '1' && e.key <= '3') {
          const idx = parseInt(e.key) - 1
          if (idx < displayVariants.length) {
            e.preventDefault()
            gallery.setSelectedId(displayVariants[idx].id)
          }
          return
        }
      }

      // Escape — Exit split view / close overlays / deactivate inspector
      if (e.key === 'Escape') {
        if (useWorkspaceStore.getState().splitViewActive) {
          useWorkspaceStore.getState().exitSplitView()
          return
        }
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
