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

const dedupe = (routes) => {
  const seen = new Set()
  return routes.filter((r) => !seen.has(r.id) && seen.add(r.id))
}

async function fetchSegment(originId, destinationId, modes, from = new Date()) {
  const first = await fetchPage(originId, destinationId, modes, from)

  // The routes endpoint only returns a handful of results, so ask once more
  // starting after the last one to fill the list.
  let routes = first
  if (first.length) {
    const lastStart = Math.max(...first.map((r) => r.legs[0].plannedDeparture))
    const next = await fetchPage(originId, destinationId, modes, new Date(lastStart + 60_000)).catch(() => [])
    routes = [...first, ...next]
  }
  return dedupe(routes).sort((a, b) => a.departure - b.departure)
}

// Time allowed for changing vehicles at a via stop.
const TRANSFER_MS = 2 * 60_000
const MAX_CHAINS = 6

// Earliest-arriving ride in `pool` that can still be caught at `ready`.
const nextRide = (pool, ready) =>
  pool
    .filter((r) => !r.cancelled && r.departure >= ready)
    .sort((a, b) => a.arrival - b.arrival || b.departure - a.departure)[0]

// Fixed itinerary through via stops: every segment is looked up on its own and
// the rides are chained together, so the route always changes where asked.
async function fetchChained(stopIds, legModes) {
  const first = await fetchSegment(stopIds[0], stopIds[1], legModes[0])
  let chains = first
    .filter((r) => !r.cancelled)
    .slice(0, MAX_CHAINS)
    .map((r) => [r])

  for (let i = 1; i < stopIds.length - 1 && chains.length; i++) {
    const [from, to, modes] = [stopIds[i], stopIds[i + 1], legModes[i]]
    const earliest = Math.min(...chains.map((c) => c.at(-1).arrival)) + TRANSFER_MS
    const pool = await fetchPage(from, to, modes, new Date(earliest))

    const extended = []
    for (const chain of chains) {
      const ready = chain.at(-1).arrival + TRANSFER_MS
      let ride = nextRide(pool, ready)
      if (!ride) {
        pool.push(...(await fetchPage(from, to, modes, new Date(ready)).catch(() => [])))
        ride = nextRide(pool, ready)
      }
      if (ride) extended.push([...chain, ride])
    }
    chains = extended
  }

  // Several early rides can end up on the same onward connection; only the
  // last one that still makes it is worth showing.
  const byOnward = new Map()
  for (const chain of chains) {
    const key = chain.slice(1).map((r) => r.id).join('|')
    const best = byOnward.get(key)
    if (!best || chain[0].departure > best[0].departure) byOnward.set(key, chain)
  }

  return [...byOnward.values()]
    .map((chain) => {
      const legs = chain.flatMap((r) => r.legs)
      return {
        id: chain.map((r) => r.id).join('|'),
        legs,
        ride: chain[0].ride,
        departure: chain[0].departure,
        arrival: chain.at(-1).arrival,
        cancelled: false,
      }
    })
    .sort((a, b) => a.ride.departure - b.ride.departure)
}

// `stopIds` is origin, optional via stops, destination; `legModes[i]` filters
// the transport used between stop i and stop i + 1.
export async function fetchRoutes(stopIds, legModes) {
  if (stopIds.length > 2) return fetchChained(stopIds, legModes)
  const routes = await fetchSegment(stopIds[0], stopIds[1], legModes[0])
  return routes.sort((a, b) => a.ride.departure - b.ride.departure)
}
