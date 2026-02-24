import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'

const FETCH_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes
const FETCH_COOLDOWN_MS = 30 * 1000 // Don't re-fetch within 30 seconds

/** Extract owner/repo from a GitHub remote URL (HTTPS or SSH) */
function parseRepoName(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/)
  return match?.[1] || null
}

/**
 * Keeps per-tab git state in sync.
 *
 * Two modes:
 * 1. **Local refresh** (on tab switch): reads branch + remote URL from local
 *    git. No network calls — instant.
 * 2. **Network fetch** (on window focus / 3-min interval): runs `git fetch`
 *    to update ahead/behind counts. Skips tabs fetched within 30 seconds.
 */
export function useGitSync() {
  const fetchingRef = useRef(false)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  // ── Local refresh: runs on every tab switch (fast, no network) ──
  // Skips getProjectInfo if the tab already has cached branch+remote data
  // from a previous bootstrap, avoiding unnecessary git spawns that trigger EBADF.
  useEffect(() => {
    if (!activeTabId) return

    const tab = useTabsStore.getState().getActiveTab()
    if (!tab) return

    const projectPath = tab.project.path

    // If we already have bootstrapped git data, use it directly (no spawn needed)
    if (tab.githubBootstrapped && (tab.worktreeBranch || tab.githubRepoName)) {
      console.log(`[TAB-DEBUG] useGitSync: local refresh SKIP — using cached data for ${projectPath.split('/').pop()} (tab ${tab.id.slice(-6)})`)
      return
    }

    // If not yet bootstrapped, let ServiceIcons handle the initial getProjectInfo.
    // This avoids duplicate git spawns (both useGitSync + ServiceIcons calling getProjectInfo).
    if (!tab.githubBootstrapped) {
      console.log(`[TAB-DEBUG] useGitSync: local refresh SKIP — not bootstrapped, deferring to ServiceIcons (tab ${tab.id.slice(-6)})`)
      return
    }

    console.log(`[TAB-DEBUG] useGitSync: local refresh for ${projectPath.split('/').pop()} (tab ${tab.id.slice(-6)})`)
    window.api.git.getProjectInfo(projectPath).then(({ branch, remoteUrl, error }) => {
      // Only update the tab we started with (user may have switched again)
      const current = useTabsStore.getState().getActiveTab()
      if (current?.id !== tab.id) {
        console.log(`[TAB-DEBUG] useGitSync: discarded (tab switched away from ${tab.id.slice(-6)})`)
        return
      }

      // Transient failure — keep cached values, don't overwrite with nulls
      if (error) {
        console.log(`[TAB-DEBUG] useGitSync: getProjectInfo error, keeping cached (${error})`)
        return
      }

      const repoName = parseRepoName(remoteUrl)
      // Re-read tab to get latest cached values (may have been updated by ServiceIcons)
      const freshTab = useTabsStore.getState().tabs.find((t) => t.id === tab.id)
      console.log(`[TAB-DEBUG] useGitSync: branch=${branch || 'none'}, repo=${repoName || 'none'}, remote=${remoteUrl ? 'yes' : 'no'}`)

      // Don't overwrite known-good cached values with null/false from transient failures.
      // Only upgrade: null→value, or value→different-value. Never value→null.
      const updates: Record<string, unknown> = {
        worktreeBranch: tab.worktreeBranch || branch || null,
      }
      // Only set gitRemoteConfigured=false if we don't have a cached repo name
      // (transient git read failure shouldn't clear the "remote configured" flag)
      if (remoteUrl) {
        updates.gitRemoteConfigured = true
      } else if (!freshTab?.githubRepoName) {
        updates.gitRemoteConfigured = false
      }
      // Only write githubRepoName if we found one (never overwrite with null)
      if (repoName && repoName !== freshTab?.githubRepoName) {
        updates.githubRepoName = repoName
      }

      useTabsStore.getState().updateTab(tab.id, updates)
    }).catch(() => {})
  }, [activeTabId])

  // ── Network fetch: runs on focus / interval (never on tab switch) ──
  useEffect(() => {
    async function fetchForActiveTab() {
      if (fetchingRef.current) return
      fetchingRef.current = true

      const tab = useTabsStore.getState().getActiveTab()
      if (!tab) { fetchingRef.current = false; return }

      // Skip if recently fetched
      if (tab.lastFetchTime && Date.now() - tab.lastFetchTime < FETCH_COOLDOWN_MS) {
        fetchingRef.current = false
        return
      }

      const projectPath = tab.project.path
      try {
        const remoteUrl = await window.api.git.remoteUrl(projectPath)

        if (!remoteUrl) {
          useTabsStore.getState().updateTab(tab.id, {
            gitRemoteConfigured: false,
            gitAhead: 0,
            gitBehind: 0,
          })
          fetchingRef.current = false
          return
        }

        const result = await window.api.git.fetch(projectPath)

        if (result.error) {
          useTabsStore.getState().updateTab(tab.id, {
            gitRemoteConfigured: true,
            gitFetchError: result.error,
            lastFetchTime: Date.now(),
          })
        } else {
          useTabsStore.getState().updateTab(tab.id, {
            gitRemoteConfigured: true,
            gitAhead: result.ahead,
            gitBehind: result.behind,
            gitFetchError: null,
            lastFetchTime: Date.now(),
          })
        }
      } catch {
        // Network error — silently ignore
      } finally {
        fetchingRef.current = false
      }
    }

    // Initial fetch after 2 seconds (after app settles)
    const initial = setTimeout(fetchForActiveTab, 2000)
    const interval = setInterval(fetchForActiveTab, FETCH_INTERVAL_MS)
    window.addEventListener('focus', fetchForActiveTab)

    return () => {
      clearTimeout(initial)
      clearInterval(interval)
      window.removeEventListener('focus', fetchForActiveTab)
    }
  }, [])
}
