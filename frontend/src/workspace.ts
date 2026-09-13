export type Panel = 'catalog' | 'astra' | 'setup' | 'lighting' | 'budget' | 'details' | 'replace' | 'menu' | null

export const panelTitles: Record<NonNullable<Panel>, string> = {
  catalog: 'Add furniture', astra: 'Ask Astra', setup: 'Room setup', lighting: 'Lighting',
  budget: 'Your room', details: 'Piece details', replace: 'Find a replacement', menu: 'Studio menu',
}

export function escapeWorkspace(panel: Panel, selected: string | null) {
  return panel ? { panel: null, selected } : { panel: null, selected: null }
}
