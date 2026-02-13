import { useState, useCallback } from 'react'
import { useProjectStore } from '@/stores/project'
import { motion, AnimatePresence } from 'framer-motion'
import { Folder, Github, ArrowRight, Check } from 'lucide-react'

type Step = 'welcome' | 'directory' | 'services' | 'done'

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>('welcome')
  const [projectsDir, setProjectsDir] = useState('')
  const { setScreen } = useProjectStore()

  const selectDirectory = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setProjectsDir(dir)
  }, [])

  const finish = useCallback(async () => {
    if (projectsDir) {
      await window.api.settings.set('projectsDir', projectsDir)
    }
    await window.api.settings.set('onboardingComplete', true)
    setScreen('project-picker')
  }, [projectsDir, setScreen])

  return (
    <div className="h-full flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="w-[480px]"
        >
          {step === 'welcome' && (
            <div className="text-center space-y-6">
              <div className="text-4xl font-bold bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-coral)] bg-clip-text text-transparent">
                Claude Canvas
              </div>
              <p className="text-white/60 text-sm leading-relaxed">
                A terminal-first development environment with adaptive visual rendering.
                Build with Claude Code and see your work come alive.
              </p>
              <button
                onClick={() => setStep('directory')}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition"
              >
                Get Started <ArrowRight size={16} />
              </button>
            </div>
          )}

          {step === 'directory' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Where do you keep your projects?</h2>
                <p className="text-white/50 text-sm mt-1">Choose the directory where new projects will be created.</p>
              </div>
              <button
                onClick={selectDirectory}
                className="w-full flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-white/20 transition bg-[var(--bg-tertiary)]"
              >
                <Folder size={20} className="text-[var(--accent-cyan)]" />
                <span className="text-sm text-white/70">
                  {projectsDir || 'Select a directory...'}
                </span>
              </button>
              <div className="flex justify-between">
                <button
                  onClick={() => setStep('welcome')}
                  className="text-sm text-white/40 hover:text-white/60"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep('services')}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm"
                >
                  Next <ArrowRight size={14} />
                </button>
              </div>
            </div>
          )}

          {step === 'services' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-white">Connect services</h2>
                <p className="text-white/50 text-sm mt-1">Optional. You can connect these later in settings.</p>
              </div>
              <div className="space-y-3">
                {[
                  { name: 'GitHub', icon: Github, desc: 'Git hosting & collaboration' }
                ].map((service) => (
                  <button
                    key={service.name}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:border-white/20 transition bg-[var(--bg-tertiary)]"
                  >
                    <service.icon size={18} className="text-white/60" />
                    <div className="text-left">
                      <div className="text-sm text-white/80">{service.name}</div>
                      <div className="text-xs text-white/40">{service.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex justify-between">
                <button
                  onClick={() => setStep('directory')}
                  className="text-sm text-white/40 hover:text-white/60"
                >
                  Back
                </button>
                <button
                  onClick={finish}
                  className="inline-flex items-center gap-2 px-5 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm"
                >
                  <Check size={14} /> Finish Setup
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
