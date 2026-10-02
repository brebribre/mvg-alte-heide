<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MODES, fetchRoutes, resolveStation } from './api'

const REFRESH_MS = 30_000

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
const loading = ref(true)
const updatedAt = ref(null)

// On the TV board the text size follows the card width (capped so it stays
// readable from a distance) and as many rows are shown as fit the card height.
const ROW_HEIGHT_EM = 5.8
const MIN_BOARD_ROWS = 3
const MAX_BOARD_ROWS = 8
const MIN_BOARD_FONT = 12

const cardEl = ref(null)
const titleEl = ref(null)
const board = ref({ font: 26, rows: 3 })

function fitBoard() {
  const card = cardEl.value
  if (!card) return
  const space = card.clientHeight - (titleEl.value?.offsetHeight ?? 0)
  let font = Math.min(card.clientWidth * 0.046, Math.max(26, window.innerHeight * 0.024))
  let rows = Math.floor(space / (font * ROW_HEIGHT_EM))
  // Short cards (many connections on screen) shrink the text rather than drop below a few rows.
  if (rows < MIN_BOARD_ROWS) {
    font = Math.max(MIN_BOARD_FONT, space / (MIN_BOARD_ROWS * ROW_HEIGHT_EM))
    rows = Math.round(space / (font * ROW_HEIGHT_EM))
  }
  rows = Math.min(MAX_BOARD_ROWS, Math.max(1, rows))
  if (font !== board.value.font || rows !== board.value.rows) board.value = { font, rows }
}

const boardStyle = computed(() =>
  props.display ? { '--board-font': `${board.value.font}px`, '--board-rows': board.value.rows } : null,
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

// Guards against a slow response for an old from/to overwriting a newer one.
let request = 0

async function refresh() {
  const current = ++request
  const legModes = props.connection.legs.map((l) => l.modes)
  try {
    const resolved = await Promise.all(stopNames.value.map(resolveStation))
    if (current !== request) return
    stations.value = resolved
    const result = await fetchRoutes(resolved, legModes)
    if (current !== request) return
    routes.value = result
    updatedAt.value = Date.now()
    error.value = ''
  } catch (e) {
    if (current !== request) return
    error.value = e.message || 'Could not load connections'
  } finally {
    if (current === request) loading.value = false
  }
}

watch(
  () => JSON.stringify(props.connection),
  () => {
    stations.value = []
    routes.value = []
    loading.value = true
    refresh()
  },
)

let timer, resizeObserver
onMounted(() => {
  refresh()
  timer = setInterval(refresh, REFRESH_MS)
  if (props.display) {
    resizeObserver = new ResizeObserver(fitBoard)
    resizeObserver.observe(cardEl.value)
    fitBoard()
  }
})
onUnmounted(() => {
  clearInterval(timer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section ref="cardEl" class="card" :style="boardStyle">
    <h2 v-if="display" ref="titleEl" class="title">
      {{ stopLabel(0) }}
      <svg viewBox="0 0 24 24" aria-label="to"><path d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z" /></svg>
      {{ stopLabel(lastStop) }}
      <small v-if="lastStop > 1" class="via">via {{ stopNames.slice(1, -1).map((_, i) => stopLabel(i + 1)).join(', ') }}</small>
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
      <button v-else type="button" class="text" @click="addingStop = true">+ Add a stop to change at</button>
      <p v-if="stopError" class="notice bad">{{ stopError }}</p>
    </div>

    <p v-if="error" class="notice bad">{{ error }}</p>
    <p v-else-if="loading" class="notice">Loading connections…</p>
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

    <p v-if="updatedAt && !display" class="updated">Updated {{ formatTime(updatedAt) }}</p>
  </section>
</template>
