import { useEffect, useMemo } from 'react'
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Scene } from './catalog'

/** One 40 cm repeat; offsets keep the pattern continuous around wall openings. */
export default function WallpaperMaterial({ pattern, color, visible, width, height, left, bottom }: {
  pattern: NonNullable<Scene['wallpapers']>[keyof NonNullable<Scene['wallpapers']>]
  color: string; visible: boolean; width: number; height: number; left: number; bottom: number
}) {
  const map = useMemo(() => {
    if (!pattern || pattern === 'none') return null
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128)
    ctx.fillStyle = '#c9cec4'; ctx.strokeStyle = '#c9cec4'
    if (pattern === 'stripes') ctx.fillRect(0, 0, 32, 128)
    if (pattern === 'dots') for (const [x,y] of [[32,32], [96,96]]) { ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill() }
    if (pattern === 'linen') {
      ctx.globalAlpha = .25
      for (let n=0; n<128; n+=4) { ctx.fillRect(n,0,1,128); ctx.fillRect(0,n,128,1) }
    }
    if (pattern === 'botanical') for (const [x,y] of [[32,32], [96,96]]) {
      ctx.beginPath(); ctx.moveTo(x-12,y+22); ctx.lineTo(x+12,y-22); ctx.stroke()
      for (const sign of [-1,1]) { ctx.beginPath(); ctx.ellipse(x+sign*7,y,5,14,sign*.7,0,Math.PI*2); ctx.fill() }
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(width/.4, height/.4)
    texture.offset.set(left/.4, bottom/.4)
    return texture
  }, [pattern, width, height, left, bottom])
  useEffect(() => () => map?.dispose(), [map])
  return <meshStandardMaterial color={color} map={map} colorWrite={visible} depthWrite={visible} roughness={.95} />
}
