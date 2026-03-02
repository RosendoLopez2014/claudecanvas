
/**
 * Auto-checkpoint is disabled by default. It was creating real git commits
 * on main (e.g., "[checkpoint] Auto: 5 file changes") every time Claude
 * edited 5+ files, polluting git history with dozens of meaningless commits
 * the user never asked for. The Timeline's "+ Checkpoint" button and the
 * MCP canvas_checkpoint tool remain available for intentional save points.
 */
export function useAutoCheckpoint() {
  // no-op — manual checkpoints only
}
