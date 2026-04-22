export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Compute grid layout for co-stream participants.
 *
 * Layout rules (all cells are 16:9):
 *   1      → single tile, bottom-left
 *   2–4    → one row at the bottom (equally wide)
 *   5–8    → two rows at the bottom
 *   9      → three rows at the bottom
 *
 * Cells never exceed 25% of canvas height each row.
 */
export function computeCoStreamLayout(
  count: number,
  canvasW: number,
  canvasH: number,
): CellRect[] {
  if (count === 0) return []

  const maxCellH = Math.round(canvasH * 0.25)
  const maxCols  = count <= 4 ? count : count <= 8 ? 4 : 3
  const rows     = Math.ceil(count / maxCols)

  // Cell width derived from 16:9 constraint
  const cellW = Math.min(
    Math.round(canvasW / maxCols),
    Math.round(maxCellH * 16 / 9),
  )
  const cellH = Math.round(cellW * 9 / 16)

  const gridH = rows * cellH

  // Anchor to bottom-left
  const originX = 0
  const originY = canvasH - gridH

  return Array.from({ length: count }, (_, i) => {
    const col = i % maxCols
    const row = Math.floor(i / maxCols)
    return {
      x: originX + col * cellW,
      y: originY + row * cellH,
      w: cellW,
      h: cellH,
    }
  })
}
