<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { MODES, fetchRoutes, resolveStation } from './api'

const REFRESH_MS = 30_000

const props = defineProps({
  connection: { type: Object, required: true },
  now: { type: Number, required: true },
  display: { type: Boolean, default: false },
})
const emit = defineEmits(['swap', 'remove', 'toggle-mode'])

const origin = ref(null)
const destination = ref(null)
const routes = ref([])
const error = ref('')
const loading = ref(true)
const updatedAt = ref(null)

const MAX_ROUTES = 5

const upcoming = computed(() =>
  routes.value.filter((r) => r.ride.departure > props.now - 30_000).slice(0, MAX_ROUTES),
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
  const { from, to, modes } = props.connection
  try {
    const [o, d] = await Promise.all([resolveStation(from), resolveStation(to)])
    if (current !== request) return
    origin.value = o
    destination.value = d
    const result = await fetchRoutes(o.id, d.id, modes)
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
  () => [props.connection.from, props.connection.to, props.connection.modes.join(',')],
  () => {
    routes.value = []
    loading.value = true
    refresh()
  },
)

let timer
onMounted(() => {
  refresh()
  timer = setInterval(refresh, REFRESH_MS)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section class="card">
    <h2 v-if="display" class="title">
      {{ origin?.name ?? connection.from }}
      <svg viewBox="0 0 24 24" aria-label="to"><path d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8Z" /></svg>
      {{ destination?.name ?? connection.to }}
    </h2>

    <div v-if="!display" class="directions">
      <div class="rail" aria-hidden="true">
        <span class="dot"></span>
        <span class="dots"></span>
        <svg class="pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
      </div>
      <div class="fields">
        <div class="field">{{ origin?.name ?? connection.from }}</div>
        <div class="field">{{ destination?.name ?? connection.to }}</div>
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

    <div v-if="!display" class="chips">
      <button
        v-for="(mode, key) in MODES"
        :key="key"
        type="button"
        class="chip"
        :class="{ active: connection.modes.includes(key) }"
        :aria-pressed="connection.modes.includes(key)"
        @click="emit('toggle-mode', key)"
      >
        {{ mode.label }}
      </button>
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
