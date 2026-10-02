<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import ConnectionCard from './ConnectionCard.vue'
import { resolveStation } from './api'
import { readConnections, writeConnections } from './url'

const connections = ref(readConnections())
const now = ref(Date.now())

const from = ref('')
const to = ref('')
const adding = ref(false)
const addError = ref('')

watch(connections, writeConnections, { deep: true })

function swap(c) {
  ;[c.from, c.to] = [c.to, c.from]
}

function toggleMode(c, mode) {
  c.modes = c.modes.includes(mode) ? c.modes.filter((m) => m !== mode) : [...c.modes, mode]
}

async function add() {
  if (!from.value.trim() || !to.value.trim()) return
  adding.value = true
  addError.value = ''
  try {
    const [o, d] = await Promise.all([resolveStation(from.value), resolveStation(to.value)])
    connections.value.push({ from: o.name, to: d.name, modes: [] })
    from.value = ''
    to.value = ''
  } catch (e) {
    addError.value = e.message || 'Could not find that station'
  } finally {
    adding.value = false
  }
}

let clock
onMounted(() => (clock = setInterval(() => (now.value = Date.now()), 5_000)))
onUnmounted(() => clearInterval(clock))
</script>

<template>
  <main>
    <ConnectionCard
      v-for="(c, i) in connections"
      :key="i"
      :connection="c"
      :now="now"
      @swap="swap(c)"
      @remove="connections.splice(i, 1)"
      @toggle-mode="toggleMode(c, $event)"
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
      <button type="submit" class="primary" :disabled="adding">{{ adding ? 'Adding…' : 'Add' }}</button>
    </form>

    <p class="credit">
      Connections are stored in the page URL, so bookmark or share it to keep them. Data from the unofficial MVG API;
      not affiliated with MVG or Google.
    </p>
  </main>
</template>
