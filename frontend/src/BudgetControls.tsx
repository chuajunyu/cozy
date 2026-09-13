import { useEffect, useState } from 'react'

const money = (amount: number) => `S$${amount.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function BudgetControls({ budget, total, disabled, onSave }: {
  budget: number; total: number; disabled: boolean; onSave: (budget: number | null) => boolean
}) {
  const [draft, setDraft] = useState(budget ? String(budget) : '')
  useEffect(() => { setDraft(budget ? String(budget) : '') }, [budget])
  const over = budget > 0 && total > budget
  const amount = Number(draft)
  const valid = Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000
  return <div className="budget">
    <div><strong>Room cost</strong><span className={over ? 'over' : ''}>{money(total)} <small>{budget ? `/ ${money(budget)}` : '/ no target'}</small></span></div>
    {budget > 0 && <progress aria-label="Budget used" className={over ? 'over-budget' : ''} max={budget} value={Math.min(total, budget)} />}
    <p className={over ? 'over budget-warning' : ''} role="status">{!budget ? 'No budget set' : over ? `${money(total - budget)} over budget` : `${money(budget - total)} left in your budget`}</p>
    <form className="budget-input" onSubmit={e => { e.preventDefault(); if (valid && !disabled) onSave(amount || null) }}>
      <label htmlFor="budget">Your budget · S$</label>
      <input id="budget" aria-label="Room budget in SGD" type="number" inputMode="decimal" min="0" max="1000000" step="0.01" placeholder="No budget" disabled={disabled} value={draft} onChange={e => setDraft(e.target.value)} />
      <button className="primary" type="submit" disabled={disabled || !valid || amount === budget}>Save budget</button>
      <small>Leave blank for no budget. You can keep editing when the room is over your target.</small>
    </form>
  </div>
}
