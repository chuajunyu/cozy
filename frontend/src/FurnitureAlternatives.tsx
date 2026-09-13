import { useState, type ReactNode } from 'react'
import type { Item, Product } from './catalog'

type Option = { product: Product; error?: string }

export default function Alternatives({
  item, product, options, onReplace, renderArt, formatPrice,
}: {
  item: Item
  product: Product
  options: Option[]
  onReplace: (product: Product) => void
  renderArt: (product: Product) => ReactNode
  formatPrice: (price: number) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? options : options.slice(0, 4)
  return (
    <section className="alternatives" aria-label="Similar pieces">
      <div className="alternatives-heading">
        <div>
          <p className="eyebrow">A FRESH TAKE</p>
          <h2>Similar pieces <span>{options.length}</span></h2>
        </div>
        <span className="alternatives-symbol" aria-hidden="true">⇄</span>
      </div>
      <p className="alternatives-current">Selected: <strong>{product.name}</strong></p>
      <p className="alternatives-hint">
        {item.locked ? 'Unlock this piece to try an alternative.' : 'Try a new look in the same spot. Undo brings your previous piece back.'}
      </p>
      {options.length ? (
        <div className="alternatives-list">
          {visible.map(({ product: option, error }) => {
            const difference = option.price - product.price
            return (
              <article className="alternative-card" key={option.id}>
                <div className="alternative-art">{renderArt(option)}</div>
                <div className="alternative-info">
                  <span className="alternative-source">{option.id.startsWith('ikea-') ? 'IKEA' : option.brand ?? 'Sample / custom'}</span>
                  <h3>{option.name}</h3>
                  <p>{Math.round(option.dimensions[0] * 100)} × {Math.round(option.dimensions[2] * 100)} cm · W × D</p>
                  <div className="alternative-price">
                    <strong>{formatPrice(option.price)}{option.priceNote ? '*' : ''}</strong>
                    <span>{difference === 0 ? 'Same price' : `${formatPrice(Math.abs(difference))} ${difference < 0 ? 'less' : 'more'}`}</span>
                  </div>
                </div>
                <button
                  className="alternative-try"
                  aria-label={`Try ${option.name} in room`}
                  disabled={!!error || item.locked}
                  onClick={() => onReplace(option)}
                >
                  {item.locked ? 'Unlock to try' : error ? 'Unavailable here' : 'Try in room'}
                  {!error && !item.locked && <span aria-hidden="true">↗</span>}
                </button>
                {error && !item.locked && <p className="alternative-error">{error.startsWith('Place ') || error.startsWith('That arrangement') ? 'This size does not fit here. Move the selected piece into a clearer spot.' : error}</p>}
                {option.priceNote && <p className="alternative-price-note">* Page-listed offer; conditions may apply.</p>}
              </article>
            )
          })}
        </div>
      ) : <p className="alternatives-empty">No other pieces of this type are ready yet. Choose another item to explore its alternatives.</p>}
      {options.length > 4 && <button className="alternatives-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show all ${options.length} options`}</button>}
    </section>
  )
}
