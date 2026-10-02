// Connections live in the URL as repeated `c` parameters:
//   ?c=<from>~<to>            any transport
//   ?c=<from>~<to>~bus,tram   only these modes
// <from>/<to> are station names or MVG global IDs (de:09162:530).
import { MODES } from './api'

const DEFAULT = [{ from: 'Gertrud-Grunow-Straße', to: 'Alte Heide', modes: ['bus'] }]

export function readConnections() {
  const parsed = new URLSearchParams(location.search)
    .getAll('c')
    .map((value) => {
      const [from = '', to = '', modes = ''] = value.split('~').map((s) => s.trim())
      return {
        from,
        to,
        modes: modes
          .toLowerCase()
          .split(',')
          .filter((m) => m in MODES),
      }
    })
    .filter((c) => c.from && c.to)
  return parsed.length ? parsed : DEFAULT.map((c) => ({ ...c, modes: [...c.modes] }))
}

export function writeConnections(connections) {
  const query = connections
    .map((c) => [c.from, c.to, c.modes.join(',')].filter(Boolean).map(encodeURIComponent).join('~'))
    .map((value) => `c=${value}`)
    .join('&')
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`)
}
