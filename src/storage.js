// localStorage behind a prefix, as JSON, without exceptions: a kiosk WebView
// or a private window may refuse storage, and the page must still work then.
const PREFIX = 'fyc:'

export function load(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Full or blocked storage only costs the next load its head start.
  }
}
