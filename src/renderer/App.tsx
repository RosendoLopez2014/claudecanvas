import { TitleBar } from './components/TitleBar/TitleBar'
import { Workspace } from './components/Workspace/Workspace'
import { StatusBar } from './components/StatusBar/StatusBar'
import { useProjectStore } from './stores/project'

export default function App() {
  const { screen } = useProjectStore()

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
      <TitleBar />
      <div className="flex-1 overflow-hidden">
        {screen === 'onboarding' && (
          <div className="h-full flex items-center justify-center text-white/40">
            Onboarding wizard (Task 11)
          </div>
        )}
        {screen === 'project-picker' && (
          <div className="h-full flex items-center justify-center text-white/40">
            Project picker (Task 12)
          </div>
        )}
        {screen === 'workspace' && <Workspace />}
      </div>
      {screen === 'workspace' && <StatusBar />}
    </div>
  )
}
