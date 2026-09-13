// Project the room's bounding box into the default orthographic view.
// Ten percent on each side remains free for edges and selection outlines.
export function fitZoom(width: number, height: number, depth: number, viewportWidth: number, viewportHeight: number, top: boolean) {
  const projectedWidth = top ? width : (width + depth) / Math.sqrt(2)
  const projectedHeight = top ? depth : (width + depth) / Math.sqrt(6) + height * Math.sqrt(2 / 3)
  return Math.max(.01, Math.min(Math.max(1, viewportWidth) * .8 / projectedWidth, Math.max(1, viewportHeight) * .8 / projectedHeight))
}
