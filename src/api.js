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

export const HERE = 'here'
const COORDS = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const POSITION_TTL_MS = 2 * 60_000

let position = null

// The device's location, asked for once and reused for a couple of minutes.
export function currentPosition() {
  if (position && Date.now() - position.at < POSITION_TTL_MS) return position.promise
  const promise = new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share its location'))
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: +coords.latitude.toFixed(5), lng: +coords.longitude.toFixed(5) }),
      () => reject(new Error('Could not get your location. Allow location access and try again.')),
      { maximumAge: POSITION_TTL_MS, timeout: 15_000 },
    )
  })
  position = { at: Date.now(), promise }
  promise.catch(() => (position = null))
  return promise
}

const stationCache = new Map()

function lookup(query) {
  const key = query.trim().toLowerCase()
  if (!stationCache.has(key)) {
    const result = getJson('/locations', { query: query.trim() }).then((hits) => {
      const station = hits.find((h) => h.type === 'STATION')
      if (!station) throw new Error(`No station found for "${query}"`)
      return station
    })
    result.catch(() => stationCache.delete(key))
    stationCache.set(key, result)
  }
  return stationCache.get(key)
}

function nearestStationName(lat, lng) {
  const key = `near:${lat},${lng}`
  if (!stationCache.has(key)) {
    stationCache.set(
      key,
      getJson('/stations/nearby', { latitude: lat, longitude: lng })
        .then((stations) => stations[0]?.name ?? null)
        .catch(() => null),
    )
  }
  return stationCache.get(key)
}

// Turns what is written in the URL into a routable place. Accepts a station
// name ("Alte Heide"), a global ID ("de:09162:530"), "here" for the device's
// current location, or fixed coordinates ("48.18372,11.59668").
// `token` is how the place is written back to the URL.
export async function resolveStation(query) {
  const text = query.trim()

  if (/^(here|current location)$/i.test(text)) {
    return { ...(await currentPosition()), name: 'Current location', token: HERE }
  }

  const coords = text.match(COORDS)
  if (coords) {
    const [lat, lng] = [Number(coords[1]), Number(coords[2])]
    const near = await nearestStationName(lat, lng)
    return { lat, lng, name: near ? `Near ${near}` : 'Saved location', token: `${lat},${lng}` }
  }

  if (/^de:\d+:\d+$/i.test(text)) {
    const s = await getJson(`/stations/${text.toLowerCase()}`)
    return { id: s.globalId, name: s.name, token: s.globalId }
  }

  const s = await lookup(text)
  return { id: s.globalId, name: s.name, token: s.name }
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

// A place is a station ({ id }) or a point ({ lat, lng }).
const placeParams = (place, side) =>
  place.id
    ? { [`${side}StationGlobalId`]: place.id }
    : { [`${side}Latitude`]: place.lat, [`${side}Longitude`]: place.lng }

async function fetchPage(origin, destination, modes, from) {
  const params = {
    ...placeParams(origin, 'origin'),
    ...placeParams(destination, 'destination'),
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

async function fetchSegment(origin, destination, modes, from = new Date()) {
  const first = await fetchPage(origin, destination, modes, from)

  // The routes endpoint only returns a handful of results, so ask once more
  // starting after the last one to fill the list.
  let routes = first
  if (first.length) {
    const lastStart = Math.max(...first.map((r) => r.legs[0].plannedDeparture))
    const next = await fetchPage(origin, destination, modes, new Date(lastStart + 60_000)).catch(() => [])
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
async function fetchChained(places, legModes) {
  const first = await fetchSegment(places[0], places[1], legModes[0])
  let chains = first
    .filter((r) => !r.cancelled)
    .slice(0, MAX_CHAINS)
    .map((r) => [r])

  for (let i = 1; i < places.length - 1 && chains.length; i++) {
    const [from, to, modes] = [places[i], places[i + 1], legModes[i]]
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

// `places` (from resolveStation) is origin, optional via stops, destination; `legModes[i]` filters
// the transport used between stop i and stop i + 1.
export async function fetchRoutes(places, legModes) {
  if (places.length > 2) return fetchChained(places, legModes)
  const routes = await fetchSegment(places[0], places[1], legModes[0])
  return routes.sort((a, b) => a.ride.departure - b.ride.departure)
}
