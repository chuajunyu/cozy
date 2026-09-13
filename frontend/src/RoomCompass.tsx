import { useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'

// North is -Z in the room. Project its direction into the camera's screen plane.
export function CompassBearing({ dial }: { dial: RefObject<HTMLDivElement | null> }) {
  const north = useRef(new Vector3())
  const previous = useRef<number | null>(null)
  useFrame(({ camera }) => {
    north.current.set(0, 0, -1).transformDirection(camera.matrixWorldInverse)
    if (Math.hypot(north.current.x, north.current.y) < .0001) return
    const angle = Math.atan2(north.current.x, north.current.y) * 180 / Math.PI
    if (angle === previous.current) return
    previous.current = angle
    dial.current?.style.setProperty('--compass-bearing', `${angle}deg`)
  })
  return null
}

export default function RoomCompass({ dial }: { dial: RefObject<HTMLDivElement | null> }) {
  return <div ref={dial} className="room-compass" role="img" aria-label="Room compass. The green arrow points north." title="Room compass · North">
    <svg viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="37" className="compass-ring" />
      <g className="compass-dial">
        <path d="M40 23 47 47 40 43Z" fill="#53634a" />
        <path d="M40 23 33 47 40 43Z" fill="#9ba68d" />
        <path d="M40 43 40 56" stroke="#b8bead" strokeWidth="1.5" />
        {(['N', 'E', 'S', 'W'] as const).map((label, index) =>
          <g key={label} transform={`translate(${40 + Math.sin(index * Math.PI / 2) * 28} ${40 - Math.cos(index * Math.PI / 2) * 28})`}>
            <text className={`compass-letter ${label === 'N' ? 'compass-north' : ''}`} textAnchor="middle" dominantBaseline="central">{label}</text>
          </g>)}
      </g>
    </svg>
  </div>
}
