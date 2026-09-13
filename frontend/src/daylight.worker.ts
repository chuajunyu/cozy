import { solveDaylight } from './daylightTransport'
import type { TransportInput, TransportResult } from './daylightTransport'

type WorkerScope = {
  onmessage: ((event: MessageEvent<{ id: number; input: TransportInput }>) => void) | null
  postMessage: (message: { id: number; result?: TransportResult; error?: string }, transfer?: Transferable[]) => void
}

const worker = self as unknown as WorkerScope
worker.onmessage = ({ data }) => {
  try {
    const result = solveDaylight(data.input)
    worker.postMessage({ id: data.id, result }, [result.coefficients.buffer])
  } catch (error) {
    worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Daylight calculation failed.' })
  }
}
