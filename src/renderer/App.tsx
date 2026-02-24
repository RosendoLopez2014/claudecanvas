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
import { useDevServerSync } from './hooks/useDevServerSync'
import { ShortcutSheet } from './components/ShortcutSheet/ShortcutSheet'
import { SettingsPanel } from './components/Settings/Settings'
import { SearchPanel } from './components/Search/SearchPanel'
import { useEffect, useState, useCallback, useRef } from 'react'

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
  const tabCount = useTabsStore((s) => s.tabs.length)
  useEffect(() => {
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
  useDevServerSync()

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

  // Start MCP server once when entering workspace. The server stays alive
  // across tab switches — each MCP tool event carries projectPath so the
  // renderer can route commands to the correct tab. We only tear down when
  // all tabs are closed (not when navigating to project-picker to add another
  // project, since PTYs and Claude sessions are still alive in the background).
  const mcpStartedRef = useRef(false)
  useEffect(() => {
    if (screen === 'workspace' && currentProject?.path && !mcpStartedRef.current) {
      mcpStartedRef.current = true
      const { addToast } = useToastStore.getState()
      addToast('Initializing Claude Canvas...', 'info')

      window.api.mcp.projectOpened(currentProject.path).then(({ port }) => {
        addToast(`MCP bridge active on port ${port}`, 'success')
        useProjectStore.getState().setMcpReady(true, port)
        const activeTab = useTabsStore.getState().getActiveTab()
        if (activeTab) {
          useTabsStore.getState().updateTab(activeTab.id, {
            mcpReady: true,
            mcpPort: port,
            boot: { ...activeTab.boot, mcpReady: true }
          })
        }
      })
    }

    // Only tear down when there are no tabs left (true workspace exit),
    // not when temporarily visiting the project picker to add another project.
    if (tabCount === 0 && mcpStartedRef.current) {
      mcpStartedRef.current = false
      window.api.mcp.projectClosed()
      useProjectStore.getState().setMcpReady(false)
    }
  }, [screen, currentProject?.path, tabCount])

  useEffect(() => {
    window.api.settings.get('onboardingComplete').then(async (complete) => {
      if (complete) {
        setScreen('project-picker')
      }
    })
  }, [setScreen])

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
