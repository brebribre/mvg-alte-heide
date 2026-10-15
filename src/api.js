// Unofficial MVG API (the one mvg.de itself uses). No key needed, CORS is open.
import { load, save } from './storage'

const BASE = 'https://www.mvg.de/api/bgw-pt/v3'
// A board that reloads every few seconds must not pile up hanging requests.
const TIMEOUT_MS = 12_000

// URL name -> MVG transport types
export const MODES = {
  bus: { label: 'Bus', types: ['BUS', 'REGIONAL_BUS'] },
  ubahn: { label: 'U-Bahn', types: ['UBAHN'] },
  tram: { label: 'Tram', types: ['TRAM'] },
  sbahn: { label: 'S-Bahn', types: ['SBAHN'] },
  bahn: { label: 'Train', types: ['BAHN'] },
}

// JSON over HTTPS with a timeout; `who` names the service in error messages.
export async function fetchJson(url, who = 'MVG') {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined
  let res
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError'
    throw new Error(timedOut ? `${who} did not answer in time` : `Could not reach ${who}`)
  }
  if (!res.ok) throw new Error(`${who} API responded with ${res.status}`)
  return res.json()
}

const getJson = (path, params) => fetchJson(`${BASE}${path}${params ? `?${new URLSearchParams(params)}` : ''}`)

export const HERE = 'here'
const COORDS = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/
const STATION_ID = /^de:\d+:\d+$/i
const POSITION_TTL_MS = 2 * 60_000

let position = null

// The device's location, asked for once and reused for a couple of minutes.
// Only a stop written as "here" ever gets here; a board with stops from the
// URL never touches geolocation.
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

// Lookups are remembered in localStorage across reloads (a station's global ID
// never changes, so a name only has to be resolved once per device) and shared
// in memory while in flight, so two cards asking for the same stop send one request.
const inflight = new Map()

function memo(key, fetcher) {
  const stored = load(key)
  if (stored) return Promise.resolve(stored)
  if (!inflight.has(key)) {
    const result = fetcher().then((value) => {
      save(key, value)
      return value
    })
    result.catch(() => inflight.delete(key))
    inflight.set(key, result)
  }
  return inflight.get(key)
}

const stationKey = (text) => `station:${text.trim().toLowerCase()}`

const byName = (query) =>
  memo(stationKey(query), async () => {
    const hits = await getJson('/locations', { query: query.trim() })
    const station = Array.isArray(hits) ? hits.find((h) => h.type === 'STATION') : null
    if (!station) throw new Error(`No station found for "${query.trim()}"`)
    const entry = { id: station.globalId, name: station.name }
    save(stationKey(entry.id), entry) // the ID form of the same stop is known now too
    return entry
  })

const byId = (id) =>
  memo(stationKey(id), async () => {
    const s = await getJson(`/stations/${id}`)
    return { id: s.globalId, name: s.name }
  })

const nearKey = (lat, lng) => `near:${lat},${lng}`

const nearestStation = (lat, lng) =>
  memo(nearKey(lat, lng), async () => {
    const stations = await getJson('/stations/nearby', { latitude: lat, longitude: lng })
    const name = stations[0]?.name
    if (!name) throw new Error('No station nearby')
    return { name }
  })

const nearLabel = (near) => (near ? `Near ${near.name}` : 'Saved location')

// Turns what is written in the URL into a routable place. Accepts a station
// name ("Alte Heide"), a global ID ("de:09162:530"), "here" for the device's
// current location, or fixed coordinates ("48.18372,11.59668").
// `token` is how the place is written back to the URL.
// An ID or coordinates are routable at once and never wait for the network;
// their `name` is null until `placeName` has looked it up (or remembered it).
export async function resolveStation(query) {
  const text = query.trim()

  if (/^(here|current location)$/i.test(text)) {
    return { ...(await currentPosition()), name: 'Current location', token: HERE }
  }

  const coords = text.match(COORDS)
  if (coords) {
    const [lat, lng] = [Number(coords[1]), Number(coords[2])]
    const near = load(nearKey(lat, lng))
    return { lat, lng, name: near ? nearLabel(near) : null, token: `${lat},${lng}` }
  }

  if (STATION_ID.test(text)) {
    const id = text.toLowerCase()
    return { id, name: load(stationKey(id))?.name ?? null, token: id }
  }

  const s = await byName(text)
  return { id: s.id, name: s.name, token: s.name }
}

// The display name of a place that `resolveStation` returned without a name.
export function placeName(place) {
  if (place.id) return byId(place.id).then((s) => s.name)
  return nearestStation(place.lat, place.lng).then(nearLabel, () => nearLabel(null))
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

const byDeparture = (routes) => dedupe(routes).sort((a, b) => a.departure - b.departure)

// The routes endpoint only returns a handful of results, so a second page is
// asked for starting after the last one. The first page is handed to
// `onPartial` right away so the card does not wait for the second.
async function fetchSegment(origin, destination, modes, from = new Date(), onPartial) {
  const first = await fetchPage(origin, destination, modes, from)
  if (!first.length) return []
  onPartial?.(byDeparture(first))

  const lastStart = Math.max(...first.map((r) => r.legs[0].plannedDeparture))
  const next = await fetchPage(origin, destination, modes, new Date(lastStart + 60_000)).catch(() => [])
  return byDeparture([...first, ...next])
}

// Time allowed for changing vehicles at a via stop.
const TRANSFER_MS = 2 * 60_000
const MAX_CHAINS = 10

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

const byRide = (routes) => routes.sort((a, b) => a.ride.departure - b.ride.departure)

// `places` (from resolveStation) is origin, optional via stops, destination; `legModes[i]` filters
// the transport used between stop i and stop i + 1. For a direct connection `onPartial` gets the
// first page of results while the rest is still loading.
export async function fetchRoutes(places, legModes, onPartial) {
  if (places.length > 2) return fetchChained(places, legModes)
  const routes = await fetchSegment(places[0], places[1], legModes[0], new Date(), (first) => onPartial?.(byRide(first)))
  return byRide(routes)
}
