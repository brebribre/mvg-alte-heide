<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MODES, fetchRoutes, placeName, resolveStation } from './api'
import { load, save } from './storage'
import { connectionKey } from './url'

const REFRESH_MS = 30_000
// Remembered departures older than this are all in the past anyway.
const CACHE_MAX_AGE_MS = 6 * 60 * 60_000

const props = defineProps({
  connection: { type: Object, required: true },
  now: { type: Number, required: true },
  display: { type: Boolean, default: false },
})
const emit = defineEmits(['swap', 'remove', 'toggle-mode', 'add-stop', 'remove-stop', 'move-stop'])

// Origin, via stops and destination as typed in the URL, and once resolved.
const stopNames = computed(() => [props.connection.from, ...props.connection.legs.map((l) => l.to)])
const stations = ref([])
const stopLabel = (i) => stations.value[i]?.name ?? stopNames.value[i]
const lastStop = computed(() => stopNames.value.length - 1)

// Drag a stop by its handle to reorder the sequence (mouse or touch).
const fieldsEl = ref(null)
const drag = ref(null) // { from, over } while dragging

function dragStart(i, event) {
  event.preventDefault()
  drag.value = { from: i, over: i }
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // No capture available; move events still reach the handle while over it.
  }
}

function dragMove(event) {
  if (!drag.value) return
  const rows = [...fieldsEl.value.children]
  const over = rows.findIndex((row) => event.clientY < row.getBoundingClientRect().bottom)
  drag.value.over = over < 0 ? rows.length - 1 : over
}

function dragEnd(commit) {
  if (!drag.value) return
  const { from, over } = drag.value
  drag.value = null
  if (commit && from !== over) emit('move-stop', { from, to: over })
}

// The fetched departures can be folded away; the stops and filters stay visible.
const open = ref(true)

const viaLabel = computed(() =>
  lastStop.value > 1
    ? `via ${stopNames.value
        .slice(1, -1)
        .map((_, i) => stopLabel(i + 1))
        .join(', ')}`
    : '',
)

const newStop = ref('')
const addingStop = ref(false)
const stopError = ref('')

async function addStop() {
  if (!newStop.value.trim()) return
  stopError.value = ''
  try {
    const station = await resolveStation(newStop.value)
    emit('add-stop', station.token)
    newStop.value = ''
    addingStop.value = false
  } catch (e) {
    stopError.value = e.message || 'Could not find that station'
  }
}

const routes = ref([])
const error = ref('')
const updatedAt = ref(null)
// True while the card shows what a previous visit fetched, not yet refreshed.
const stale = ref(false)

// On the TV board the text size follows the card width (capped so it stays
// readable from a distance) and as many rows are shown as fit the card height.
const ROW_HEIGHT_EM = 5.8
// Wide cards (one connection per row) put each departure on a single line.
const WIDE_ROW_HEIGHT_EM = 2.7
const WIDE_MIN_WIDTH_EM = 48
const MIN_BOARD_ROWS = 3
const MAX_BOARD_ROWS = 8
const MIN_BOARD_FONT = 12

const cardEl = ref(null)
const titleEl = ref(null)
const titleTextEl = ref(null)
const footerEl = ref(null)
const board = ref({ font: 26, title: 31, rows: 3, wide: false })
const TITLE_SCALE = 1.2
const TITLE_PADDING_EM = 1.8 // left + right padding of .title

function fitBoard() {
  const card = cardEl.value
  // A card that has no size yet (the WebView of a signage player lays the page
  // out before the view is sized) would make every size 0 or NaN; the observer
  // calls again once there is something to measure.
  if (!card || !card.clientWidth || !card.clientHeight) return
  const space = card.clientHeight - (titleEl.value?.offsetHeight ?? 0) - (footerEl.value?.offsetHeight ?? 0)
  let font = Math.min(card.clientWidth * 0.046, Math.max(26, window.innerHeight * 0.024))
  const wide = card.clientWidth / font >= WIDE_MIN_WIDTH_EM
  const rowEm = wide ? WIDE_ROW_HEIGHT_EM : ROW_HEIGHT_EM
  let rows = Math.floor(space / (font * rowEm))
  // Short cards (many connections on screen) shrink the text rather than drop below a few rows.
  if (rows < MIN_BOARD_ROWS) {
    font = Math.max(MIN_BOARD_FONT, space / (MIN_BOARD_ROWS * rowEm))
    rows = Math.round(space / (font * rowEm))
  }
  rows = Math.min(MAX_BOARD_ROWS, Math.max(1, rows || 1))
  font = Math.max(MIN_BOARD_FONT, font)

  // The title is larger than the rows, but shrinks so "from → to" always fits on one line.
  let title = font * TITLE_SCALE
  const text = titleTextEl.value
  if (text?.offsetWidth) {
    const emWidth = text.offsetWidth / parseFloat(getComputedStyle(text).fontSize)
    title = Math.min(title, card.clientWidth / (emWidth + TITLE_PADDING_EM))
  }
  title = Math.round(title * 10) / 10
  const next = { font, title, rows, wide }
  if (Object.keys(next).some((k) => next[k] !== board.value[k])) board.value = next
}

