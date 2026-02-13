import { TitleBar } from './components/TitleBar/TitleBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OnboardingWizard } from './components/Onboarding/Wizard'
import { ProjectPicker } from './components/Onboarding/ProjectPicker'
import { QuickActions } from './components/QuickActions/QuickActions'
import { ToastContainer } from './components/Toast/Toast'
import { useProjectStore } from './stores/project'
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
        setTimeout(() => {
          addToast('Claude Code launching — canvas tools ready', 'success')
        }, 1200)
      })

      return () => {
        window.api.mcp.projectClosed()
      }
    }
  }, [screen, currentProject?.path])

  useEffect(() => {
    window.api.settings.get('onboardingComplete').then((complete) => {
      if (complete) {
        setScreen('project-picker')
      }
    })
  }, [setScreen])

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
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
