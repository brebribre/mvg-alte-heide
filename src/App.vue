<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import ConnectionCard from './ConnectionCard.vue'
import { resolveStation } from './api'
import { displayUrl, isDisplay, readConnections, writeConnections } from './url'

const connections = ref(readConnections())
const now = ref(Date.now())
const display = isDisplay()
const copied = ref(false)
const copyError = ref('')

// Landscape grid for the display board: one row up to 3 cards, then two, then three.
const gridRows = computed(() => (connections.value.length <= 3 ? 1 : connections.value.length <= 8 ? 2 : 3))
const gridCols = computed(() => Math.ceil(connections.value.length / gridRows.value))

const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

async function copyDisplayLink() {
  copyError.value = ''
  let url
  try {
    url = await displayUrl(connections.value)
  } catch (e) {
    copyError.value = e.message
    return
  }
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    window.prompt('Copy this link', url)
    return
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

const from = ref('')
const to = ref('')
const adding = ref(false)
const addError = ref('')

watch(connections, writeConnections, { deep: true })

function swap(c) {
  const stops = [c.from, ...c.legs.map((l) => l.to)].reverse()
  const modes = c.legs.map((l) => l.modes).reverse()
  c.from = stops[0]
  c.legs = modes.map((m, i) => ({ to: stops[i + 1], modes: m }))
}

function toggleMode(c, { leg, mode }) {
  const l = c.legs[leg]
  l.modes = l.modes.includes(mode) ? l.modes.filter((m) => m !== mode) : [...l.modes, mode]
}

// Only the stops move; each leg keeps its transport filter.
function moveStop(c, { from, to }) {
  const stops = [c.from, ...c.legs.map((l) => l.to)]
  stops.splice(to, 0, ...stops.splice(from, 1))
  c.from = stops[0]
  c.legs.forEach((l, i) => (l.to = stops[i + 1]))
}

// Via stops go in just before the destination.
function addStop(c, name) {
  c.legs.splice(c.legs.length - 1, 0, { to: name, modes: [] })
}

async function add() {
  if (!from.value.trim() || !to.value.trim()) return
  adding.value = true
  addError.value = ''
  try {
    const [o, d] = await Promise.all([resolveStation(from.value), resolveStation(to.value)])
    connections.value.push({ from: o.token, legs: [{ to: d.token, modes: [] }] })
    from.value = ''
    to.value = ''
  } catch (e) {
    addError.value = e.message || 'Could not find that station'
  } finally {
    adding.value = false
  }
}

let ticker
onMounted(() => {
  document.documentElement.classList.toggle('display', display)
  ticker = setInterval(() => (now.value = Date.now()), 5_000)
})
onUnmounted(() => clearInterval(ticker))
</script>

<template>
  <main v-if="display" class="board" :style="{ '--cols': gridCols, '--rows': gridRows }">
    <header class="board-bar">
      <span>Departures</span>
      <span class="clock">{{ clock.format(now) }}</span>
    </header>
    <div class="board-grid">
      <ConnectionCard v-for="(c, i) in connections" :key="i" :connection="c" :now="now" display />
    </div>
  </main>

  <main v-else>
    <div class="toolbar">
      <span class="hint">Open the copied link on a TV for a fullscreen board without the controls.</span>
      <button type="button" class="primary" :disabled="!connections.length" @click="copyDisplayLink">
        {{ copied ? 'Copied' : 'Copy display link' }}
      </button>
    </div>
    <p v-if="copyError" class="notice bad card">{{ copyError }}</p>

    <ConnectionCard
      v-for="(c, i) in connections"
      :key="i"
      :connection="c"
      :now="now"
      @swap="swap(c)"
      @remove="connections.splice(i, 1)"
      @toggle-mode="toggleMode(c, $event)"
      @add-stop="addStop(c, $event)"
      @remove-stop="c.legs.splice($event, 1)"
      @move-stop="moveStop(c, $event)"
    />

    <form class="card add" @submit.prevent="add">
      <h2>Add connection</h2>
      <div class="directions">
        <div class="rail" aria-hidden="true">
          <span class="dot"></span>
          <span class="dots"></span>
          <svg class="pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" /></svg>
        </div>
        <div class="fields">
          <input v-model="from" class="field" placeholder="Choose starting stop" aria-label="Starting stop" />
          <input v-model="to" class="field" placeholder="Choose destination stop" aria-label="Destination stop" />
        </div>
      </div>
      <p v-if="addError" class="notice bad">{{ addError }}</p>
      <div class="add-actions">
        <button type="button" class="text" @click="from = 'Current location'">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" /></svg>
          Start from current location
        </button>
        <button type="submit" class="primary" :disabled="adding">{{ adding ? 'Adding…' : 'Add' }}</button>
      </div>
    </form>

    <p class="credit">
      Connections are stored in the page URL, so bookmark or share it to keep them. Data from the unofficial MVG API;
      not affiliated with MVG or Google.
    </p>
  </main>
</template>
