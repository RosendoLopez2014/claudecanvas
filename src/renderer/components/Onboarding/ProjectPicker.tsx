import { useEffect, useState, useCallback } from 'react'
import { useProjectStore, ProjectInfo } from '@/stores/project'
import { useTabsStore } from '@/stores/tabs'
import { Plus, FolderOpen, Clock, ArrowLeft, Loader2, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface TemplateInfo {
  id: string
  name: string
  description: string
  icon: string
  devCommand: string
  devPort: number
}

const TEMPLATE_COLORS: Record<string, string> = {
  nextjs: '#000000',
  vite: '#646CFF',
  astro: '#FF5D01',
  svelte: '#FF3E00',
  blank: '#4AEAFF',
}

type NewProjectStep = 'name' | 'template' | 'scaffolding'

export function ProjectPicker() {
  const { setCurrentProject, setScreen, setRecentProjects, recentProjects } = useProjectStore()
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectStep, setNewProjectStep] = useState<NewProjectStep>('name')
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [scaffoldProgress, setScaffoldProgress] = useState('')
  const [scaffoldError, setScaffoldError] = useState('')

  useEffect(() => {
    window.api.settings.get('recentProjects').then((projects) => {
      if (projects) setRecentProjects(projects as ProjectInfo[])
    })
    window.api.template.list().then((t: TemplateInfo[]) => setTemplates(t))
  }, [setRecentProjects])

  const openProject = useCallback(
    async (project: ProjectInfo) => {
      project.lastOpened = Date.now()
      useTabsStore.getState().addTab(project)
      setCurrentProject(project)
      setScreen('workspace')

      const updated = [project, ...recentProjects.filter((p) => p.path !== project.path)].slice(0, 10)
      setRecentProjects(updated)
      await window.api.settings.set('recentProjects', updated)
    },
    [setCurrentProject, setScreen, recentProjects, setRecentProjects]
  )

  const openExisting = useCallback(async () => {
    const dir = await window.api.dialog.selectDirectory()
    if (!dir) return
    const name = dir.split('/').pop() || 'project'
    openProject({ name, path: dir })
  }, [openProject])

  const startNewProject = useCallback(() => {
    setShowNewProject(true)
    setNewProjectStep('name')
    setNewProjectName('')
    setScaffoldProgress('')
    setScaffoldError('')
  }, [])

  const scaffoldAndOpen = useCallback(async (template: TemplateInfo) => {
    const projectsDir = (await window.api.settings.get('projectsDir')) as string
    if (!projectsDir) return

    if (template.id === 'blank') {
      const path = `${projectsDir}/${newProjectName.trim()}`
      openProject({
        name: newProjectName.trim(),
        path,
        devCommand: '',
        framework: 'blank',
      })
      return
    }

    setNewProjectStep('scaffolding')
    setScaffoldProgress('Setting up project...')
    setScaffoldError('')

    const cleanup = window.api.template.onProgress((data: { text: string }) => {
      if (data.text) setScaffoldProgress(data.text.slice(-200))
    })

    const result = await window.api.template.scaffold({
      templateId: template.id,
      projectName: newProjectName.trim(),
      parentDir: projectsDir,
    })

    cleanup()

    if (result.success) {
      openProject({
        name: newProjectName.trim(),
        path: result.path,
        devCommand: template.devCommand,
        devPort: template.devPort,
        framework: template.id,
      })
    } else {
      setScaffoldError(result.error || 'Scaffold failed')
    }
  }, [newProjectName, openProject])

  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-[560px] space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-coral)] bg-clip-text text-transparent">
            Claude Canvas
          </h1>
          <p className="text-white/40 text-sm mt-1">What are we building today?</p>
        </div>

        <AnimatePresence mode="wait">
          {!showNewProject ? (
            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* Actions */}
              <div className="flex gap-3 mb-6">
                <button
                  onClick={startNewProject}
                  className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-cyan)]/40 transition bg-[var(--bg-tertiary)] group"
                >
                  <Plus size={18} className="text-[var(--accent-cyan)] group-hover:scale-110 transition-transform" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-white/80">New Project</div>
                    <div className="text-xs text-white/40">Start from a template</div>
                  </div>
                </button>
                <button
                  onClick={openExisting}
                  className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-coral)]/40 transition bg-[var(--bg-tertiary)] group"
                >
                  <FolderOpen size={18} className="text-[var(--accent-coral)] group-hover:scale-110 transition-transform" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-white/80">Open Existing</div>
                    <div className="text-xs text-white/40">Browse for a project</div>
                  </div>
                </button>
              </div>

              {/* Recent projects */}
              {recentProjects.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-white/30">
                    <Clock size={12} />
                    <span>Recent</span>
                  </div>
                  <div className="space-y-1">
                    {recentProjects.map((project) => (
                      <button
                        key={project.path}
                        onClick={() => openProject(project)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-white/5 transition text-left"
                      >
                        <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center text-xs text-white/40">
                          {project.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm text-white/80">{project.name}</div>
                          <div className="text-xs text-white/30">{project.path}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="new" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              {newProjectStep === 'name' && (
                <div className="space-y-4">
                  <button onClick={() => setShowNewProject(false)} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60">
                    <ArrowLeft size={12} /> Back
                  </button>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Name your project</h2>
                    <p className="text-white/40 text-sm mt-0.5">This will be the folder name.</p>
                  </div>
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newProjectName.trim()) setNewProjectStep('template')
                    }}
                    placeholder="my-awesome-app"
                    autoFocus
                    className="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent-cyan)]/50"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => setNewProjectStep('template')}
                      disabled={!newProjectName.trim()}
                      className="px-5 py-2 bg-[var(--accent-cyan)] text-black font-medium rounded-lg hover:brightness-110 transition text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Choose Template
                    </button>
                  </div>
                </div>
              )}

              {newProjectStep === 'template' && (
                <div className="space-y-4">
                  <button onClick={() => setNewProjectStep('name')} className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60">
                    <ArrowLeft size={12} /> Back
                  </button>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Choose a template</h2>
                    <p className="text-white/40 text-sm mt-0.5">for <span className="text-[var(--accent-cyan)]">{newProjectName}</span></p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => scaffoldAndOpen(t)}
                        className="flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-cyan)]/40 transition bg-[var(--bg-tertiary)] text-left group"
                      >
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
                          style={{ backgroundColor: `${TEMPLATE_COLORS[t.id] || '#333'}20`, color: TEMPLATE_COLORS[t.id] || '#fff' }}
                        >
                          {t.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white/80 group-hover:text-white transition">{t.name}</div>
                          <div className="text-xs text-white/40 truncate">{t.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {newProjectStep === 'scaffolding' && (
                <div className="space-y-6 text-center">
                  {!scaffoldError ? (
                    <>
                      <Loader2 size={32} className="mx-auto animate-spin text-[var(--accent-cyan)]" />
                      <div>
                        <h2 className="text-lg font-semibold text-white">Creating {newProjectName}...</h2>
                        <p className="text-white/40 text-xs mt-2 font-mono max-h-20 overflow-hidden">
                          {scaffoldProgress}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[var(--accent-coral)] text-sm">{scaffoldError}</div>
                      <button
                        onClick={() => setNewProjectStep('template')}
                        className="text-sm text-white/40 hover:text-white/60"
                      >
                        Try again
                      </button>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
