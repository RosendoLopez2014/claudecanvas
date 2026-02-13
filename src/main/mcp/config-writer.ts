import { writeFile, unlink, readFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let currentConfigPath: string | null = null

export async function writeMcpConfig(projectPath: string, port: number): Promise<void> {
  const config = {
    mcpServers: {
      'claude-canvas': {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`
      }
    }
  }
  const configPath = join(projectPath, '.mcp.json')
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  currentConfigPath = configPath
  await ensureGitignore(projectPath)
}

export async function removeMcpConfig(): Promise<void> {
  if (currentConfigPath && existsSync(currentConfigPath)) {
    await unlink(currentConfigPath)
  }
  currentConfigPath = null
}

async function ensureGitignore(projectPath: string): Promise<void> {
  const gitignorePath = join(projectPath, '.gitignore')
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8')
    if (content.includes('.mcp.json')) return
    await appendFile(gitignorePath, '\n# Claude Canvas MCP config (auto-generated, session-specific)\n.mcp.json\n')
  } else {
    await writeFile(gitignorePath, '# Claude Canvas MCP config (auto-generated, session-specific)\n.mcp.json\n', 'utf-8')
  }
}
