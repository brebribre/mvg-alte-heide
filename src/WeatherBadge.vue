<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { load, save } from './storage'
import { ICONS, describe, fetchWeather } from './weather'

const props = defineProps({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
})

const REFRESH_MS = 10 * 60_000
// A reading older than this is not worth showing while a fresh one loads.
const MAX_AGE_MS = 3 * 60 * 60_000

const key = `weather:${props.lat},${props.lng}`
const weather = ref(null)

// Like the departures: what the previous visit saw is shown at once, and a
// failed refresh keeps it on screen.
const saved = load(key)
if (saved && Date.now() - saved.at < MAX_AGE_MS) weather.value = saved

async function refresh() {
  try {
    const next = await fetchWeather(props.lat, props.lng)
    weather.value = next
    save(key, next)
  } catch {
    // A board without weather is no worse than before; the departures matter more.
  }
}

const look = computed(() => (weather.value ? describe(weather.value.code, weather.value.isDay) : null))

let timer
onMounted(() => {
  refresh()
  timer = setInterval(refresh, REFRESH_MS)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <span v-if="weather" class="weather" :title="look.label">
    <svg viewBox="0 0 24 24" :aria-label="look.label"><path :d="ICONS[look.icon]" /></svg>
    <span class="temp">{{ Math.round(weather.temperature) }}°</span>
    <span v-if="weather.rainChance != null" class="rain">{{ weather.rainChance }}% rain</span>
  </span>
  <span v-else>Departures</span>
</template>
