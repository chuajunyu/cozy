import { useEffect, useRef, type ReactNode } from 'react'
import { panelTitles, type Panel } from './workspace'

export default function PanelHost({ panel, expanded, onExpand, onClose, children }: {
  panel: Panel; expanded: boolean; onExpand: () => void; onClose: () => void; children: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (panel) heading.current?.focus() }, [panel])
  return <aside className={`panel-host${expanded ? ' expanded' : ''}`} hidden={!panel} aria-labelledby="panel-title">
    <header className="panel-header">
      <h2 id="panel-title" ref={heading} tabIndex={-1}>{panel ? panelTitles[panel] : ''}</h2>
      <button className="sheet-expand" onClick={onExpand} aria-expanded={expanded}>{expanded ? 'Reduce' : 'Expand'}</button>
      <button onClick={onClose} aria-label="Close panel">×</button>
    </header>
    <div className="panel-body">{children}</div>
  </aside>
}
