import { TitleBar } from './components/TitleBar/TitleBar'
import { TabBar } from './components/TabBar/TabBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OnboardingWizard } from './components/Onboarding/Wizard'
import { ProjectPicker } from './components/Onboarding/ProjectPicker'
import { QuickActions } from './components/QuickActions/QuickActions'
import { ToastContainer } from './components/Toast/Toast'
import { useProjectStore } from './stores/project'
import { useTabsStore, restoreTabs } from './stores/tabs'
import { useToastStore } from './stores/toast'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMcpCommands } from './hooks/useMcpCommands'
import { useMcpStateExposer } from './hooks/useMcpStateExposer'
import { useGitSync } from './hooks/useGitSync'
import { useAutoGallery } from './hooks/useAutoGallery'
import { useAutoCheckpoint } from './hooks/useAutoCheckpoint'
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
  useAutoGallery()
  useAutoCheckpoint()

  // Start MCP server once when entering workspace. The server stays alive
  // across tab switches — each MCP tool event carries projectPath so the
  // renderer can route commands to the correct tab. We only tear down when
  // leaving the workspace entirely (all tabs closed).
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
          useTabsStore.getState().updateTab(activeTab.id, { mcpReady: true, mcpPort: port })
        }
      })
    }

    if (screen !== 'workspace' && mcpStartedRef.current) {
      mcpStartedRef.current = false
      window.api.mcp.projectClosed()
      useProjectStore.getState().setMcpReady(false)
    }
  }, [screen, currentProject?.path])

  useEffect(() => {
    window.api.settings.get('onboardingComplete').then(async (complete) => {
      if (complete) {
        // Restore previously open tabs, then skip to workspace if any exist
        await restoreTabs()
        const restoredTabs = useTabsStore.getState().tabs
        if (restoredTabs.length > 0) {
          // Set current project to the active tab's project
          const activeTab = useTabsStore.getState().getActiveTab()
          if (activeTab) {
            useProjectStore.getState().setCurrentProject(activeTab.project)
          }
          setScreen('workspace')
        } else {
          setScreen('project-picker')
        }
      }
    })
  }, [setScreen])

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      {screen === 'workspace' && <TabBar />}
      <div className="flex-1 overflow-hidden">
        {screen === 'onboarding' && <OnboardingWizard />}
        {screen === 'project-picker' && <ProjectPicker />}
        {screen === 'workspace' && <Workspace />}
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
