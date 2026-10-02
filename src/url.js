// Connections live in the URL as repeated `c` parameters. Stops are separated
// by `~`; a stop can be prefixed with `<modes>@` to restrict how to get there:
//   ?c=<from>~<to>                             any transport
//   ?c=<from>~bus,tram@<to>                    only these modes
//   ?c=<from>~bus@<via>~ubahn@<via>~sbahn@<to> fixed route through via stops
//   &display=1                                 read-only fullscreen board
// Stops are station names or MVG global IDs (de:09162:530).
// The older form ?c=<from>~<to>~bus,tram is still read.
import { MODES } from './api'

// A connection is { from, legs: [{ to, modes }] }; every leg but the last ends at a via stop.
const DEFAULT = [{ from: 'Gertrud-Grunow-Straße', legs: [{ to: 'Alte Heide', modes: ['bus'] }] }]

const parseModes = (text) =>
  text
    .toLowerCase()
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m in MODES)

const isModeList = (text) => text.split(',').every((m) => m.trim().toLowerCase() in MODES)

function parseConnection(value) {
  const tokens = value.split('~').map((s) => s.trim())

  // Legacy: from~to~modes
  if (tokens.length === 3 && !value.includes('@') && isModeList(tokens[2])) {
    return { from: tokens[0], legs: [{ to: tokens[1], modes: parseModes(tokens[2]) }] }
  }

  const [from, ...rest] = tokens
  const legs = rest.map((token) => {
    const at = token.indexOf('@')
    return at < 0
      ? { to: token, modes: [] }
      : { to: token.slice(at + 1).trim(), modes: parseModes(token.slice(0, at)) }
  })
  return { from, legs }
}

export function readConnections() {
  const parsed = new URLSearchParams(location.search)
    .getAll('c')
    .map(parseConnection)
    .filter((c) => c.from && c.legs.length && c.legs.every((l) => l.to))
  return parsed.length ? parsed : structuredClone(DEFAULT)
}

function toQuery(connections) {
  return connections
    .map((c) =>
      [
        encodeURIComponent(c.from),
        ...c.legs.map((l) => (l.modes.length ? `${l.modes.join(',')}@` : '') + encodeURIComponent(l.to)),
      ].join('~'),
    )
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
