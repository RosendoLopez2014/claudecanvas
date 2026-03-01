import { settingsStore } from '../store'
import type { CriticConfig } from '../../shared/critic/types'
import { DEFAULT_CRITIC_CONFIG } from '../../shared/critic/types'

function configKey(projectPath: string): string {
  return `criticConfig.${projectPath.replace(/[^a-zA-Z0-9_\-/]/g, '_')}`
}

export function getCriticConfig(projectPath: string): CriticConfig {
  const raw = settingsStore.get(configKey(projectPath)) as Partial<CriticConfig> | undefined
  return raw ? { ...DEFAULT_CRITIC_CONFIG, ...raw } : { ...DEFAULT_CRITIC_CONFIG }
}

export function setCriticConfig(projectPath: string, config: CriticConfig): void {
  settingsStore.set(configKey(projectPath), config)
}

export function mergeCriticConfig(projectPath: string, partial: Partial<CriticConfig>): void {
  setCriticConfig(projectPath, { ...getCriticConfig(projectPath), ...partial })
}
