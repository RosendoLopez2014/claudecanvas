import { describe, it, expect, vi } from 'vitest'

describe('API Bridge (Preload Mock)', () => {
  it('window.api is defined', () => {
    expect(window.api).toBeDefined()
  })

  it('has platform property', () => {
    expect(window.api.platform).toBe('darwin')
  })

  it('has window control methods', () => {
    expect(typeof window.api.window.minimize).toBe('function')
    expect(typeof window.api.window.maximize).toBe('function')
    expect(typeof window.api.window.close).toBe('function')
    expect(typeof window.api.window.isMaximized).toBe('function')
  })

  it('has pty methods', () => {
    expect(typeof window.api.pty.spawn).toBe('function')
    expect(typeof window.api.pty.write).toBe('function')
    expect(typeof window.api.pty.resize).toBe('function')
    expect(typeof window.api.pty.kill).toBe('function')
    expect(typeof window.api.pty.onData).toBe('function')
    expect(typeof window.api.pty.onExit).toBe('function')
  })

  it('has settings methods', () => {
    expect(typeof window.api.settings.get).toBe('function')
    expect(typeof window.api.settings.set).toBe('function')
    expect(typeof window.api.settings.getAll).toBe('function')
  })

  it('has dialog methods', () => {
    expect(typeof window.api.dialog.selectDirectory).toBe('function')
  })

  it('has fs methods', () => {
    expect(typeof window.api.fs.watch).toBe('function')
    expect(typeof window.api.fs.unwatch).toBe('function')
    expect(typeof window.api.fs.onChange).toBe('function')
  })

  it('has render methods', () => {
    expect(typeof window.api.render.evaluate).toBe('function')
  })

  it('has git methods', () => {
    expect(typeof window.api.git.init).toBe('function')
    expect(typeof window.api.git.checkpoint).toBe('function')
    expect(typeof window.api.git.diff).toBe('function')
    expect(typeof window.api.git.log).toBe('function')
  })

  it('has oauth methods for all services', () => {
    for (const service of ['github', 'vercel', 'supabase'] as const) {
      expect(typeof window.api.oauth[service].start).toBe('function')
      expect(typeof window.api.oauth[service].status).toBe('function')
      expect(typeof window.api.oauth[service].logout).toBe('function')
    }
  })

  it('has dev server methods', () => {
    expect(typeof window.api.dev.start).toBe('function')
    expect(typeof window.api.dev.stop).toBe('function')
    expect(typeof window.api.dev.onOutput).toBe('function')
    expect(typeof window.api.dev.onExit).toBe('function')
    expect(typeof window.api.dev.onCrashReport).toBe('function')
  })

  it('pty.spawn returns a promise with an id', async () => {
    const id = await window.api.pty.spawn()
    expect(id).toBe('pty-1')
  })

  it('settings.get returns null for unknown keys', async () => {
    const val = await window.api.settings.get('unknownKey')
    expect(val).toBeNull()
  })

  it('render.evaluate returns routing decision', async () => {
    const result = await window.api.render.evaluate('<div>Hello</div>')
    expect(result).toHaveProperty('target')
    expect(result).toHaveProperty('width')
    expect(result).toHaveProperty('height')
  })
})
