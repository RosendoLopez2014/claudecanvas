import { useState, useEffect, useCallback } from 'react'
import { Shield, Plus, X, Check } from 'lucide-react'

interface PermissionRule {
  id: string
  category: 'file' | 'git' | 'shell' | 'network'
  pattern: string
  action: 'allow' | 'block'
}

const CATEGORY_LABELS: Record<string, string> = {
  file: 'File Operations',
  git: 'Git Operations',
  shell: 'Shell Commands',
  network: 'Network Access',
}

const CATEGORY_EXAMPLES: Record<string, string[]> = {
  file: ['read src/**', 'write *.ts', 'delete node_modules'],
  git: ['commit', 'push', 'checkout'],
  shell: ['npm install', 'npm test', 'rm -rf'],
  network: ['localhost:*', '*.vercel.app'],
}

export function PermissionManager({ projectPath }: { projectPath: string | null }) {
  const [rules, setRules] = useState<PermissionRule[]>([])
  const [adding, setAdding] = useState(false)
  const [newCategory, setNewCategory] = useState<PermissionRule['category']>('shell')
  const [newPattern, setNewPattern] = useState('')
  const [newAction, setNewAction] = useState<'allow' | 'block'>('allow')

  // Load persisted rules
  useEffect(() => {
    if (!projectPath) return
    window.api.settings.get(`permissions:${projectPath}`).then((saved) => {
      if (Array.isArray(saved)) setRules(saved as PermissionRule[])
    })
  }, [projectPath])

  // Persist rules on change
  const saveRules = useCallback((updated: PermissionRule[]) => {
    setRules(updated)
    if (projectPath) {
      window.api.settings.set(`permissions:${projectPath}`, updated)
    }
  }, [projectPath])

  const addRule = useCallback(() => {
    if (!newPattern.trim()) return
    const rule: PermissionRule = {
      id: `rule-${Date.now()}`,
      category: newCategory,
      pattern: newPattern.trim(),
      action: newAction,
    }
    saveRules([...rules, rule])
    setNewPattern('')
    setAdding(false)
  }, [newCategory, newPattern, newAction, rules, saveRules])

  const removeRule = useCallback((id: string) => {
    saveRules(rules.filter((r) => r.id !== id))
  }, [rules, saveRules])

  const toggleAction = useCallback((id: string) => {
    saveRules(rules.map((r) =>
      r.id === id ? { ...r, action: r.action === 'allow' ? 'block' : 'allow' } : r
    ))
  }, [rules, saveRules])

  if (!projectPath) {
    return (
      <div className="text-white/30 text-xs text-center py-4">
        Open a project to manage permissions
      </div>
    )
  }

  const grouped = {
    file: rules.filter((r) => r.category === 'file'),
    git: rules.filter((r) => r.category === 'git'),
    shell: rules.filter((r) => r.category === 'shell'),
    network: rules.filter((r) => r.category === 'network'),
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-[var(--accent-cyan)]" />
          <span className="text-xs font-medium text-white/80">Permission Rules</span>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] rounded hover:bg-[var(--accent-cyan)]/20 transition"
        >
          <Plus size={10} /> Add Rule
        </button>
      </div>

      {/* Add rule form */}
      {adding && (
        <div className="p-3 border border-white/10 rounded-lg space-y-2 bg-white/5">
          <div className="flex items-center gap-2">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as PermissionRule['category'])}
              className="bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={newAction}
              onChange={(e) => setNewAction(e.target.value as 'allow' | 'block')}
              className="bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10"
            >
              <option value="allow">Allow</option>
              <option value="block">Block</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addRule(); if (e.key === 'Escape') setAdding(false) }}
              placeholder={CATEGORY_EXAMPLES[newCategory]?.[0] || 'Pattern...'}
              className="flex-1 bg-[var(--bg-primary)] text-white text-xs px-2 py-1 rounded border border-white/10 outline-none focus:border-[var(--accent-cyan)]"
              autoFocus
            />
            <button onClick={addRule} className="p-1 text-green-400 hover:bg-green-400/10 rounded">
              <Check size={12} />
            </button>
            <button onClick={() => setAdding(false)} className="p-1 text-white/30 hover:bg-white/10 rounded">
              <X size={12} />
            </button>
          </div>
          <div className="text-[9px] text-white/20">
            Examples: {CATEGORY_EXAMPLES[newCategory]?.join(', ')}
          </div>
        </div>
      )}

      {/* Rules by category */}
      {Object.entries(grouped).map(([category, categoryRules]) => (
        categoryRules.length > 0 && (
          <div key={category}>
            <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">
              {CATEGORY_LABELS[category]}
            </div>
            <div className="space-y-1">
              {categoryRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between px-3 py-1.5 bg-white/5 rounded text-xs"
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAction(rule.id)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        rule.action === 'allow'
                          ? 'bg-green-400/10 text-green-400'
                          : 'bg-red-400/10 text-red-400'
                      }`}
                    >
                      {rule.action.toUpperCase()}
                    </button>
                    <span className="font-mono text-white/60">{rule.pattern}</span>
                  </div>
                  <button
                    onClick={() => removeRule(rule.id)}
                    className="p-0.5 text-white/20 hover:text-red-400 transition"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      ))}

      {rules.length === 0 && !adding && (
        <div className="text-[10px] text-white/20 text-center py-3">
          No permission rules configured. Claude will use default behavior.
        </div>
      )}
    </div>
  )
}
