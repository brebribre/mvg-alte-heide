// Unofficial MVG API (the one mvg.de itself uses). No key needed, CORS is open.
const BASE = 'https://www.mvg.de/api/bgw-pt/v3'

export const ORIGIN = { id: 'de:09162:448', name: 'Gertrud-Grunow-Straße' }
export const DESTINATION = { id: 'de:09162:530', name: 'Alte Heide' }

async function getJson(path, params) {
  const res = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`)
  if (!res.ok) throw new Error(`MVG API responded with ${res.status}`)
  return res.json()
}

// Direct bus rides origin -> destination, starting at `from`.
async function fetchRides(from) {
  const routes = await getJson('/routes', {
    originStationGlobalId: ORIGIN.id,
    destinationStationGlobalId: DESTINATION.id,
    routingDateTime: from.toISOString(),
    routingDateTimeIsArrival: 'false',
    transportTypes: 'BUS',
  })
  return routes
    .filter((r) => r.parts.length === 1 && r.parts[0].line.transportType === 'BUS')
    .map(({ parts: [part] }) => ({
      line: part.line.label,
      destination: part.line.destination,
      planned: new Date(part.from.plannedDeparture).getTime(),
      plannedArrival: new Date(part.to.plannedDeparture).getTime(),
      delay: part.from.departureDelayInMinutes ?? null,
      cancelled: part.isCancelled,
    }))
}

// Live departure board of the origin stop, used for delays and cancellations.
async function fetchLive() {
  const departures = await getJson('/departures', {
    globalId: ORIGIN.id,
    limit: 40,
    transportTypes: 'BUS',
  })
  const byKey = new Map()
  for (const d of departures) byKey.set(`${d.label}|${d.plannedDepartureTime}`, d)
  return byKey
}

export async function fetchConnections() {
  const now = new Date()
  const [first, live] = await Promise.all([fetchRides(now), fetchLive()])

  // The routes endpoint only returns a handful of results, so ask once more
  // starting after the last one to fill the list.
  let rides = first
  if (first.length) {
    const next = await fetchRides(new Date(first.at(-1).planned + 60_000)).catch(() => [])
    rides = [...first, ...next]
  }

  const seen = new Set()
  return rides
    .filter((r) => {
      const key = `${r.line}|${r.planned}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((r) => {
      const d = live.get(`${r.line}|${r.planned}`)
      const delay = d?.delayInMinutes ?? r.delay
      return {
        ...r,
        delay,
        realtime: delay != null,
        cancelled: r.cancelled || Boolean(d?.cancelled),
        departure: r.planned + (delay ?? 0) * 60_000,
        arrival: r.plannedArrival + (delay ?? 0) * 60_000,
      }
    })
    .sort((a, b) => a.departure - b.departure)
}
