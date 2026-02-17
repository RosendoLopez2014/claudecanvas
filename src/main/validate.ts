/**
 * Shared validation utilities for main process IPC handlers.
 *
 * Every IPC handler that receives a file/directory path from the renderer
 * should validate it with isValidPath() before using it. This prevents:
 * - Path traversal attacks via relative paths
 * - Crashes from undefined/null path arguments
 * - Operations on non-existent directories
 */
import * as path from 'path'

/**
 * Type guard: validates that a value is a non-empty absolute path string.
 * Does NOT check existence (use existsSync separately if needed).
 */
export function isValidPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && path.isAbsolute(p)
}
