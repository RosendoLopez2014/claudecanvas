import { TitleBar } from './components/TitleBar/TitleBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OnboardingWizard } from './components/Onboarding/Wizard'
import { ProjectPicker } from './components/Onboarding/ProjectPicker'
import { useProjectStore } from './stores/project'
import { useEffect } from 'react'

export default function App() {
  const { screen, setScreen } = useProjectStore()

  useEffect(() => {
    // Check if onboarding is complete on mount
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
    </div>
  )
}
