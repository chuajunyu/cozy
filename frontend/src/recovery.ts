import { migrateLegacy } from './backup'
import type { Backup, Product, RestorePreview } from './types'

export function readSavedRoom(raw: string, catalog: Product[]): Backup {
  const saved = JSON.parse(raw)
  return saved.version === 2 || saved.version === 3 || saved.version === 4 ? saved : migrateLegacy(raw, catalog)
}

export function automaticRestore(preview: RestorePreview) {
  if (!preview.state || preview.blockers.length) return null
  return {
    type: 'session.restore' as const,
    previewId: preview.previewId,
    allowLocked: preview.adjustments.flatMap(change => change.locked && change.slotId ? [change.slotId] : []),
  }
}
