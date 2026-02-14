import { useEffect, useState, useCallback } from 'react'
import { useProjectStore, ProjectInfo } from '@/stores/project'
import { useTabsStore } from '@/stores/tabs'
import { Plus, FolderOpen, Clock } from 'lucide-react'
import { motion } from 'framer-motion'

export function ProjectPicker() {
  const { setCurrentProject, setScreen, setRecentProjects, recentProjects } = useProjectStore()
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  useEffect(() => {
    window.api.settings.get('recentProjects').then((projects) => {
      if (projects) setRecentProjects(projects as ProjectInfo[])
    })
  }, [setRecentProjects])

  const openProject = useCallback(
    async (project: ProjectInfo) => {
      project.lastOpened = Date.now()
      useTabsStore.getState().addTab(project)
      setCurrentProject(project)
      setScreen('workspace')

      // Update recent projects
      const updated = [project, ...recentProjects.filter((p) => p.path !== project.path)].slice(
        0,
        10
      )
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

  const createNew = useCallback(async () => {
    if (!newProjectName.trim()) return
    const projectsDir = (await window.api.settings.get('projectsDir')) as string
    if (!projectsDir) return

    const path = `${projectsDir}/${newProjectName.trim()}`
    openProject({ name: newProjectName.trim(), path })
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

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => setShowNewProject(true)}
            className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-cyan)]/40 transition bg-[var(--bg-tertiary)] group"
          >
            <Plus
              size={18}
              className="text-[var(--accent-cyan)] group-hover:scale-110 transition-transform"
            />
            <div className="text-left">
              <div className="text-sm font-medium text-white/80">New Project</div>
              <div className="text-xs text-white/40">Start from scratch</div>
            </div>
          </button>
          <button
            onClick={openExisting}
            className="flex-1 flex items-center gap-3 p-4 rounded-lg border border-white/10 hover:border-[var(--accent-coral)]/40 transition bg-[var(--bg-tertiary)] group"
          >
            <FolderOpen
              size={18}
              className="text-[var(--accent-coral)] group-hover:scale-110 transition-transform"
            />
            <div className="text-left">
              <div className="text-sm font-medium text-white/80">Open Existing</div>
              <div className="text-xs text-white/40">Browse for a project</div>
            </div>
          </button>
        </div>

        {/* New project form */}
        {showNewProject && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-3"
          >
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createNew()}
              placeholder="Project name..."
              autoFocus
              className="w-full px-4 py-2.5 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent-cyan)]/50"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewProject(false)}
                className="px-4 py-1.5 text-xs text-white/40 hover:text-white/60"
              >
                Cancel
              </button>
              <button
                onClick={createNew}
                className="px-4 py-1.5 text-xs bg-[var(--accent-cyan)] text-black rounded-md font-medium"
              >
                Create
              </button>
            </div>
          </motion.div>
        )}

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
      </div>
    </div>
  )
}
