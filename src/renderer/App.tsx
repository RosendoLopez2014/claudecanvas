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
import { useEffect, useState, useCallback } from 'react'

export default function App() {
  const { screen, setScreen, currentProject } = useProjectStore()
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)

  const toggleQuickActions = useCallback(() => {
    setQuickActionsOpen((prev) => !prev)
  }, [])

  useKeyboardShortcuts({ onQuickActions: toggleQuickActions })
  useMcpCommands()
  useMcpStateExposer()

  // Start/stop MCP server when entering/leaving workspace
  useEffect(() => {
    if (screen === 'workspace' && currentProject?.path) {
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

      return () => {
        window.api.mcp.projectClosed()
        useProjectStore.getState().setMcpReady(false)
      }
    }
  }, [screen, currentProject?.path])

  useEffect(() => {
    window.api.settings.get('onboardingComplete').then(async (complete) => {
      if (complete) {
        // Restore saved tabs
        const savedTabs = await window.api.settings.get('tabs')
        if (Array.isArray(savedTabs) && savedTabs.length > 0) {
          for (const t of savedTabs) {
            if (t.project?.name && t.project?.path) {
              const tabId = useTabsStore.getState().addTab(t.project)
              if (t.worktreeBranch || t.worktreePath) {
                useTabsStore.getState().updateTab(tabId, {
                  worktreeBranch: t.worktreeBranch || null,
                  worktreePath: t.worktreePath || null,
                })
              }
            }
          }
          // Set the first tab's project as current and go to workspace
          const firstTab = useTabsStore.getState().tabs[0]
          if (firstTab) {
            useProjectStore.getState().setCurrentProject(firstTab.project)
            setScreen('workspace')
            return
          }
        }
        setScreen('project-picker')
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
      <ToastContainer />
    </div>
  )
}
