import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { CriticDiagnostics } from '../../shared/critic/types'

export async function collectDiagnostics(projectPath: string): Promise<CriticDiagnostics> {
  const result: CriticDiagnostics = {}
  result.tscOutput = await runStreaming(projectPath, 'npx', ['tsc', '--noEmit'], 30_000)
  const pkg = readPkg(projectPath)
  if (pkg?.scripts?.test) {
    result.testOutput = await runStreaming(projectPath, 'npm', ['test'], 60_000)
  }
  return result
}

function runStreaming(cwd: string, cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    let output = ''
    const maxChars = 500_000
    const proc = spawn(cmd, args, { cwd, timeout, shell: true })
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (output.length < maxChars) output += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (output.length < maxChars) output += chunk.toString()
    })
    proc.on('close', () => resolve(output.trim()))
    proc.on('error', (err) => resolve(`Error: ${err.message}`))
    setTimeout(() => { try { proc.kill() } catch {} }, timeout)
  })
}

function readPkg(p: string): { scripts?: Record<string, string> } | null {
  try { return JSON.parse(readFileSync(join(p, 'package.json'), 'utf-8')) }
  catch { return null }
}
