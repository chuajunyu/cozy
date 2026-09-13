import { useEffect, useState } from 'react'
import type { Scene } from './catalog'

/** Show a validated drop while its one manual transaction is in flight. */
export function usePendingMove(scene: Scene, pending: boolean, connected: boolean) {
  const [drop, setDrop] = useState<{ source: Scene; result: Scene } | null>(null)
  const visible = pending && connected && drop?.source === scene ? drop.result : scene
  useEffect(() => {
    if (!pending || !connected || drop?.source !== scene) setDrop(null)
  }, [scene, pending, connected, drop])
  return { scene: visible, show: (result: Scene) => setDrop({ source: scene, result }) }
}
