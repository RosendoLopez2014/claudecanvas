import { TitleBar } from './components/TitleBar/TitleBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OnboardingWizard } from './components/Onboarding/Wizard'
import { ProjectPicker } from './components/Onboarding/ProjectPicker'
import { QuickActions } from './components/QuickActions/QuickActions'
import { useProjectStore } from './stores/project'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useEffect, useState, useCallback } from 'react'

export default function App() {
  const { screen, setScreen } = useProjectStore()
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)

  const toggleQuickActions = useCallback(() => {
    setQuickActionsOpen((prev) => !prev)
  }, [])

  useKeyboardShortcuts({ onQuickActions: toggleQuickActions })

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
    </div>
  )
}
