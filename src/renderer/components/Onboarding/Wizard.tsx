import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/stores/project'
import { motion, AnimatePresence } from 'framer-motion'
import { Folder, Github, ArrowRight, Check, Loader2, Copy, X, Monitor, Terminal, GitBranch, Zap } from 'lucide-react'

type Step = 'welcome' | 'features' | 'directory' | 'services' | 'done'

interface DeviceCodeData {
  user_code: string
  device_code: string
  interval: number
  expires_in: number
}

/** Full-screen overlay showing the GitHub device code */
function GitHubCodeOverlay({
  code,
  onContinue,
  onCancel
}: {
  code: string
  onContinue: () => void
  onCancel: () => void
}) {
  const [copied, setCopied] = useState(false)

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      () => {
        const input = document.createElement('input')
        input.value = code
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
        setCopied(true)
      }
    )
  }, [code])

  useEffect(() => {
    navigator.clipboard.writeText(code).catch(() => {})
  }, [code])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.div
        className="relative bg-[var(--bg-secondary)] rounded-2xl p-10 w-[400px] text-center border border-white/10 shadow-2xl"
        initial={{ scale: 0.92, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 4 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X size={14} className="text-white/30" />
        </button>

        <Github size={36} className="mx-auto mb-5 text-white/50" />
        <h2 className="text-lg font-semibold text-white mb-1.5">Connect to GitHub</h2>
        <p className="text-sm text-white/40 mb-8 leading-relaxed">
          Copy this code, then enter it on GitHub to authorize Claude Canvas.
        </p>

        <div className="text-[10px] uppercase tracking-[2px] text-white/30 mb-3 font-medium">
          Your verification code
        </div>

        <button
          onClick={copyCode}
          className="group w-full flex items-center justify-center gap-3 font-mono text-[28px] font-bold tracking-[5px] text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/[0.06] border border-[var(--accent-cyan)]/20 rounded-xl py-5 px-6 hover:bg-[var(--accent-cyan)]/[0.12] hover:border-[var(--accent-cyan)]/30 transition-all cursor-pointer mb-2"
        >
          <span>{code}</span>
          {copied ? (
            <Check size={18} className="text-green-400 shrink-0" />
          ) : (
            <Copy size={18} className="text-[var(--accent-cyan)]/60 group-hover:text-[var(--accent-cyan)] shrink-0 transition-colors" />
          )}
        </button>

        <div className="text-xs h-5 mb-6">
          {copied ? (
            <span className="text-green-400">Copied to clipboard!</span>
          ) : (
            <span className="text-white/25">Click to copy</span>
          )}
        </div>

        <button
          onClick={() => {
            copyCode()
            onContinue()
          }}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#238636] hover:bg-[#2ea043] text-white font-semibold rounded-xl transition-colors text-sm"
        >
          Continue to GitHub <ArrowRight size={15} />
        </button>

        <p className="text-[11px] text-white/20 mt-4">Press Escape to cancel</p>
      </motion.div>
    </motion.div>
  )
}

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>('welcome')
  const [projectsDir, setProjectsDir] = useState('')
  const [githubConnecting, setGithubConnecting] = useState(false)
  const [githubConnected, setGithubConnected] = useState(false)
  const [codeData, setCodeData] = useState<DeviceCodeData | null>(null)
  const codeDataRef = useRef<DeviceCodeData | null>(null)
  const authAreaRef = useRef<HTMLDivElement>(null)
  const { setScreen } = useProjectStore()

  codeDataRef.current = codeData

  // Escape key closes code overlay
  useEffect(() => {
    if (!codeData) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCodeData(null)
        setGithubConnecting(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [codeData])

  const selectDirectory = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory()
    if (dir) setProjectsDir(dir)
  }, [])

  // Phase 1: Request device code
  const connectGithub = useCallback(async () => {
    if (githubConnecting || githubConnected) return
    setGithubConnecting(true)

    const result = await window.api.oauth.github.requestCode()

    if ('error' in result) {
      setGithubConnecting(false)
      return
    }

    setCodeData(result)
  }, [githubConnecting, githubConnected])

  // Phase 2: Open WebContentsView with GitHub verification page
  const handleContinueToGithub = useCallback(async () => {
    const data = codeDataRef.current
    if (!data) return

    setCodeData(null)

    const el = authAreaRef.current
    if (!el) {
      setGithubConnecting(false)
      return
    }

    const rect = el.getBoundingClientRect()
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }

    const result = (await window.api.oauth.github.start({
      bounds,
      deviceCode: data.device_code,
      interval: data.interval,
      expiresIn: data.expires_in
    })) as { token: string } | { error: string }

    setGithubConnecting(false)
    if ('token' in result) {
      setGithubConnected(true)
    }
  }, [])

  const handleCancelAuth = useCallback(() => {
    setCodeData(null)
    setGithubConnecting(false)
    window.api.oauth.github.cancel()
  }, [])

  const finish = useCallback(async () => {
    if (projectsDir) {
      await window.api.settings.set('projectsDir', projectsDir)
    }
    await window.api.settings.set('onboardingComplete', true)
    setScreen('project-picker')
  }, [projectsDir, setScreen])

  return (
    <>
      <div className="h-full flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            ref={authAreaRef}
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
                  onClick={() => setStep('features')}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition"
                >
                  Get Started <ArrowRight size={16} />
                </button>
              </div>
            )}

            {step === 'features' && (
              <div className="space-y-6">
                <div className="text-center">
                  <h2 className="text-lg font-semibold text-white">What Canvas does</h2>
                  <p className="text-white/40 text-sm mt-1">Everything you need, in one window</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-white/5">
                    <Terminal size={20} className="text-[var(--accent-cyan)] mb-2" />
                    <div className="text-sm font-medium text-white/80">Terminal + AI</div>
                    <div className="text-xs text-white/40 mt-1">Claude Code runs inside. Just type naturally.</div>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-white/5">
                    <Monitor size={20} className="text-[var(--accent-coral)] mb-2" />
                    <div className="text-sm font-medium text-white/80">Live Preview</div>
                    <div className="text-xs text-white/40 mt-1">See your app update instantly as Claude writes code.</div>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-white/5">
                    <GitBranch size={20} className="text-green-400 mb-2" />
                    <div className="text-sm font-medium text-white/80">Git Built In</div>
                    <div className="text-xs text-white/40 mt-1">One-click push, PR creation, and visual diffs.</div>
                  </div>
                  <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-white/5">
                    <Zap size={20} className="text-yellow-400 mb-2" />
                    <div className="text-sm font-medium text-white/80">Smart Tools</div>
                    <div className="text-xs text-white/40 mt-1">Inspector, screenshots, gallery, and timeline.</div>
                  </div>
                </div>

                <div className="bg-[var(--bg-tertiary)] rounded-lg p-4 border border-white/5">
                  <div className="text-xs text-white/30 mb-3 uppercase tracking-wider">Key shortcuts</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-white/50">New tab</span>
                      <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-white/40 font-mono text-[10px]">Cmd+T</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/50">Close tab</span>
                      <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-white/40 font-mono text-[10px]">Cmd+W</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/50">Toggle canvas</span>
                      <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-white/40 font-mono text-[10px]">Cmd+\\</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/50">Quick actions</span>
                      <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-white/40 font-mono text-[10px]">Cmd+K</kbd>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between">
                  <button onClick={() => setStep('welcome')} className="text-sm text-white/40 hover:text-white/60">Back</button>
                  <button
                    onClick={() => setStep('directory')}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm"
                  >
                    Next <ArrowRight size={14} />
                  </button>
                </div>
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
                    onClick={() => setStep('features')}
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
                  <button
                    onClick={connectGithub}
                    disabled={githubConnecting || githubConnected}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border transition bg-[var(--bg-tertiary)] ${
                      githubConnected
                        ? 'border-green-400/30'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <Github size={18} className={githubConnected ? 'text-green-400' : 'text-white/60'} />
                    <div className="text-left flex-1">
                      <div className="text-sm text-white/80">GitHub</div>
                      <div className="text-xs text-white/40">Git hosting & collaboration</div>
                    </div>
                    {githubConnecting && <Loader2 size={14} className="animate-spin text-white/40" />}
                    {githubConnected && <Check size={14} className="text-green-400" />}
                  </button>
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

      {/* GitHub code overlay — rendered via portal to escape parent transforms */}
      {createPortal(
        <AnimatePresence>
          {codeData && (
            <GitHubCodeOverlay
              code={codeData.user_code}
              onContinue={handleContinueToGithub}
              onCancel={handleCancelAuth}
            />
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}
