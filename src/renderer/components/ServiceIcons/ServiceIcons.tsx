import { useEffect, useState, useCallback } from 'react'
import { Github, Triangle, Database, Circle } from 'lucide-react'

interface ServiceStatus {
  github: boolean
  vercel: boolean
  supabase: boolean
}

const services = [
  { key: 'github' as const, icon: Github, label: 'GitHub' },
  { key: 'vercel' as const, icon: Triangle, label: 'Vercel' },
  { key: 'supabase' as const, icon: Database, label: 'Supabase' }
]

export function ServiceIcons() {
  const [status, setStatus] = useState<ServiceStatus>({
    github: false,
    vercel: false,
    supabase: false
  })
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null)

  useEffect(() => {
    // Check all service statuses on mount
    Promise.all([
      window.api.oauth.github.status(),
      window.api.oauth.vercel.status(),
      window.api.oauth.supabase.status()
    ]).then(([gh, vc, sb]) => {
      setStatus({
        github: (gh as { connected: boolean }).connected,
        vercel: (vc as { connected: boolean }).connected,
        supabase: (sb as { connected: boolean }).connected
      })
    })
  }, [])

  const connectService = useCallback(async (key: keyof ServiceStatus) => {
    await window.api.oauth[key].start()
    const result = (await window.api.oauth[key].status()) as { connected: boolean }
    setStatus((prev) => ({ ...prev, [key]: result.connected }))
    setDropdownOpen(null)
  }, [])

  const disconnectService = useCallback(async (key: keyof ServiceStatus) => {
    await window.api.oauth[key].logout()
    setStatus((prev) => ({ ...prev, [key]: false }))
    setDropdownOpen(null)
  }, [])

  return (
    <div className="flex items-center gap-1 no-drag relative">
      {services.map((service) => (
        <div key={service.key} className="relative">
          <button
            onClick={() => setDropdownOpen(dropdownOpen === service.key ? null : service.key)}
            className="relative p-1.5 rounded hover:bg-white/10 transition-colors"
            title={`${service.label}: ${status[service.key] ? 'Connected' : 'Not connected'}`}
          >
            <service.icon size={13} className="text-white/40" />
            <Circle
              size={5}
              className={`absolute -top-0 -right-0 ${
                status[service.key]
                  ? 'fill-green-400 text-green-400'
                  : 'fill-white/20 text-white/20'
              }`}
            />
          </button>

          {dropdownOpen === service.key && (
            <div className="absolute top-full right-0 mt-1 w-40 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10">
                <span className="text-xs text-white/60">{service.label}</span>
              </div>
              {status[service.key] ? (
                <button
                  onClick={() => disconnectService(service.key)}
                  className="w-full px-3 py-2 text-xs text-left text-white/50 hover:bg-white/5 hover:text-white/80 transition"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => connectService(service.key)}
                  className="w-full px-3 py-2 text-xs text-left text-[var(--accent-cyan)] hover:bg-white/5 transition"
                >
                  Connect
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
