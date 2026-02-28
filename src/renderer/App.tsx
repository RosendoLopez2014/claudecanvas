import { TitleBar } from './components/TitleBar/TitleBar'
import { TabBar } from './components/TabBar/TabBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OnboardingWizard } from './components/Onboarding/Wizard'
import { ProjectPicker } from './components/Onboarding/ProjectPicker'
import { QuickActions } from './components/QuickActions/QuickActions'
import { ToastContainer } from './components/Toast/Toast'
import { useProjectStore } from './stores/project'
import { useTabsStore } from './stores/tabs'
import { useToastStore } from './stores/toast'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMcpCommands } from './hooks/useMcpCommands'
import { useMcpStateExposer } from './hooks/useMcpStateExposer'
import { useGitSync } from './hooks/useGitSync'
import { useGalleryStore } from './stores/gallery'
import { useAutoCheckpoint } from './hooks/useAutoCheckpoint'
import { useAutoGallery } from './hooks/useAutoGallery'
import { useDevSelfHeal } from './hooks/useDevSelfHeal'
import { useDevRepairListener } from './hooks/useDevRepairListener'
import { ShortcutSheet } from './components/ShortcutSheet/ShortcutSheet'
import { SettingsPanel } from './components/Settings/Settings'
import { SearchPanel } from './components/Search/SearchPanel'
import { useEffect, useState, useCallback, useRef } from 'react'
import { restoreTabs } from './stores/tabs'

export default function App() {
  const { screen, setScreen, currentProject } = useProjectStore()
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Once workspace has been shown, keep it mounted (hidden) to preserve PTY sessions.
  // Without this, navigating to project-picker unmounts Workspace, killing all PTYs.
  const [workspaceMounted, setWorkspaceMounted] = useState(false)
  useEffect(() => {
    if (screen === 'workspace') setWorkspaceMounted(true)
  }, [screen])

  // Navigate to project picker when all tabs are closed (last tab closed).
  // Skip during tab restoration to prevent racing with async restoreTabs().
  const tabCount = useTabsStore((s) => s.tabs.length)
  const restoringTabsRef = useRef(false)
  useEffect(() => {
    if (restoringTabsRef.current) return
    if (workspaceMounted && tabCount === 0 && screen === 'workspace') {
      setScreen('project-picker')
    }
  }, [tabCount, workspaceMounted, screen, setScreen])

  const toggleQuickActions = useCallback(() => {
    setQuickActionsOpen((prev) => !prev)
  }, [])
  const toggleShortcutSheet = useCallback(() => {
    setShortcutSheetOpen((prev) => !prev)
  }, [])
  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => !prev)
  }, [])
  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => !prev)
  }, [])

  useKeyboardShortcuts({ onQuickActions: toggleQuickActions, onShortcutSheet: toggleShortcutSheet, onSettings: toggleSettings, onSearch: toggleSearch })

  // Listen for StatusBar settings button
  useEffect(() => {
    const handler = () => setSettingsOpen(true)
    window.addEventListener('open-settings', handler)
    return () => window.removeEventListener('open-settings', handler)
  }, [])

  useMcpCommands()
  useMcpStateExposer()
  useGitSync()
  useAutoCheckpoint()
  useAutoGallery()
  useDevSelfHeal()
  useDevRepairListener()
  // Sync currentProject and gallery with active tab on tab switch/close
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const prevProjectPathRef = useRef<string | null>(null)
  useEffect(() => {
    const activeTab = useTabsStore.getState().getActiveTab()
    if (!activeTab) return

    // Skip cascading effects if the project hasn't actually changed
    const path = activeTab.project.path
    if (path === prevProjectPathRef.current) return
    prevProjectPathRef.current = path

    useProjectStore.getState().setCurrentProject(activeTab.project)
    useGalleryStore.getState().loadForProject(path)
  }, [activeTabId])

  // MCP lifecycle is per-tab (useTabMcpInit in Workspace).
  // This effect only handles complete teardown when all tabs close.
  useEffect(() => {
    if (tabCount === 0) {
      window.api.mcp.shutdownAll()
      if (currentProject?.path) {
        window.api.component.previewCleanup(currentProject.path).catch(() => {})
      }
    }
  }, [tabCount, currentProject?.path])

  useEffect(() => {
    window.api.settings.get('onboardingComplete').then(async (complete) => {
      if (complete) {
        // Try to restore previous session before deciding which screen to show.
        // This handles renderer reload during sleep, GPU crash, HMR reconnect, etc.
        restoringTabsRef.current = true
        await restoreTabs()
        restoringTabsRef.current = false
        const { tabs } = useTabsStore.getState()
        if (tabs.length > 0) {
          setScreen('workspace')
        } else {
          setScreen('project-picker')
        }
      }
    })
  }, [setScreen])

  // Handle system resume — restore tabs if state was lost during sleep,
  // and trigger a resize to force xterm WebGL context recovery.
  useEffect(() => {
    const removeResume = window.api.system.onResume(() => {
      const { tabs } = useTabsStore.getState()
      if (tabs.length === 0) {
        // Set flag synchronously BEFORE the async call to prevent the
        // `tabCount === 0 → project-picker` guard from racing us.
        restoringTabsRef.current = true
        restoreTabs().then(() => {
          restoringTabsRef.current = false
          const restored = useTabsStore.getState().tabs
          if (restored.length > 0) {
            setScreen('workspace')
          }
        }).catch(() => {
          restoringTabsRef.current = false
        })
      } else if (screen !== 'workspace') {
        setScreen('workspace')
      }

      // Force layout recalculation after wake — triggers xterm refit
      // which recreates lost WebGL contexts and unfreezes the terminal.
      // Staggered: first refit at 500ms, second at 1500ms for any tabs
      // whose WebGL context took longer to recover.
      setTimeout(() => window.dispatchEvent(new Event('resize')), 500)
      setTimeout(() => window.dispatchEvent(new Event('resize')), 1500)
    })
    return () => removeResume()
  }, [screen, setScreen])

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      {screen === 'workspace' && <TabBar />}
      <div className="flex-1 overflow-hidden relative">
        {screen === 'onboarding' && <OnboardingWizard />}
        {/* Workspace in normal flow so flex layout works (TabBar/StatusBar get their space).
            Renders on first workspace entry, then stays mounted to preserve PTY sessions.
            Uses visibility:hidden (not display:none) so xterm.js/WebGL can measure layout. */}
        {(screen === 'workspace' || workspaceMounted) && (
          <div
            className="h-full"
            style={{
              visibility: screen === 'workspace' ? 'visible' : 'hidden',
            }}
          >
            <Workspace />
          </div>
        )}
        {/* Project picker overlays workspace when navigating back to add another project.
            Workspace stays mounted underneath so PTYs survive the round-trip. */}
        {screen === 'project-picker' && (
          <div className={workspaceMounted ? 'absolute inset-0 z-10 bg-[var(--bg-primary)]' : 'h-full'}>
            <ProjectPicker />
          </div>
        )}
      </div>
      {screen === 'workspace' && <StatusBar />}
      <QuickActions open={quickActionsOpen} onClose={() => setQuickActionsOpen(false)} />
      <ShortcutSheet open={shortcutSheetOpen} onClose={() => setShortcutSheetOpen(false)} />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ToastContainer />
    </div>
  )
}
