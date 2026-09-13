import type { DesignState } from './types'

export function acceptSnapshot(current: DesignState | null, incoming: DesignState): DesignState {
  return !current || incoming.revision >= current.revision ? incoming : current
}
