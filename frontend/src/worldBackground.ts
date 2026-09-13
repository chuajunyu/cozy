const night = ['#25334b', '#0c1424', '#c2cddd'] as const
const day = ['#f8f6ef', '#cfdde4', '#596555'] as const
const stops: [number, readonly string[]][] = [
  [0, night], [5, night],
  [6, ['#b99187', '#45516a', '#f2e5df']],
  [8, day], [15, day],
  [17, ['#e9c3a0', '#8896ad', '#394a5c']],
  [18, ['#81738d', '#303d59', '#eee4ef']],
  [19, night], [24, night],
]

/** Display-only atmosphere follows the same illustrative solar time as the room. */
export function worldBackground(hour: number) {
  const time = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 9
  const end = stops.findIndex(([at]) => at > time)
  const [from, a] = stops[end - 1], [to, b] = stops[end]
  const t = (time - from) / (to - from)
  const blend = (color: string, other: string) => '#' + [1, 3, 5].map(start => {
    const left = parseInt(color.slice(start, start + 2), 16)
    const right = parseInt(other.slice(start, start + 2), 16)
    return Math.round(left + (right - left) * t).toString(16).padStart(2, '0')
  }).join('')
  return { glow: blend(a[0], b[0]), sky: blend(a[1], b[1]), text: blend(a[2], b[2]) }
}
