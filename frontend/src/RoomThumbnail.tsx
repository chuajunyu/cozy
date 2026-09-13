import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

// Capture only when requested, immediately after a demand-rendered frame.
export default function RoomThumbnail({ id, onCapture }: { id?: string; onCapture?: (id: string, image: string) => void }) {
  const ready = useRef(false)
  const callback = useRef(onCapture)
  callback.current = onCapture
  const { invalidate } = useThree()
  useEffect(() => {
    ready.current = false
    if (!id) return
    const timer = setTimeout(() => { ready.current = true; invalidate() }, 1200)
    return () => clearTimeout(timer)
  }, [id, invalidate])
  useFrame(({ gl, scene, camera }) => {
    if (!id || !ready.current) return
    ready.current = false
    gl.render(scene, camera)
    try {
      const thumbnail = document.createElement('canvas')
      thumbnail.width = 320
      thumbnail.height = Math.round(320 * gl.domElement.height / gl.domElement.width)
      thumbnail.getContext('2d')?.drawImage(gl.domElement, 0, 0, thumbnail.width, thumbnail.height)
      callback.current?.(id, thumbnail.toDataURL('image/webp', .7))
    } catch { callback.current?.(id, '') }
  })
  return null
}
