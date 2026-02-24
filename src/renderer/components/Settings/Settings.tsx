import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Terminal, Monitor, GitBranch, Globe, Keyboard, Settings as SettingsIcon, FileKey, Check } from 'lucide-react'
import { PermissionManager } from './PermissionManager'
import { EnvEditor } from './EnvEditor'
import { useProjectStore } from '@/stores/project'
import { GIT_PUSH_MODES, type GitPushMode } from '../../../shared/constants'

type SettingsTab = 'general' | 'terminal' | 'canvas' | 'git' | 'env' | 'services' | 'permissions'

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

const TABS: { id: SettingsTab; label: string; icon: typeof Terminal }[] = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'canvas', label: 'Canvas', icon: Monitor },
  { id: 'git', label: 'Git', icon: GitBranch },
  { id: 'env', label: 'Environment', icon: FileKey },
  { id: 'services', label: 'Services', icon: Globe },
  { id: 'permissions', label: 'Permissions', icon: Keyboard },
]

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/5">
      <div>
        <div className="text-xs text-white/80">{label}</div>
        {description && <div className="text-[10px] text-white/30 mt-0.5">{description}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-8 h-4.5 rounded-full transition-colors relative ${value ? 'bg-[var(--accent-cyan)]' : 'bg-white/20'}`}
    >
      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${value ? 'left-[calc(100%-16px)]' : 'left-0.5'}`} />
    </button>
  )
}

function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(parseInt(e.target.value) || 0)}
      className="w-16 bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10 outline-none focus:border-[var(--accent-cyan)] text-right"
    />
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-48 bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10 outline-none focus:border-[var(--accent-cyan)]"
    />
  )
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const projectPath = useProjectStore((s) => s.currentProject?.path) || null

  // Settings state
  const [fontSize, setFontSize] = useState(13)
  const [devCommand, setDevCommand] = useState('')
  const [autoCheckpoint, setAutoCheckpoint] = useState(true)
  const [checkpointThreshold, setCheckpointThreshold] = useState(5)
  const [autoGallery, setAutoGallery] = useState(true)
  const [fetchInterval, setFetchInterval] = useState(3)
  const [pushMode, setPushMode] = useState<GitPushMode>('solo')

  // Load settings
  useEffect(() => {
    if (!open) return
    window.api.settings.get('fontSize').then((v) => { if (typeof v === 'number') setFontSize(v) })
    window.api.settings.get('devCommand').then((v) => { if (typeof v === 'string') setDevCommand(v) })
    window.api.settings.get('autoCheckpointEnabled').then((v) => { if (v !== null) setAutoCheckpoint(v !== false) })
    window.api.settings.get('checkpointThreshold').then((v) => { if (typeof v === 'number') setCheckpointThreshold(v) })
    window.api.settings.get('autoGallery').then((v) => { if (v !== null) setAutoGallery(v !== false) })
    window.api.settings.get('fetchInterval').then((v) => { if (typeof v === 'number') setFetchInterval(v) })
    window.api.settings.get('gitPushMode').then((v) => { if (v && typeof v === 'string') setPushMode(v as GitPushMode) })
  }, [open])

  const saveSetting = useCallback((key: string, value: unknown) => {
    window.api.settings.set(key, value)
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed top-[10%] left-1/2 -translate-x-1/2 w-[600px] h-[500px] bg-[var(--bg-secondary)] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden flex"
          >
            {/* Sidebar */}
            <div className="w-40 border-r border-white/10 py-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors ${
                    tab === t.id ? 'text-white bg-white/5' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  <t.icon size={12} />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="text-sm font-medium text-white/80">{TABS.find((t) => t.id === tab)?.label}</span>
                <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition">
                  <X size={14} className="text-white/40" />
                </button>
              </div>

              <div className="flex-1 overflow-auto px-4 py-3">
                {tab === 'general' && (
                  <div>
                    <SettingRow label="Font Size" description="Terminal and editor font size">
                      <NumberInput value={fontSize} onChange={(v) => { setFontSize(v); saveSetting('fontSize', v) }} min={10} max={24} />
                    </SettingRow>
                  </div>
                )}

                {tab === 'terminal' && (
                  <div>
                    <SettingRow label="Dev Command" description="Custom command to start dev server (leave empty for auto-detect)">
                      <TextInput value={devCommand} onChange={(v) => { setDevCommand(v); saveSetting('devCommand', v) }} placeholder="npm run dev" />
                    </SettingRow>
                  </div>
                )}

                {tab === 'canvas' && (
                  <div>
                    <SettingRow label="Auto-add to Gallery" description="Automatically add new components to gallery">
                      <Toggle value={autoGallery} onChange={(v) => { setAutoGallery(v); saveSetting('autoGallery', v) }} />
                    </SettingRow>
                  </div>
                )}

                {tab === 'git' && (
                  <div>
                    {/* Push workflow mode */}
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">Push Workflow</div>
                      <div className="space-y-1.5">
                        {(Object.entries(GIT_PUSH_MODES) as [GitPushMode, typeof GIT_PUSH_MODES[GitPushMode]][]).map(([key, mode]) => (
                          <button
                            key={key}
                            onClick={() => { setPushMode(key); saveSetting('gitPushMode', key) }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                              pushMode === key
                                ? 'border-[var(--accent-cyan)]/40 bg-[var(--accent-cyan)]/[0.06]'
                                : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-medium ${pushMode === key ? 'text-[var(--accent-cyan)]' : 'text-white/70'}`}>
                                {mode.label}
                              </span>
                              {pushMode === key && <Check size={12} className="text-[var(--accent-cyan)]" />}
                            </div>
                            <div className="text-[10px] text-white/30 mt-0.5">{mode.description}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <SettingRow label="Auto-checkpoint" description="Automatically create checkpoints after file changes">
                      <Toggle value={autoCheckpoint} onChange={(v) => { setAutoCheckpoint(v); saveSetting('autoCheckpointEnabled', v) }} />
                    </SettingRow>
                    <SettingRow label="Checkpoint Threshold" description="Number of file changes before auto-checkpoint">
                      <NumberInput value={checkpointThreshold} onChange={(v) => { setCheckpointThreshold(v); saveSetting('checkpointThreshold', v) }} min={1} max={50} />
                    </SettingRow>
                    <SettingRow label="Fetch Interval (min)" description="How often to check for remote changes">
                      <NumberInput value={fetchInterval} onChange={(v) => { setFetchInterval(v); saveSetting('fetchInterval', v) }} min={1} max={30} />
                    </SettingRow>
                  </div>
                )}

                {tab === 'env' && <EnvEditor />}

                {tab === 'services' && (
                  <div className="text-xs text-white/30 py-4 text-center">
                    Service connections are managed in the onboarding flow.<br />
                    GitHub, Vercel, and Supabase status shown in the status bar.
                  </div>
                )}

                {tab === 'permissions' && (
                  <PermissionManager projectPath={projectPath} />
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
