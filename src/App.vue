<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { DESTINATION, ORIGIN, fetchConnections } from './api'

const REFRESH_MS = 30_000

const connections = ref([])
const error = ref('')
const loading = ref(true)
const updatedAt = ref(null)
const now = ref(Date.now())

const upcoming = computed(() =>
  connections.value.filter((c) => c.departure > now.value - 30_000),
)

const time = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Berlin',
})
const formatTime = (ms) => time.format(ms)

function countdown(c) {
  const minutes = Math.round((c.departure - now.value) / 60_000)
  return minutes <= 0 ? 'now' : `${minutes} min`
}

async function refresh() {
  try {
    connections.value = await fetchConnections()
    updatedAt.value = Date.now()
    error.value = ''
  } catch (e) {
    error.value = e.message || 'Could not load departures'
  } finally {
    loading.value = false
  }
}

let refreshTimer, clockTimer
onMounted(() => {
  refresh()
  refreshTimer = setInterval(refresh, REFRESH_MS)
  clockTimer = setInterval(() => (now.value = Date.now()), 5_000)
})
onUnmounted(() => {
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
})
</script>

<template>
  <main>
    <header>
      <p class="eyebrow">Bus connections</p>
      <h1>{{ ORIGIN.name }} <span class="arrow">→</span> {{ DESTINATION.name }}</h1>
    </header>

    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="loading" class="notice">Loading departures…</p>
    <p v-else-if="!upcoming.length && !error" class="notice">No buses found right now.</p>

    <ul v-if="upcoming.length">
      <li v-for="c in upcoming" :key="`${c.line}-${c.planned}`" :class="{ cancelled: c.cancelled }">
        <span class="line">{{ c.line }}</span>
        <div class="info">
          <span class="destination">{{ c.destination }}</span>
          <span class="times">
            {{ formatTime(c.planned) }}
            <span v-if="c.cancelled" class="late">cancelled</span>
            <span v-else-if="c.delay > 0" class="late">+{{ c.delay }}</span>
            <span v-else-if="c.realtime" class="ontime">on time</span>
            · arrives {{ formatTime(c.arrival) }}
          </span>
        </div>
        <span class="countdown">{{ c.cancelled ? '–' : countdown(c) }}</span>
      </li>
    </ul>

    <footer>
      <span v-if="updatedAt">Updated {{ formatTime(updatedAt) }} · refreshes every 30 s</span>
      <button type="button" @click="refresh">Refresh</button>
    </footer>
    <p class="credit">Data from the unofficial MVG API. Not affiliated with MVG.</p>
  </main>
</template>
