import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Save, RefreshCw } from 'lucide-react'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'

interface EnvVar {
  key: string
  value: string
  isNew?: boolean
}

export function EnvEditor() {
  const [vars, setVars] = useState<EnvVar[]>([])
  const [loading, setLoading] = useState(false)
  const projectPath = useProjectStore((s) => s.currentProject?.path)

  const loadEnv = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const content = await window.api.settings.get(`env:${projectPath}`) as string | null
      if (content && typeof content === 'string') {
        const parsed = content
          .split('\n')
          .filter((line) => line.trim() && !line.startsWith('#'))
          .map((line) => {
            const eqIdx = line.indexOf('=')
            if (eqIdx === -1) return { key: line.trim(), value: '' }
            return { key: line.slice(0, eqIdx).trim(), value: line.slice(eqIdx + 1).trim() }
          })
        setVars(parsed)
      } else {
        setVars([])
      }
    } catch {
      setVars([])
    }
    setLoading(false)
  }, [projectPath])

  useEffect(() => {
    loadEnv()
  }, [loadEnv])

  const saveEnv = useCallback(async () => {
    if (!projectPath) return
    const content = vars
      .filter((v) => v.key.trim())
      .map((v) => `${v.key}=${v.value}`)
      .join('\n')
    await window.api.settings.set(`env:${projectPath}`, content)
    useToastStore.getState().addToast('Environment variables saved', 'success')
  }, [projectPath, vars])

  const addVar = useCallback(() => {
    setVars((prev) => [...prev, { key: '', value: '', isNew: true }])
  }, [])

  const updateVar = useCallback((index: number, field: 'key' | 'value', val: string) => {
    setVars((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: val, isNew: false } : v)))
  }, [])

  const removeVar = useCallback((index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-white/50">
          {vars.length} variable{vars.length !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={loadEnv}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-white/40 hover:text-white/60 hover:bg-white/5 rounded transition"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>
          <button
            onClick={saveEnv}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/10 rounded transition"
          >
            <Save size={10} />
            Save
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {vars.map((envVar, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="text"
              value={envVar.key}
              onChange={(e) => updateVar(i, 'key', e.target.value)}
              placeholder="KEY"
              className="w-32 bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10 outline-none focus:border-[var(--accent-cyan)] font-mono"
            />
            <span className="text-white/20">=</span>
            <input
              type="text"
              value={envVar.value}
              onChange={(e) => updateVar(i, 'value', e.target.value)}
              placeholder="value"
              className="flex-1 bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10 outline-none focus:border-[var(--accent-cyan)] font-mono"
            />
            <button
              onClick={() => removeVar(i)}
              className="p-1 hover:bg-red-500/10 rounded transition text-white/20 hover:text-red-400"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addVar}
        className="mt-3 flex items-center gap-1 px-2 py-1 text-[10px] text-white/40 hover:text-white/60 hover:bg-white/5 rounded transition w-full justify-center border border-dashed border-white/10"
      >
        <Plus size={10} />
        Add variable
      </button>
    </div>
  )
}
