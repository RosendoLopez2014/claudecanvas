/**
 * Self-Healing Loop — Repair lock.
 *
 * Prevents concurrent repair sessions for the same project.
 * In-memory Map keyed by project path — no lockfile needed since
 * the main process is the single source of truth.
 *
 * File-based lock (.dev-repair.lock) is written by repair-session.ts
 * for crash survival. This module only manages the in-memory lock.
 */
import { randomUUID } from 'crypto'

export interface RepairLock {
  sessionId: string
  cwd: string
  acquiredAt: number
  attempt: number
}

const locks = new Map<string, RepairLock>()

/** Acquire a repair lock for a project. Returns the lock on success, null if already held. */
export function acquireLock(cwd: string): RepairLock | null {
  if (locks.has(cwd)) return null
  const lock: RepairLock = {
    sessionId: randomUUID(),
    cwd,
    acquiredAt: Date.now(),
    attempt: 0,
  }
  locks.set(cwd, lock)
  return lock
}

/** Release the repair lock for a project. */
export function releaseLock(cwd: string): void {
  locks.delete(cwd)
}

/** Check if a repair is in progress for a project. */
export function isLocked(cwd: string): boolean {
  return locks.has(cwd)
}

/** Get the active lock for a project (or null). */
export function getActiveLock(cwd: string): RepairLock | null {
  return locks.get(cwd) ?? null
}

/** Increment the attempt counter on an existing lock. */
export function incrementAttempt(cwd: string): void {
  const lock = locks.get(cwd)
  if (lock) lock.attempt++
}
