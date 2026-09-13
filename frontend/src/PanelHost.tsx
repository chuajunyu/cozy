import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { panelTitles, type Panel } from './workspace'

export default function PanelHost({ panel, expanded, onExpand, onResizeExpanded, onClose, children }: {
  panel: Panel; expanded: boolean; onExpand: () => void; onResizeExpanded: (expanded: boolean) => void; onClose: () => void; children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const host = useRef<HTMLElement>(null)
  const [viewport, setViewport] = useState(window.innerWidth)
  const [width, setWidth] = useState(340)
  const [sheet, setSheet] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const gesture = useRef<{ x: number; y: number; size: number; extent: number; mobile: boolean } | null>(null)
  const mobile = viewport < 900
  const min = mobile ? 30 : 280
  const max = mobile ? 78 : Math.min(720, viewport * .6)
  const value = mobile ? sheet ?? (expanded ? 78 : 45) : Math.min(width, max)
  const resize = (next: number) => {
    const size = Math.round(Math.max(min, Math.min(max, next)))
    if (mobile) { setSheet(size); onResizeExpanded(size >= 60) }
    else setWidth(size)
  }
  const reset = () => { setWidth(340); setSheet(null); onResizeExpanded(false) }
  useEffect(() => {
    const update = () => { setViewport(window.innerWidth); gesture.current = null; setResizing(false) }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  useEffect(() => { if (panel) heading.current?.focus() }, [panel])
  useEffect(() => { if (panel && mobile && sheet !== null) onResizeExpanded(sheet >= 60) }, [panel, mobile, sheet, onResizeExpanded])
  return <aside ref={host} className={`panel-host${expanded ? ' expanded' : ''}${resizing ? ' resizing' : ''}`} hidden={!panel} aria-labelledby="panel-title"
    style={{ '--panel-width': `${width}px`, '--sheet-size': sheet === null ? undefined : `${sheet}%` } as CSSProperties}>
    <div className="panel-resize" role="separator" tabIndex={0} aria-label={mobile ? 'Resize panel height' : 'Resize sidebar width'}
      aria-orientation={mobile ? 'horizontal' : 'vertical'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)}${mobile ? ' percent height' : ' pixels wide'}`}
      title="Drag to resize · Double-click to reset"
      onDoubleClick={reset}
      onPointerDown={e => {
        if (e.button !== 0) return
        const parent = host.current?.parentElement?.getBoundingClientRect()
        if (!parent) return
        e.preventDefault()
        e.currentTarget.focus()
        e.currentTarget.setPointerCapture(e.pointerId)
        gesture.current = { x: e.clientX, y: e.clientY, size: value, extent: parent.height, mobile }
        setResizing(true)
      }}
      onPointerMove={e => {
        const start = gesture.current
        if (!start || start.mobile !== mobile) return
        resize(start.size + (mobile ? (start.y - e.clientY) / start.extent * 100 : start.x - e.clientX))
      }}
      onPointerUp={e => { gesture.current = null; setResizing(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) }}
      onPointerCancel={() => { if (gesture.current) resize(gesture.current.size); gesture.current = null; setResizing(false) }}
      onLostPointerCapture={() => { gesture.current = null; setResizing(false) }}
      onKeyDown={e => {
        const increase = mobile ? 'ArrowUp' : 'ArrowLeft'
        const decrease = mobile ? 'ArrowDown' : 'ArrowRight'
        if (![increase, decrease, 'Home', 'End', 'Enter'].includes(e.key)) return
        e.preventDefault()
        if (e.key === 'Enter') reset()
        else resize(e.key === 'Home' ? min : e.key === 'End' ? max : value + (e.key === increase ? 1 : -1) * (mobile ? 5 : 24))
      }}><span /></div>
    <header className="panel-header">
      <h2 id="panel-title" ref={heading} tabIndex={-1}>{panel ? panelTitles[panel] : ''}</h2>
      <button className="sheet-expand" onClick={() => { setSheet(null); onExpand() }} aria-expanded={expanded}>{expanded ? 'Reduce' : 'Expand'}</button>
      <button onClick={onClose} aria-label="Close panel">×</button>
    </header>
    <div className="panel-body">{children}</div>
  </aside>
}
