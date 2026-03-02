import type { CardPosition } from '@/stores/gallery'

/** Default card width used when no measured width is available */
export const CARD_WIDTH = 400
export const GAP = 24

/** Max horizontal extent before cards wrap to the next row */
const MAX_CANVAS_WIDTH = 1600

/**
 * Compute grid positions for cards that don't have stored positions.
 * Existing positions are preserved; new cards are placed using
 * shelf-packing that wraps within MAX_CANVAS_WIDTH.
 */
export function autoLayout(
  variantIds: string[],
  existing: Record<string, CardPosition>,
  cardHeights: Record<string, number>
): Record<string, CardPosition> {
  const result = { ...existing }
  const newIds = variantIds.filter((id) => !existing[id])
  if (newIds.length === 0) return result

  const placed: CardPosition[] = Object.values(existing)

  for (const id of newIds) {
    const w = CARD_WIDTH
    const h = cardHeights[id] || 300
    const pos = findOpenSpot(placed, w, h)
    result[id] = pos
    placed.push(pos)
  }

  return result
}

/**
 * Find an open position for a card of the given size.
 * Tries top-to-bottom, left-to-right, wrapping within MAX_CANVAS_WIDTH.
 */
function findOpenSpot(placed: CardPosition[], w: number, h: number): CardPosition {
  if (placed.length === 0) return { x: 0, y: 0, width: w, height: h }

  // Collect candidate Y positions: 0 + bottom edge of each placed card
  const ySet = new Set([0])
  for (const p of placed) {
    ySet.add(p.y + p.height + GAP)
  }
  const sortedY = [...ySet].sort((a, b) => a - b)

  for (const y of sortedY) {
    // Collect candidate X positions: 0 + right edge of each placed card
    const xSet = new Set([0])
    for (const p of placed) {
      xSet.add(p.x + p.width + GAP)
    }
    const sortedX = [...xSet].sort((a, b) => a - b)

    for (const x of sortedX) {
      // Don't exceed canvas width
      if (x + w > MAX_CANVAS_WIDTH) continue
      const candidate: CardPosition = { x, y, width: w, height: h }
      if (!overlapsAny(candidate, placed)) {
        return candidate
      }
    }
  }

  // Fallback: new row below everything
  let maxBottom = 0
  for (const p of placed) {
    maxBottom = Math.max(maxBottom, p.y + p.height + GAP)
  }
  return { x: 0, y: maxBottom, width: w, height: h }
}

/** Check if a candidate rect overlaps any placed rect (with GAP margin) */
function overlapsAny(candidate: CardPosition, placed: CardPosition[]): boolean {
  for (const p of placed) {
    // Two rects overlap if they are NOT separated on any axis
    const sepX = candidate.x >= p.x + p.width + GAP || candidate.x + candidate.width + GAP <= p.x
    const sepY = candidate.y >= p.y + p.height + GAP || candidate.y + candidate.height + GAP <= p.y
    if (!sepX && !sepY) return true
  }
  return false
}

/**
 * Lightweight reflow: fix overlaps caused by card size changes.
 * Only adjusts cards that actually overlap — does NOT reposition everything.
 * Pinned cards are never moved.
 *
 * Strategy: iterate all card pairs. If two cards overlap and neither is pinned,
 * push the one that's lower/further-right downward. If one is pinned, push the other.
 * Repeat until stable (max 10 passes to prevent infinite loops).
 */
export function reflowColumns(positions: Record<string, CardPosition>): Record<string, CardPosition> {
  const result = { ...positions }
  let changed = false

  for (let pass = 0; pass < 10; pass++) {
    let passChanged = false
    const ids = Object.keys(result)

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = result[ids[i]]
        const b = result[ids[j]]

        // Check overlap (no gap margin — just actual overlap)
        const sepX = a.x >= b.x + b.width + GAP || a.x + a.width + GAP <= b.x
        const sepY = a.y >= b.y + b.height + GAP || a.y + a.height + GAP <= b.y
        if (sepX || sepY) continue // No overlap

        // They overlap — decide which to push down
        const aPinned = a.pinned
        const bPinned = b.pinned

        if (aPinned && bPinned) continue // Both pinned, can't fix
        if (bPinned) {
          // Push A below B
          result[ids[i]] = { ...a, y: b.y + b.height + GAP }
          passChanged = true
        } else {
          // Push B below A (default: push the later one)
          result[ids[j]] = { ...b, y: a.y + a.height + GAP }
          passChanged = true
        }
      }
    }

    if (!passChanged) break
    changed = true
  }

  return changed ? result : positions
}

/**
 * Full relayout: re-position ALL non-pinned cards from scratch.
 * Uses shelf-packing with MAX_CANVAS_WIDTH wrapping.
 * Only call this on explicit refresh, not on every size update.
 */
export function fullRelayout(
  positions: Record<string, CardPosition>
): Record<string, CardPosition> {
  const entries = Object.entries(positions)
  if (entries.length === 0) return positions

  const pinned: [string, CardPosition][] = []
  const auto: [string, CardPosition][] = []
  for (const [id, pos] of entries) {
    if (pos.pinned) {
      pinned.push([id, pos])
    } else {
      auto.push([id, pos])
    }
  }

  // Sort: largest area first for better packing
  auto.sort((a, b) => (b[1].width * b[1].height) - (a[1].width * a[1].height))

  const result: Record<string, CardPosition> = {}
  const placed: CardPosition[] = []

  for (const [id, pos] of pinned) {
    result[id] = pos
    placed.push(pos)
  }

  for (const [id, pos] of auto) {
    const newPos = findOpenSpot(placed, pos.width, pos.height)
    result[id] = newPos
    placed.push(newPos)
  }

  return result
}
