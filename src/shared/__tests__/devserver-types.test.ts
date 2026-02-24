import { describe, it, expect } from 'vitest'
import {
  isAllowedBin,
  isCleanArg,
  validateCommand,
  validatePlan,
  parseCommandString,
  commandToString,
  ALLOWED_BINS,
} from '../devserver/types'
import type { DevServerPlan, SafeCommand } from '../devserver/types'

// ── isAllowedBin ──────────────────────────────────────────────────

describe('isAllowedBin', () => {
  it('allows npm, pnpm, yarn, bun, node, npx', () => {
    for (const bin of ['npm', 'pnpm', 'yarn', 'bun', 'node', 'npx']) {
      expect(isAllowedBin(bin)).toBe(true)
    }
  })

  it('rejects dangerous binaries', () => {
    for (const bin of ['bash', 'sh', 'curl', 'wget', 'rm', 'sudo', 'python', 'ruby', 'perl']) {
      expect(isAllowedBin(bin)).toBe(false)
    }
  })

  it('rejects empty string', () => {
    expect(isAllowedBin('')).toBe(false)
  })
})

// ── isCleanArg ────────────────────────────────────────────────────

describe('isCleanArg', () => {
  it('allows normal script args', () => {
    expect(isCleanArg('run')).toBe(true)
    expect(isCleanArg('dev')).toBe(true)
    expect(isCleanArg('start')).toBe(true)
    expect(isCleanArg('--port')).toBe(true)
    expect(isCleanArg('3000')).toBe(true)
    expect(isCleanArg('--host')).toBe(true)
    expect(isCleanArg('0.0.0.0')).toBe(true)
  })

  it('rejects shell metacharacters', () => {
    expect(isCleanArg('dev; rm -rf /')).toBe(false)
    expect(isCleanArg('dev | cat /etc/passwd')).toBe(false)
    expect(isCleanArg('dev && curl evil.com')).toBe(false)
    expect(isCleanArg('dev > /tmp/out')).toBe(false)
    expect(isCleanArg('dev < /tmp/in')).toBe(false)
    expect(isCleanArg('$(whoami)')).toBe(false)
    expect(isCleanArg('`whoami`')).toBe(false)
    expect(isCleanArg('dev\nrm -rf /')).toBe(false)
  })

  it('rejects dangerous words as standalone args', () => {
    expect(isCleanArg('bash')).toBe(false)
    expect(isCleanArg('sh')).toBe(false)
    expect(isCleanArg('curl')).toBe(false)
    expect(isCleanArg('wget')).toBe(false)
    expect(isCleanArg('rm')).toBe(false)
    expect(isCleanArg('sudo')).toBe(false)
  })
})

// ── validateCommand ───────────────────────────────────────────────

describe('validateCommand', () => {
  it('accepts valid npm run dev', () => {
    const cmd: SafeCommand = { bin: 'npm', args: ['run', 'dev'] }
    expect(validateCommand(cmd)).toEqual({ ok: true })
  })

  it('accepts valid bun dev', () => {
    const cmd: SafeCommand = { bin: 'bun', args: ['dev'] }
    expect(validateCommand(cmd)).toEqual({ ok: true })
  })

  it('rejects unknown binary', () => {
    const cmd: SafeCommand = { bin: 'python', args: ['app.py'] }
    const result = validateCommand(cmd)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not in the allowlist')
  })

  it('rejects args with injection', () => {
    const cmd: SafeCommand = { bin: 'npm', args: ['run', 'dev; rm -rf /'] }
    const result = validateCommand(cmd)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('forbidden')
  })
})

// ── validatePlan ──────────────────────────────────────────────────

describe('validatePlan', () => {
  const basePlan: DevServerPlan = {
    cwd: '/Users/test/my-app',
    manager: 'npm',
    command: { bin: 'npm', args: ['run', 'dev'] },
    port: 3000,
    confidence: 'high',
    reasons: ['test'],
    detection: {},
  }

  it('accepts a valid plan', () => {
    expect(validatePlan(basePlan)).toEqual({ ok: true })
  })

  it('rejects relative cwd', () => {
    const plan = { ...basePlan, cwd: './my-app' }
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('absolute path')
  })

  it('rejects port out of range', () => {
    const plan = { ...basePlan, port: 99999 }
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('out of range')
  })

  it('rejects plan with invalid command', () => {
    const plan = { ...basePlan, command: { bin: 'bash', args: ['-c', 'echo pwned'] } }
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
  })

  it('accepts plan without port (optional)', () => {
    const { port: _, ...noPlan } = basePlan
    expect(validatePlan(noPlan as DevServerPlan)).toEqual({ ok: true })
  })
})

// ── parseCommandString ────────────────────────────────────────────

describe('parseCommandString', () => {
  it('parses "npm run dev"', () => {
    const result = parseCommandString('npm run dev')
    expect(result).toEqual({ bin: 'npm', args: ['run', 'dev'] })
  })

  it('parses "bun dev"', () => {
    const result = parseCommandString('bun dev')
    expect(result).toEqual({ bin: 'bun', args: ['dev'] })
  })

  it('parses "pnpm start"', () => {
    const result = parseCommandString('pnpm start')
    expect(result).toEqual({ bin: 'pnpm', args: ['start'] })
  })

  it('parses "yarn dev --port 3001"', () => {
    const result = parseCommandString('yarn dev --port 3001')
    expect(result).toEqual({ bin: 'yarn', args: ['dev', '--port', '3001'] })
  })

  it('returns null for disallowed binary', () => {
    expect(parseCommandString('python app.py')).toBeNull()
  })

  it('returns null for command with injection', () => {
    expect(parseCommandString('npm run dev; rm -rf /')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCommandString('')).toBeNull()
  })

  it('trims whitespace', () => {
    const result = parseCommandString('  npm   run   dev  ')
    expect(result).toEqual({ bin: 'npm', args: ['run', 'dev'] })
  })
})

// ── commandToString ───────────────────────────────────────────────

describe('commandToString', () => {
  it('converts SafeCommand to display string', () => {
    expect(commandToString({ bin: 'npm', args: ['run', 'dev'] })).toBe('npm run dev')
  })

  it('handles single-word command', () => {
    expect(commandToString({ bin: 'bun', args: ['dev'] })).toBe('bun dev')
  })
})

// ── ALLOWED_BINS completeness ─────────────────────────────────────

describe('ALLOWED_BINS', () => {
  it('contains exactly the expected binaries', () => {
    expect([...ALLOWED_BINS].sort()).toEqual(['bun', 'node', 'npm', 'npx', 'pnpm', 'yarn'])
  })
})
