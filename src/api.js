// Unofficial MVG API (the one mvg.de itself uses). No key needed, CORS is open.
const BASE = 'https://www.mvg.de/api/bgw-pt/v3'

// URL name -> MVG transport types
export const MODES = {
  bus: { label: 'Bus', types: ['BUS', 'REGIONAL_BUS'] },
  ubahn: { label: 'U-Bahn', types: ['UBAHN'] },
  tram: { label: 'Tram', types: ['TRAM'] },
  sbahn: { label: 'S-Bahn', types: ['SBAHN'] },
  bahn: { label: 'Train', types: ['BAHN'] },
}

async function getJson(path, params) {
  const query = params ? `?${new URLSearchParams(params)}` : ''
  const res = await fetch(`${BASE}${path}${query}`)
  if (!res.ok) throw new Error(`MVG API responded with ${res.status}`)
  return res.json()
}

const stationCache = new Map()

// Accepts a station name ("Alte Heide") or a global ID ("de:09162:530").
export function resolveStation(query) {
  const key = query.trim().toLowerCase()
  if (!stationCache.has(key)) {
    const lookup = /^de:\d+:\d+$/.test(key)
      ? getJson(`/stations/${key}`)
      : getJson('/locations', { query: query.trim() }).then((hits) => {
          const station = hits.find((h) => h.type === 'STATION')
          if (!station) throw new Error(`No station found for "${query}"`)
          return station
        })
    const result = lookup.then((s) => ({ id: s.globalId, name: s.name }))
    result.catch(() => stationCache.delete(key))
    stationCache.set(key, result)
  }
  return stationCache.get(key)
}

const ms = (iso) => new Date(iso).getTime()

function toLeg(part) {
  const depDelay = part.from.departureDelayInMinutes ?? null
  const arrDelay = part.to.arrivalDelayInMinutes ?? null
  return {
    type: part.line.transportType,
    walk: part.line.transportType === 'PEDESTRIAN',
    label: part.line.label,
    destination: part.line.destination,
    from: part.from.name,
    to: part.to.name,
    platform: part.from.platform ?? null,
    plannedDeparture: ms(part.from.plannedDeparture),
    departure: ms(part.from.plannedDeparture) + (depDelay ?? 0) * 60_000,
    arrival: ms(part.to.plannedDeparture) + (arrDelay ?? 0) * 60_000,
    delay: depDelay,
    realtime: part.realTime,
    cancelled: part.isCancelled,
    minutes: Math.max(1, Math.round((ms(part.to.plannedDeparture) - ms(part.from.plannedDeparture)) / 60_000)),
  }
}

async function fetchPage(originId, destinationId, modes, from) {
  const params = {
    originStationGlobalId: originId,
    destinationStationGlobalId: destinationId,
    routingDateTime: from.toISOString(),
    routingDateTimeIsArrival: 'false',
  }
  const types = modes.flatMap((m) => MODES[m]?.types ?? [])
  if (types.length) params.transportTypes = types.join(',')

  const routes = await getJson('/routes', params)
  return routes
    .map((r) => {
      const legs = r.parts.map(toLeg)
      const ride = legs.find((l) => !l.walk)
      return {
        id: legs.map((l) => `${l.label}@${l.plannedDeparture}`).join('>'),
        legs,
        ride,
        departure: legs[0].departure,
        arrival: legs.at(-1).arrival,
        cancelled: legs.some((l) => l.cancelled),
      }
    })
    .filter((r) => r.ride) // drop walk-only suggestions
}

export async function fetchRoutes(originId, destinationId, modes = []) {
  const first = await fetchPage(originId, destinationId, modes, new Date())

  // The routes endpoint only returns a handful of results, so ask once more
  // starting after the last one to fill the list.
  let routes = first
  if (first.length) {
    const lastStart = Math.max(...first.map((r) => r.legs[0].plannedDeparture))
    const next = await fetchPage(originId, destinationId, modes, new Date(lastStart + 60_000)).catch(() => [])
    routes = [...first, ...next]
  }

  const seen = new Set()
  return routes
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => a.ride.departure - b.ride.departure)
}
