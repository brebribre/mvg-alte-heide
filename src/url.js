// Connections live in the URL as repeated `c` parameters:
//   ?c=<from>~<to>            any transport
//   ?c=<from>~<to>~bus,tram   only these modes
//   &display=1                read-only fullscreen board
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

function toQuery(connections) {
  return connections
    .map((c) => [c.from, c.to, c.modes.join(',')].filter(Boolean).map(encodeURIComponent).join('~'))
    .map((value) => `c=${value}`)
    .join('&')
}

export function writeConnections(connections) {
  const query = toQuery(connections)
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`)
}

// `display=1` turns the page into a read-only, non-scrolling board (for a TV).
export const isDisplay = () => new URLSearchParams(location.search).has('display')

export function displayUrl(connections) {
  return `${location.origin}${location.pathname}?${toQuery(connections)}&display=1`
}