const boardStyle = computed(() =>
  props.display
    ? {
        '--board-font': `${board.value.font}px`,
        '--board-title': `${board.value.title}px`,
        '--board-rows': board.value.rows,
      }
    : null,
)

const maxRoutes = computed(() => (props.display ? board.value.rows : 5))

const upcoming = computed(() =>
  routes.value.filter((r) => r.ride.departure > props.now - 30_000).slice(0, maxRoutes.value),
)

const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const formatTime = (ms) => time.format(ms)

function duration(route) {
  const minutes = Math.round((route.arrival - route.departure) / 60_000)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

function countdown(route) {
  const minutes = Math.round((route.ride.departure - props.now) / 60_000)
  return minutes <= 0 ? 'now' : `in ${minutes} min`
}

function status(route) {
  if (route.cancelled) return { text: 'Cancelled', tone: 'bad' }
  const { delay, realtime } = route.ride
  if (delay > 0) return { text: `Delayed ${delay} min`, tone: 'bad' }
  if (delay < 0) return { text: `${-delay} min early`, tone: 'good' }
  if (realtime) return { text: 'On time', tone: 'good' }
  return { text: 'Scheduled', tone: 'muted' }
}

function lineClass(leg) {
  if (leg.type === 'UBAHN') return `line ubahn ${leg.label.toLowerCase()}`
  return `line ${leg.type.toLowerCase().replace('_', '-')}`
}

// The last results are kept per connection, so a board that reloads from
// scratch (a signage player does, every few seconds) shows a full card at
// once and swaps in fresh departures when they arrive.
const cacheKey = computed(() => `routes:${connectionKey(props.connection)}`)

function restore() {
  const saved = load(cacheKey.value)
  if (!saved || Date.now() - saved.at > CACHE_MAX_AGE_MS) return
  stations.value = saved.stations
  routes.value = saved.routes
  updatedAt.value = saved.at
  stale.value = true
}

function persist() {
  save(cacheKey.value, { at: updatedAt.value, stations: stations.value, routes: routes.value })
}

// Guards against a slow response for an old from/to overwriting a newer one.
let request = 0

// An ID or coordinates in the URL are routable at once but have no name yet;
// it is looked up alongside the routes and dropped into the title when known.
function fillNames(resolved, current) {
  resolved.forEach((place, i) => {
    if (place.name) return
    placeName(place).then((name) => {
      if (current !== request) return
      stations.value[i] = { ...place, name }
      if (updatedAt.value) persist()
    })
  })
}

async function refresh() {
  const current = ++request
  const legModes = props.connection.legs.map((l) => l.modes)
  const show = (result) => {
    routes.value = result
    updatedAt.value = Date.now()
    stale.value = false
    error.value = ''
    persist()
  }
  try {
    const resolved = await Promise.all(stopNames.value.map(resolveStation))
    if (current !== request) return
    stations.value = resolved
    fillNames(resolved, current)
    const result = await fetchRoutes(resolved, legModes, (first) => current === request && show(first))
    if (current !== request) return
    show(result)
  } catch (e) {
    if (current !== request) return
    // Whatever the card showed stays; the footer says the refresh failed.
    error.value = e.message || 'Could not load connections'
  }
}

watch(
  () => connectionKey(props.connection),
  () => {
    stations.value = []
    routes.value = []
    updatedAt.value = null
    stale.value = false
    error.value = ''
    restore()
    refresh()
  },
)

let timer, resizeObserver
onMounted(() => {
  restore()
  refresh()
  timer = setInterval(refresh, REFRESH_MS)
  if (props.display) {
    resizeObserver = new ResizeObserver(fitBoard)
    resizeObserver.observe(cardEl.value)
    resizeObserver.observe(titleEl.value) // its height follows the font size
    resizeObserver.observe(titleTextEl.value) // its width follows the stop names
    resizeObserver.observe(footerEl.value)
    fitBoard()
  }
})
onUnmounted(() => {
  clearInterval(timer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section ref="cardEl" class="card" :class="{ wide: display && board.wide }" :style="boardStyle">
    <h2 v-if="display" ref="titleEl" class="title">
      <span ref="titleTextEl" class="title-text">
        {{ stopLabel(0) }}
        <svg viewBox="0 0 24 24" aria-label="to"><path d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z" /></svg>
        {{ stopLabel(lastStop) }}
      </span>
      <small v-if="viaLabel" class="via">{{ viaLabel }}</small>
    </h2>

    <div v-if="!display" class="directions">
      <div class="rail" aria-hidden="true">
        <span class="dot"></span>
        <span class="dots"></span>
        <svg class="pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
      </div>
      <div ref="fieldsEl" class="fields">
        <div
          v-for="(_, i) in stopNames"
          :key="i"
          class="field"
          :class="{ via: i > 0 && i < lastStop, dragging: drag?.from === i, over: drag && drag.over === i && drag.from !== i }"
        >
          <span
            class="handle"
            title="Drag to reorder"
            aria-hidden="true"
            @pointerdown="dragStart(i, $event)"
            @pointermove="dragMove"
            @pointerup="dragEnd(true)"
            @pointercancel="dragEnd(false)"
          >
            <svg viewBox="0 0 24 24"><path d="M9 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-6 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg>
          </span>
          <span class="name">{{ stopLabel(i) }}</span>
          <button
            v-if="i > 0 && i < lastStop"
            type="button"
            class="icon small"
            title="Remove stop"
            aria-label="Remove stop"
            @click="emit('remove-stop', i - 1)"
          >
            <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" /></svg>
          </button>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="icon" title="Reverse direction" aria-label="Reverse direction" @click="emit('swap')">
          <svg viewBox="0 0 24 24"><path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3ZM9 3 5 6.99h3V14h2V6.99h3L9 3Z" /></svg>
        </button>
        <button type="button" class="icon" title="Remove connection" aria-label="Remove connection" @click="emit('remove')">
          <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" /></svg>
        </button>
      </div>
    </div>

    <div v-if="!display" class="legs-config">
      <div v-for="(leg, l) in connection.legs" :key="l" class="chips">
        <span v-if="connection.legs.length > 1" class="chips-label">to {{ stopLabel(l + 1) }}</span>
        <button
          v-for="(mode, key) in MODES"
          :key="key"
          type="button"
          class="chip"
          :class="{ active: leg.modes.includes(key) }"
          :aria-pressed="leg.modes.includes(key)"
          @click="emit('toggle-mode', { leg: l, mode: key })"
        >
          {{ mode.label }}
        </button>
      </div>

      <form v-if="addingStop" class="stop-form" @submit.prevent="addStop">
        <input v-model="newStop" class="field" placeholder="Stop to change at" aria-label="Stop to change at" />
        <button type="submit" class="text">Add</button>
        <button type="button" class="text muted" @click="addingStop = false">Cancel</button>
      </form>
      <div v-else class="config-actions">
        <button type="button" class="text" @click="addingStop = true">+ Add a stop to change at</button>
        <button type="button" class="text" :aria-expanded="open" @click="open = !open">
          {{ open ? 'Hide departures' : 'Show departures' }}
        </button>
      </div>
      <p v-if="stopError" class="notice bad">{{ stopError }}</p>
    </div>

    <template v-if="display || open">
      <p v-if="error && !upcoming.length" class="notice bad">{{ error }}</p>
      <p v-else-if="!upcoming.length && (stale || !updatedAt)" class="notice">Loading departures…</p>
      <p v-else-if="!upcoming.length" class="notice">No connections found right now.</p>

      <ul v-if="upcoming.length" class="routes">
        <li v-for="route in upcoming" :key="route.id" :class="{ cancelled: route.cancelled }">
          <div class="row">
            <span class="span">{{ formatTime(route.departure) }} – {{ formatTime(route.arrival) }}</span>
            <span class="duration">{{ duration(route) }}</span>
          </div>
          <div class="legs">
            <template v-for="(leg, i) in route.legs" :key="i">
              <svg v-if="i" class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6Z" /></svg>
              <span v-if="leg.walk" class="walk" :title="`Walk to ${leg.to}`">
                <svg viewBox="0 0 24 24" aria-label="Walk"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7Z" /></svg>
                <small>{{ leg.minutes }}</small>
              </span>
              <span v-else :class="lineClass(leg)" :title="`${leg.label} towards ${leg.destination}`">{{ leg.label }}</span>
            </template>
          </div>
          <div class="row detail">
            <span>
              <span :class="['status', status(route).tone]">{{ status(route).text }}</span>
              <!-- On the board the stop is already in the title unless the route starts with a walk. -->
              <template v-if="!display || route.legs[0].walk">
                · {{ formatTime(route.ride.departure) }} from {{ route.ride.from }}
              </template>
              <template v-if="route.ride.platform"> · Platform {{ route.ride.platform }}</template>
              · towards {{ route.ride.destination }}
            </span>
            <span v-if="!route.cancelled" class="countdown">{{ countdown(route) }}</span>
          </div>
        </li>
      </ul>

      <!-- On the board the line is always there (blank at first) so the rows never shift. -->
      <p v-if="display || updatedAt" ref="footerEl" class="updated" :title="error">
        <template v-if="updatedAt">
          Updated {{ formatTime(updatedAt) }}<template v-if="error"> · could not refresh</template>
        </template>
        <template v-else>&nbsp;</template>
      </p>
    </template>
  </section>
</template>
